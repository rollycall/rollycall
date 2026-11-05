// Indexer pipeline: find top -> scan -> host probes -> cards -> scores -> stats. All state lives in SQLite.
import { findTopId, scanIds } from './scan.mjs';
import { probeHost, observeCard, runPaced, hostKeyOf } from './fetcher.mjs';
import { config } from './config.mjs';
import { setMeta, getMeta } from './db.mjs';
import { livenessOf, scoreOf, selfConsistentOf, isMassPlatform, schemeOf, hostOf } from '../../shared/model.mjs';

const sec = () => Math.floor(Date.now() / 1000);
const DAY = 86400;
// The daily timer starts at a fixed time but cards are stamped minutes later, so "24h after the last check" lands just after
// the next run reaches this phase. Anything due within this window counts as due, otherwise daily cards are only checked every other day.
const DUE_SLACK_SEC = 6 * 3600;

export function upsertAgents(db, rows, now = sec()) {
  const get = db.prepare('SELECT token_uri FROM agents WHERE id=?');
  const ins = db.prepare(`INSERT INTO agents(id,owner,agent_wallet,token_uri,platform,first_seen_at,last_scanned_at,"exists")
    VALUES(@id,@owner,@wallet,@uri,@platform,@now,@now,@exists)
    ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, agent_wallet=excluded.agent_wallet, token_uri=excluded.token_uri,
      platform=excluded.platform, last_scanned_at=excluded.last_scanned_at, "exists"=excluded."exists"`);
  const dropCard = db.prepare('DELETE FROM cards WHERE id=?');
  db.transaction(() => {
    for (const r of rows) {
      const prev = get.get(r.id);
      if (prev && prev.token_uri !== r.tokenUri) dropCard.run(r.id); // new tokenURI = new card row; history kept
      ins.run({ id: r.id, owner: r.owner, wallet: r.agentWallet, uri: r.tokenUri, platform: r.platform, now, exists: r.exists });
    }
  })();
}

export async function scanAll(db, rpc, { log = () => {} } = {}) {
  const hint = +getMeta(db, 'top_id', 1);
  const top = await findTopId(rpc, hint);
  const t0 = Date.now(), m0 = rpc.stats().multicalls;
  await scanIds(rpc, 1, top, (rows) => upsertAgents(db, rows), (end, to) => { if (end % 2000 < config.idsPerBatch) log(`scan ${end}/${to}`); });
  setMeta(db, 'top_id', top); setMeta(db, 'last_scan_at', sec());
  return { top, multicalls: rpc.stats().multicalls - m0, ms: Date.now() - t0 };
}

export function refreshOwners(db, now = sec()) {
  db.exec('DELETE FROM owners WHERE owner NOT IN (SELECT owner FROM agents WHERE owner IS NOT NULL)');
  db.prepare(`INSERT INTO owners(owner, agent_count, checked_at)
    SELECT owner, COUNT(*), ? FROM agents WHERE "exists"=1 AND owner IS NOT NULL GROUP BY owner
    ON CONFLICT(owner) DO UPDATE SET agent_count=excluded.agent_count`).run(now);
}

export async function probeHosts(db, { probe = probeHost, log = () => {} } = {}) {
  const rows = db.prepare(`SELECT token_uri FROM agents WHERE "exists"=1 AND token_uri LIKE 'https://%'`).all();
  const counts = new Map();
  for (const r of rows) { const h = hostOf(r.token_uri); if (h) counts.set(h, (counts.get(h) || 0) + 1); }
  const now = sec(); const prev = new Map(db.prepare('SELECT host, dns_ok, down_since FROM hosts').all().map((r) => [r.host, r]));
  const up = db.prepare(`INSERT INTO hosts(host,dns_ok,down_since,last_probe_at,agent_count,note) VALUES(?,?,?,?,?,?)
    ON CONFLICT(host) DO UPDATE SET dns_ok=excluded.dns_ok, down_since=excluded.down_since, last_probe_at=excluded.last_probe_at, agent_count=excluded.agent_count, note=excluded.note`);
  const jobs = [...counts.keys()].map((h) => ({ key: '~probe', h, run: async () => probe(h) }));
  let done = 0;
  await runPaced(jobs, { global: 16, unlimitedKeys: () => true, onResult: (job, r) => {
    const p = prev.get(job.h);
    const downSince = r.dnsOk ? null : p && !p.dns_ok && p.down_since ? p.down_since : now;
    up.run(job.h, r.dnsOk ? 1 : 0, downSince, now, counts.get(job.h), r.note ?? null);
    if (++done % 50 === 0) log(`probed ${done}/${jobs.length}`);
  } });
  return { hosts: counts.size, down: db.prepare('SELECT COUNT(*) c FROM hosts WHERE dns_ok=0').get().c };
}

function storeCard(db, agent, obs, prevCard, now) {
  const res = livenessOf({ ...obs, tokenUri: agent.token_uri ?? '', now: now * 1000, prev: prevCard ? { failCount: prevCard.fail_count, firstFailAt: prevCard.first_fail_at ? prevCard.first_fail_at * 1000 : null } : undefined });
  const j = res.json; const raw = j ? JSON.stringify(j) : null;
  const trunc = raw && Buffer.byteLength(raw) > config.cardJsonStoreBytes;
  const endpoint = j ? (typeof j.url === 'string' && j.url.startsWith('https://') ? j.url : (Array.isArray(j.services) ? j.services.map((s) => s?.endpoint).find((e) => typeof e === 'string' && e.startsWith('https://')) : null)) || null : null;
  const retryH = res.status === 'live' ? 24 : res.status === 'opaque' ? 24 * 7 : res.failCount <= 1 ? 24 : res.failCount === 2 ? 48 : res.failCount === 3 ? 72 : 168;
  db.prepare(`INSERT INTO cards(id,status,reason,http_status,content_type,bytes,json,json_truncated,name,description,image,endpoint_url,self_consistent,redirect_host,fail_count,first_fail_at,checked_at,next_check_at)
    VALUES(@id,@status,@reason,@http,@ct,@bytes,@json,@trunc,@name,@desc,@image,@endpoint,@self,@redir,@fc,@ff,@now,@next)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, reason=excluded.reason, http_status=excluded.http_status, content_type=excluded.content_type,
      bytes=excluded.bytes, json=excluded.json, json_truncated=excluded.json_truncated, name=excluded.name, description=excluded.description, image=excluded.image,
      endpoint_url=excluded.endpoint_url, self_consistent=excluded.self_consistent, redirect_host=excluded.redirect_host, fail_count=excluded.fail_count,
      first_fail_at=excluded.first_fail_at, checked_at=excluded.checked_at, next_check_at=excluded.next_check_at`).run({
    id: agent.id, status: res.status, reason: res.reason, http: obs.httpStatus ?? null, ct: obs.contentType ?? null, bytes: obs.bytes ?? null,
    json: trunc ? raw.slice(0, config.cardJsonStoreBytes) : raw, trunc: trunc ? 1 : 0, name: res.name,
    desc: j && typeof j.description === 'string' ? j.description : null, image: j && typeof j.image === 'string' ? j.image : null, endpoint,
    self: j && selfConsistentOf(j, agent.id) ? 1 : 0, redir: obs.redirectHost ?? null, fc: res.failCount, ff: res.firstFailAt ? Math.floor(res.firstFailAt / 1000) : null,
    now, next: now + retryH * 3600 });
  db.prepare('INSERT INTO card_history(id,checked_at,status,reason) VALUES(?,?,?,?)').run(agent.id, now, res.status, res.reason);
  if (res.status === 'live') db.prepare('UPDATE agents SET first_seen_live_at=COALESCE(first_seen_live_at, ?) WHERE id=?').run(now, agent.id);
  return res.status;
}

/** Fetch every due card. Cards whose host failed the DNS probe are marked host-down without any per-card request. */
export async function checkCards(db, { observe = observeCard, limit = Infinity, log = () => {} } = {}) {
  const now = sec();
  const due = db.prepare(`SELECT a.id, a.token_uri, c.fail_count, c.first_fail_at, c.id AS has_card FROM agents a LEFT JOIN cards c ON c.id=a.id
    WHERE a."exists"=1 AND (c.id IS NULL OR c.next_check_at <= ?) ORDER BY a.id`).all(now + DUE_SLACK_SEC).slice(0, limit);
  const downHosts = new Set(db.prepare('SELECT host FROM hosts WHERE dns_ok=0').all().map((r) => r.host));
  const tally = {}; let n = 0, hostDown = 0;
  const bump = (s) => { tally[s] = (tally[s] || 0) + 1; if (++n % 500 === 0) log(`cards ${n}/${due.length} ${JSON.stringify(tally)}`); };
  const jobs = [];
  for (const a of due) {
    const prev = a.has_card ? { fail_count: a.fail_count, first_fail_at: a.first_fail_at } : null;
    const key = hostKeyOf(a.token_uri ?? '');
    if (schemeOf(a.token_uri ?? '') === 'https' && downHosts.has(key)) { hostDown++; bump(storeCard(db, a, { hostDown: true }, prev, now)); continue; }
    jobs.push({ key: key || 'x:', a, prev, run: async () => { const o = await observe(a.token_uri); return { ...o, rateLimited: o.httpStatus === 429 }; } });
  }
  await runPaced(jobs, { onResult: (job, r) => { if (r.crashed) return bump(storeCard(db, job.a, { error: 'crashed' }, job.prev, now)); bump(storeCard(db, job.a, r, job.prev, now)); } });
  setMeta(db, 'last_card_cycle_at', sec());
  return { checked: n, hostDown, tally };
}

export function computeScores(db, now = sec()) {
  const platformCount = new Map(db.prepare('SELECT platform p, COUNT(*) c FROM agents WHERE "exists"=1 GROUP BY platform').all().map((r) => [r.p, r.c]));
  const ownerCount = new Map(db.prepare('SELECT owner, agent_count c FROM owners').all().map((r) => [r.owner, r.c]));
  const nonce = new Map(db.prepare('SELECT owner, nonce FROM owners WHERE nonce IS NOT NULL').all().map((r) => [r.owner, r.nonce]));
  const probes = new Map(db.prepare('SELECT * FROM probes').all().map((r) => [r.id, r]));
  const pons = new Map(db.prepare('SELECT id, ca FROM pons_links').all().map((r) => [r.id, r.ca]));
  const rows = db.prepare(`SELECT a.id, a.owner, a.platform, a.first_seen_live_at fl, c.status, c.name, c.description, c.self_consistent sc, c.endpoint_url
    FROM agents a LEFT JOIN cards c ON c.id=a.id WHERE a."exists"=1`).all();
  const ins = db.prepare(`INSERT INTO scores(id,v,total,card,endpoint,age,owner,independence,pons,computed_at) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET v=excluded.v,total=excluded.total,card=excluded.card,endpoint=excluded.endpoint,age=excluded.age,owner=excluded.owner,independence=excluded.independence,pons=excluded.pons,computed_at=excluded.computed_at`);
  db.transaction(() => {
    db.exec(`DELETE FROM scores WHERE id NOT IN (SELECT id FROM agents WHERE "exists"=1)`);
    for (const r of rows) {
      const p = probes.get(r.id);
      const s = scoreOf({ id: r.id, status: r.status ?? 'unreachable', nameLen: (r.name || '').length, descLen: (r.description || '').length,
        imageOk: p ? !!p.image_ok : null, selfConsistent: !!r.sc, endpointOk: p ? !!p.endpoint_ok : null,
        observedDays: r.fl ? (now - r.fl) / DAY : 0, ownerNonce: nonce.get(r.owner) ?? null,
        platformCount: platformCount.get(r.platform) ?? 0, ownerAgentCount: ownerCount.get(r.owner) ?? 0, ponsCa: pons.get(r.id) ?? null });
      ins.run(r.id, s.v, s.total, s.parts.card, s.parts.endpoint, s.parts.age, s.parts.owner, s.parts.independence, s.parts.pons, now);
    }
  })();
  return rows.length;
}

export function liveCounts(db) {
  const c = Object.fromEntries(db.prepare(`SELECT COALESCE(c.status,'pending') s, COUNT(*) n FROM agents a LEFT JOIN cards c ON c.id=a.id WHERE a."exists"=1 GROUP BY s`).all().map((r) => [r.s, r.n]));
  return c;
}

export function writeStats(db, now = sec()) {
  const c = liveCounts(db);
  const registered = db.prepare('SELECT COUNT(*) n FROM agents WHERE "exists"=1').get().n;
  const platforms = db.prepare('SELECT COUNT(DISTINCT platform) n FROM agents WHERE "exists"=1').get().n;
  const day = new Date(now * 1000).toISOString().slice(0, 10);
  db.prepare(`INSERT INTO stats_daily(day,registered,live,unreachable,dead,opaque,platforms,computed_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(day) DO UPDATE SET registered=excluded.registered,live=excluded.live,unreachable=excluded.unreachable,dead=excluded.dead,opaque=excluded.opaque,platforms=excluded.platforms,computed_at=excluded.computed_at`)
    .run(day, registered, c.live || 0, (c.unreachable || 0) + (c['host-down'] || 0), c.dead || 0, c.opaque || 0, platforms, now);
  setMeta(db, 'computed_at', now);
}

export { isMassPlatform };
