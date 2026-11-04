// Re-check both IPFS gateways with a real registry CID. Usage: node scripts/probe-ipfs.mjs [cid]
import { httpGet } from '../server/src/fetcher.mjs';
import { config } from '../server/src/config.mjs';
const cid = process.argv[2] || process.env.PROBE_CID;
if (!cid) { console.error('pass a CID taken from a registry tokenURI (ipfs://<cid>)'); process.exit(2); }
for (const gw of config.ipfsGateways) {
  const t = Date.now();
  try { const r = await httpGet(gw + cid, { timeoutMs: 10000 }); console.log(gw, r.httpStatus, r.bytes + 'B', Date.now() - t + 'ms', r.redirectHost ? '-> ' + r.redirectHost : ''); }
  catch (e) { console.log(gw, 'FAIL', e.kind, Date.now() - t + 'ms'); }
}
