// Full local crawl against the live RPC. Usage: node scripts/index.mjs [--state DIR] [--phase scan|cards|all] [--card-limit N]
import { openDb } from '../server/src/db.mjs';
import { makeRpc } from '../server/src/rpc.mjs';
import { config } from '../server/src/config.mjs';
import { probeImagesAndEndpoints, ownerNonces, ponsScan } from '../server/src/probes.mjs';
import { scanAll, refreshOwners, probeHosts, checkCards, computeScores, writeStats, liveCounts } from '../server/src/indexer.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg('state', config.stateDir), phase = arg('phase', 'all'), limit = +arg('card-limit', Infinity);
const db = openDb(dir + '/rollycall.db'), rpc = makeRpc();
const t0 = Date.now(), log = (m) => console.log(`[${((Date.now() - t0) / 60000).toFixed(1)}m] ${m}`);

if (phase === 'scan' || phase === 'all') {
  const r = await scanAll(db, rpc, { log });
  log(`SCAN top=${r.top} multicalls=${r.multicalls} plainRpc=${rpc.stats().plain} ms=${r.ms}`);
  refreshOwners(db);
  const h = await probeHosts(db, { log });
  log(`HOSTS ${JSON.stringify(h)}`);
}
if (phase === 'cards' || phase === 'all') {
  const r = await checkCards(db, { log, limit });
  log(`CARDS ${JSON.stringify(r)}`);
  computeScores(db); writeStats(db);
  log(`COUNTS ${JSON.stringify(liveCounts(db))}`);
}
if (phase === 'probes' || phase === 'all') {
  // weekly jobs; --probe-limit / --nonce-limit bound a local run (full runs take a long time at the polite rates)
  log(`PROBES ${JSON.stringify(await probeImagesAndEndpoints(db, { limit: +arg('probe-limit', Infinity), log }))}`);
  log(`NONCES ${JSON.stringify(await ownerNonces(db, rpc, { limit: +arg('nonce-limit', Infinity), log }))}`);
  log(`PONS ${JSON.stringify(await ponsScan(db, { log }))}`);
  computeScores(db); writeStats(db);
}
log(`RPC ${JSON.stringify(rpc.stats())}`);
