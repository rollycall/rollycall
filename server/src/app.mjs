import Fastify from 'fastify';
import { getMeta } from './db.mjs';
import { config } from './config.mjs';
import { platformOf, isMassPlatform, MASS_THRESHOLD, hostOf, scoreOf, SCORE_V } from '../../shared/model.mjs';
import { registerPages } from './routes-pages.mjs';
import { IDENTITY_REGISTRY } from '../../shared/abi.mjs';

const iso = (s) => (s ? new Date(s * 1000).toISOString() : null);
const UNREACH = ['unreachable', 'host-down'];
const STATUSES = ['live', 'unreachable', 'dead', 'opaque', 'host-down', 'pending'];
const ROUTES = ['/api', '/api/stats', '/api/agents', '/api/agent/:id', '/api/agent/:id/card', '/api/platforms', '/api/top', '/api/health'];

export function buildApp({ db, rpc = null, startedAt = Date.now(), pagesOpts = {} } = {}) {
  const app = Fastify({ logger: false });
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api')) { reply.header('Access-Control-Allow-Origin', '*'); if (!reply.hasHeader('cache-control')) reply.header('Cache-Control', 'public, max-age=60'); }
  });

  const topId = () => +getMeta(db, 'top_id', 0);
  const platformCounts = () => new Map(db.prepare('SELECT platform p, COUNT(*) c FROM agents WHERE "exists"=1 GROUP BY platform').all().map((r) => [r.p, r.c]));
  const safeInt = (v, d, lo, hi) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const pending = () => db.prepare(`SELECT COUNT(*) n FROM agents a LEFT JOIN cards c ON c.id=a.id WHERE a."exists"=1 AND (c.id IS NULL OR c.next_check_at <= strftime('%s','now'))`).get().n;

  app.get('/api', async () => ({ name: 'rollycall', version: config.version, routes: ROUTES, docs: `https://${config.domain}/docs`, llms: `https://${config.domain}/llms.txt`, mcp: 'claude mcp add rollycall -- npx -y rollycall-mcp' }));

  app.get('/api/stats', async () => {
    const c = Object.fromEntries(db.prepare(`SELECT COALESCE(c.status,'pending') s, COUNT(*) n FROM agents a LEFT JOIN cards c ON c.id=a.id WHERE a."exists"=1 GROUP BY s`).all().map((r) => [r.s, r.n]));
    const pc = platformCounts();
    const registered = db.prepare('SELECT COUNT(*) n FROM agents WHERE "exists"=1').get().n;
    return {
      registered, live: c.live || 0, unreachable: (c.unreachable || 0) + (c['host-down'] || 0), hostDown: c['host-down'] || 0, dead: c.dead || 0,
      opaque: c.opaque || 0, pending: c.pending || 0, platforms: pc.size, massPlatforms: [...pc.values()].filter(isMassPlatform).length,
      topId: topId(), computedAt: iso(+getMeta(db, 'computed_at', 0)), rpcOk: rpc ? rpc.ok() : true,
    };
  });

  const itemSelect = `SELECT a.id, a.owner, a.platform, c.status, c.checked_at, c.name, s.total, p.ca, p.symbol FROM agents a
    LEFT JOIN cards c ON c.id=a.id LEFT JOIN scores s ON s.id=a.id LEFT JOIN pons_links p ON p.id=a.id`;
  function listAgents(q, forced = {}) {
    const p = { ...q, ...forced };
    const where = ['a."exists"=1'], args = [];
    const status = p.live === '1' || p.live === 'true' ? 'live' : p.status;
    if (status && status !== 'any') {
      if (!STATUSES.includes(status)) return { error: 'bad_status' };
      if (status === 'pending') where.push('c.id IS NULL'); else { where.push('c.status=?'); args.push(status); }
    }
    if (p.platform) { where.push('a.platform=?'); args.push(String(p.platform)); }
    if (p.pons === '1') where.push('p.id IS NOT NULL');
    if (p.mass === 'exclude') {
      const mass = [...platformCounts()].filter(([, n]) => isMassPlatform(n)).map(([k]) => k);
      if (mass.length) { where.push(`a.platform NOT IN (${mass.map(() => '?').join(',')})`); args.push(...mass); }
    }
    if (p.q) {
      const t = String(p.q).trim().slice(0, 100);
      if (/^#?\d+$/.test(t)) { where.push('a.id=?'); args.push(+t.replace('#', '')); }
      else { const like = '%' + t.toLowerCase().replace(/[\\%_]/g, (m) => '\\' + m) + '%'; where.push(`(lower(c.name) LIKE ? ESCAPE '\\' OR lower(c.description) LIKE ? ESCAPE '\\')`); args.push(like, like); }
    }
    const sort = p.sort || 'score';
    const order = { score: 's.total DESC, a.id ASC', id: 'a.id ASC', newest: 'a.id DESC', age: 'a.first_seen_live_at IS NULL, a.first_seen_live_at ASC, a.id ASC' }[sort];
    if (!order) return { error: 'bad_sort' };
    const limit = safeInt(p.limit, 50, 1, 50);
    let offset = 0;
    if (p.cursor) { offset = safeInt(Buffer.from(String(p.cursor), 'base64url').toString(), -1, -1, 1e9); if (offset < 0) return { error: 'bad_cursor' }; }
    const W = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) n FROM agents a LEFT JOIN cards c ON c.id=a.id LEFT JOIN scores s ON s.id=a.id LEFT JOIN pons_links p ON p.id=a.id WHERE ${W}`).get(...args).n;
    const rows = db.prepare(`${itemSelect} WHERE ${W} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);
    const pc = platformCounts();
    const items = rows.map((r) => ({
      id: r.id, name: r.name, platform: r.platform, status: r.status ?? 'pending', checkedAt: iso(r.checked_at), score: { total: r.total ?? 0 },
      owner: r.owner, ponsLink: r.ca ? { ca: r.ca, symbol: r.symbol } : null, massPlatform: isMassPlatform(pc.get(r.platform) || 0),
    }));
    return { items, cursor: offset + limit < total ? Buffer.from(String(offset + limit)).toString('base64url') : null, total };
  }

  app.get('/api/agents', async (req, reply) => {
    const r = listAgents(req.query);
    if (r.error) return reply.code(400).send({ error: r.error });
    return r;
  });
  app.get('/api/top', async (req, reply) => {
    const mass = req.query.mass === 'include' ? 'include' : 'exclude';
    const r = listAgents({ ...req.query, limit: req.query.limit || 20 }, { live: '1', sort: 'score', mass, cursor: undefined });
    if (r.error) return reply.code(400).send({ error: r.error });
    return { items: r.items, filters: { live: true, mass, platform: req.query.platform || null, sort: 'score' }, total: r.total };
  });

  const notFound = (reply) => reply.code(404).send({ error: 'no_such_agent', topId: topId() });
  const parseId = (s) => (/^[1-9]\d{0,9}$/.test(s) ? +s : null);

  app.get('/api/agent/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const a = id && db.prepare('SELECT * FROM agents WHERE id=?').get(id);
    if (!a) return notFound(reply);
    if (!a.exists) return reply.code(404).send({ error: 'burned_or_nonexistent', topId: topId() });
    const c = db.prepare('SELECT * FROM cards WHERE id=?').get(id);
    const pr = db.prepare('SELECT * FROM probes WHERE id=?').get(id);
    const ow = db.prepare('SELECT * FROM owners WHERE owner=?').get(a.owner);
    const pons = db.prepare('SELECT * FROM pons_links WHERE id=?').get(id);
    const pc = platformCounts(); const count = pc.get(a.platform) || 0;
    let json = null; try { json = c?.json && !c.json_truncated ? JSON.parse(c.json) : null; } catch { /* stored text may be truncated */ }
    const now = Math.floor(Date.now() / 1000);
    const score = scoreOf({ id, status: c?.status ?? 'unreachable', nameLen: (c?.name || '').length, descLen: (c?.description || '').length,
      imageOk: pr ? !!pr.image_ok : null, selfConsistent: !!c?.self_consistent, endpointOk: pr ? !!pr.endpoint_ok : null,
      observedDays: a.first_seen_live_at ? (now - a.first_seen_live_at) / 86400 : 0, ownerNonce: ow?.nonce ?? null,
      platformCount: count, ownerAgentCount: ow?.agent_count ?? 0, ponsCa: pons?.ca ?? null });
    return {
      id, owner: a.owner, agentWallet: a.agent_wallet, tokenUri: a.token_uri,
      platform: { host: a.platform, count, massPlatform: isMassPlatform(count) },
      card: { status: c?.status ?? 'pending', reason: c?.reason ?? null, httpStatus: c?.http_status ?? null, checkedAt: iso(c?.checked_at), name: c?.name ?? null,
        description: c?.description ?? null, image: c?.image ?? null, services: json && Array.isArray(json.services) ? json.services : [],
        registrations: json && Array.isArray(json.registrations) ? json.registrations : [], failCount: c?.fail_count ?? 0, firstFailAt: iso(c?.first_fail_at), raw: `/api/agent/${id}/card` },
      probes: { imageOk: pr ? !!pr.image_ok : null, endpointOk: pr ? !!pr.endpoint_ok : null, probedAt: iso(pr?.probed_at) },
      ownerStats: { nonce: ow?.nonce ?? null, agentCount: ow?.agent_count ?? null, checkedAt: iso(ow?.checked_at) },
      ponsLink: pons ? { ca: pons.ca, symbol: pons.symbol, name: pons.name, marketCapUsd: pons.market_cap_usd, volumeUsd: pons.volume_usd, tradeCount: pons.trade_count, stage: pons.stage, fetchedAt: iso(pons.fetched_at) } : null,
      score: { ...score, inputs: { ...score.inputs, firstSeenLiveAt: iso(a.first_seen_live_at), owner: a.owner, platformHost: a.platform, endpointUrl: c?.endpoint_url ?? null, ponsLink: pons ? { ca: pons.ca } : null } },
      history: db.prepare('SELECT checked_at, status, reason FROM card_history WHERE id=? ORDER BY checked_at DESC LIMIT 30').all(id).map((h) => ({ checkedAt: iso(h.checked_at), status: h.status, reason: h.reason })),
      firstSeenAt: iso(a.first_seen_at), firstSeenLiveAt: iso(a.first_seen_live_at),
      reputation: { readable: false, note: 'Reputation Registry has no readable events on chain 4663' },
      verify: [`cast call ${IDENTITY_REGISTRY} "ownerOf(uint256)(address)" ${id} --rpc-url https://robinhood-rpc.publicnode.com`, `cast call ${IDENTITY_REGISTRY} "tokenURI(uint256)(string)" ${id} --rpc-url https://robinhood-rpc.publicnode.com`],
      note: 'score is a Rollycall heuristic; verify with the cast lines in verify[]',
    };
  });

  app.get('/api/agent/:id/card', async (req, reply) => {
    const id = parseId(req.params.id);
    const a = id && db.prepare('SELECT id FROM agents WHERE id=? AND "exists"=1').get(id);
    if (!a) return notFound(reply);
    const c = db.prepare('SELECT * FROM cards WHERE id=?').get(id);
    if (!c) return reply.code(404).send({ error: 'no_card_yet' });
    let raw = null; if (c.json) { try { raw = JSON.parse(c.json); } catch { raw = c.json; } }
    return { raw, fetchedAt: iso(c.checked_at), httpStatus: c.http_status, contentType: c.content_type, bytes: c.bytes, truncated: !!c.json_truncated, status: c.status, reason: c.reason };
  });

  app.get('/api/platforms', async () => {
    const rows = db.prepare(`SELECT a.platform p, a.id, COALESCE(c.status,'pending') s FROM agents a LEFT JOIN cards c ON c.id=a.id WHERE a."exists"=1 ORDER BY a.id`).all();
    const by = new Map();
    for (const r of rows) {
      let e = by.get(r.p); if (!e) by.set(r.p, e = { host: r.p, count: 0, live: 0, dead: 0, unreachable: 0, opaque: 0, pending: 0, sampleIds: [] });
      e.count++;
      if (r.s === 'live') e.live++; else if (r.s === 'dead') e.dead++; else if (UNREACH.includes(r.s)) e.unreachable++; else if (r.s === 'opaque') e.opaque++; else e.pending++;
      if (e.sampleIds.length < 3) e.sampleIds.push(r.id);
    }
    const hostRows = db.prepare('SELECT * FROM hosts').all();
    const hostsBy = new Map();
    for (const h of hostRows) { const k = platformOf('https://' + h.host + '/').key; (hostsBy.get(k) || hostsBy.set(k, []).get(k)).push(h); }
    return [...by.values()].sort((x, y) => y.count - x.count || (x.host < y.host ? -1 : 1)).map((e) => {
      const hs = hostsBy.get(e.host);
      const down = hs && hs.every((h) => !h.dns_ok);
      const meta = platformOf(e.host.includes(':') ? e.host : 'https://' + e.host + '/');
      return { ...e, display: e.host.endsWith(':') ? meta.display : e.host, massPlatform: isMassPlatform(e.count),
        dnsOk: hs ? !down : null, downSince: down ? iso(Math.min(...hs.map((h) => h.down_since || Infinity).filter(Number.isFinite))) : null,
        lastProbeAt: hs ? iso(Math.max(...hs.map((h) => h.last_probe_at || 0))) : null };
    });
  });

  app.get('/api/health', async () => ({
    ok: !rpc || rpc.ok(), topId: topId(), lastScanAt: iso(+getMeta(db, 'last_scan_at', 0)), lastCardCycleAt: iso(+getMeta(db, 'last_card_cycle_at', 0)),
    rpcOk: rpc ? rpc.ok() : true, cardQueue: pending(), uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
  }));

  app.post('/api/holder/check', async () => ({ enabled: false }));
  app.get('/api/export.csv', async (req, reply) => reply.code(404).send({ error: 'not_found' }));

  registerPages(app, pagesOpts);

  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api') ? reply.code(404).send({ error: 'not_found' }) : reply.code(404).type('text/plain').send('Not counted.')));
  return app;
}
export { MASS_THRESHOLD, SCORE_V, hostOf };
