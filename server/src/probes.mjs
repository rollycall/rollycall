// Weekly probes (image, endpoint), owner nonce queue, Pons link scan. Every network call has a timeout and goes through pacing.
import { httpGet, runPaced } from './fetcher.mjs';
import { ponsCandidates } from '../../shared/model.mjs';
import { config } from './config.mjs';

const sec = () => Math.floor(Date.now() / 1000);
const hostOfUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' ? x.hostname : null; } catch { return null; } };

/** HEAD then GET fallback; 2xx/3xx = ok. Returns {ok, text?} (text only for GET, <= 256 KB). */
export async function urlOk(url, { head = httpGet, wantText = false } = {}) {
  try {
    if (!wantText) { const h = await head(url, { method: 'HEAD', timeoutMs: 8000, maxBytes: 0 }); if (h.httpStatus >= 200 && h.httpStatus < 400) return { ok: true }; }
    const g = await head(url, { method: 'GET', timeoutMs: 8000, maxBytes: 256 * 1024 });
    return { ok: g.httpStatus >= 200 && g.httpStatus < 400, text: wantText ? g.text : undefined, contentType: g.contentType };
  } catch { return { ok: false }; }
}

export async function probeImagesAndEndpoints(db, { limit = Infinity, check = urlOk, log = () => {} } = {}) {
  const week = sec() - 7 * 86400;
  const rows = db.prepare(`SELECT c.id, c.image, c.endpoint_url FROM cards c LEFT JOIN probes p ON p.id=c.id
    WHERE c.status='live' AND (p.id IS NULL OR p.probed_at < ?) ORDER BY c.id`).all(week).slice(0, limit);
  const up = db.prepare(`INSERT INTO probes(id,image_ok,endpoint_ok,probed_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET image_ok=excluded.image_ok,endpoint_ok=excluded.endpoint_ok,probed_at=excluded.probed_at`);
  const jobs = rows.map((r) => ({ key: hostOfUrl(r.endpoint_url) || hostOfUrl(r.image) || 'x:', r, run: async () => {
    const img = r.image && /^https:/.test(r.image) ? (await check(r.image)).ok : r.image ? null : false;
    const ep = r.endpoint_url ? (await check(r.endpoint_url)).ok : false;
    return { img, ep };
  } }));
  let n = 0;
  await runPaced(jobs, { onResult: (job, res) => { if (res?.crashed) return; up.run(job.r.id, res.img === null ? null : +res.img, +res.ep, sec()); if (++n % 500 === 0) log(`probes ${n}/${jobs.length}`); } });
  return { probed: n };
}

/** eth_getTransactionCount for owners without a nonce (or older than a week), <= 4 r/s via the rpc client. */
export async function ownerNonces(db, rpc, { limit = Infinity, log = () => {} } = {}) {
  const week = sec() - 7 * 86400;
  const owners = db.prepare('SELECT owner FROM owners WHERE nonce IS NULL OR checked_at < ? ORDER BY (nonce IS NULL) DESC LIMIT ?').all(week, Number.isFinite(limit) ? limit : 1e9);
  const up = db.prepare('UPDATE owners SET nonce=?, checked_at=? WHERE owner=?'); let n = 0;
  for (const { owner } of owners) {
    try { up.run(Number(BigInt(await rpc.nonce(owner))), sec(), owner); } catch (e) { if (e.kind === 'circuit_open') break; continue; }
    if (++n % 500 === 0) log(`nonces ${n}/${owners.length}`);
  }
  return { checked: n, pending: owners.length - n };
}

/** Pons link: addresses in the stored card JSON -> ponsfamily.com lookup, positive and negative cached 7 days. */
export async function ponsScan(db, { lookup, limit = Infinity, log = () => {} } = {}) {
  const get = lookup ?? (async (ca) => {
    try { const r = await httpGet(`https://ponsfamily.com/api/launches/${ca}`, { timeoutMs: 5000, maxBytes: 64 * 1024 }); return r.httpStatus === 200 ? JSON.parse(r.text) : r.httpStatus === 404 ? null : undefined; } catch { return undefined; }
  });
  const now = sec();
  const rows = db.prepare(`SELECT c.id, c.json, a.owner, a.agent_wallet w FROM cards c JOIN agents a ON a.id=c.id WHERE c.status='live' AND c.json IS NOT NULL AND c.json LIKE '%0x%'`).all();
  const neg = db.prepare('SELECT until FROM pons_negative WHERE ca=?'), setNeg = db.prepare('INSERT INTO pons_negative(ca,until) VALUES(?,?) ON CONFLICT(ca) DO UPDATE SET until=excluded.until');
  const setLink = db.prepare(`INSERT INTO pons_links(id,ca,symbol,name,market_cap_usd,volume_usd,trade_count,stage,fetched_at) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET ca=excluded.ca,symbol=excluded.symbol,name=excluded.name,market_cap_usd=excluded.market_cap_usd,volume_usd=excluded.volume_usd,trade_count=excluded.trade_count,stage=excluded.stage,fetched_at=excluded.fetched_at`);
  let linked = 0, looked = 0, gap = 0;
  for (const r of rows.slice(0, limit)) {
    let card; try { card = JSON.parse(r.json); } catch { continue; } // truncated stored JSON is skipped
    for (const ca of ponsCandidates(card, null, { owner: r.owner, agentWallet: r.w })) {
      if ((neg.get(ca)?.until ?? 0) > now) continue;
      const wait = gap + 340 - Date.now(); if (wait > 0) await new Promise((x) => setTimeout(x, wait)); gap = Date.now(); looked++;
      const b = await get(ca);
      if (b === undefined) continue;                       // Pons down: keep what we have, retry later
      if (b === null) { setNeg.run(ca, now + 7 * 86400); continue; }
      setLink.run(r.id, ca, b.symbol ?? null, b.name ?? null, b.marketCapUsd ?? null, b.volumeUsd ?? null, b.tradeCount ?? null, b.stage ?? null, now); linked++; break;
    }
  }
  log(`pons looked ${looked} linked ${linked}`);
  return { looked, linked };
}
