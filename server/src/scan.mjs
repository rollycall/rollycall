// Top-id search and id scan through Multicall3 (ownerOf + tokenURI + getAgentWallet per id).
import { IDENTITY_REGISTRY, encodeOwnerOf, idCalls, decodeAddress, decodeString } from '../../shared/abi.mjs';
import { platformOf } from '../../shared/model.mjs';
import { config } from './config.mjs';

async function exists(rpc, id) {
  try { await rpc.ethCall(IDENTITY_REGISTRY, encodeOwnerOf(id)); return true; }
  catch (e) { if (e.kind === 'rpc_error') return false; throw e; }
}

/** Highest existing id. Starts at `hint` (last known top, or 1): gallop up, then binary search. Assumes ids are contiguous at the top. */
export async function findTopId(rpc, hint = 1) {
  let lo = Math.max(1, hint);
  if (!(await exists(rpc, lo))) { lo = 1; if (!(await exists(rpc, 1))) throw new Error('registry_empty'); }
  let step = 64, hi;
  for (;;) { // lo exists; find hi that does not
    const probe = lo + step;
    if (await exists(rpc, probe)) { lo = probe; step *= 2; } else { hi = probe; break; }
  }
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (await exists(rpc, mid)) lo = mid; else hi = mid; }
  return lo;
}

/** Scan ids [from..to]. Calls onBatch(rows) per multicall. rows: {id, exists, owner, tokenUri, agentWallet, platform} */
export async function scanIds(rpc, from, to, onBatch, onProgress) {
  for (let start = from; start <= to; start += config.idsPerBatch) {
    const end = Math.min(to, start + config.idsPerBatch - 1);
    const ids = []; const calls = [];
    for (let id = start; id <= end; id++) { ids.push(id); calls.push(...idCalls(id)); }
    let res;
    for (let tries = 0; ; tries++) { // a batch is retried after a pause; a long outage ends the scan with the error
      try { res = await rpc.aggregate3(calls); break; }
      catch (e) { if (tries >= 4) throw e; await new Promise((r) => setTimeout(r, e.kind === 'circuit_open' ? 60_000 : 20_000)); }
    }
    const rows = ids.map((id, i) => {
      const [o, u, w] = [res[i * 3], res[i * 3 + 1], res[i * 3 + 2]];
      if (!o.success) return { id, exists: 0, owner: null, tokenUri: null, agentWallet: null, platform: null };
      const tokenUri = u.success ? decodeString(u.returnData) : null;
      return { id, exists: 1, owner: decodeAddress(o.returnData), tokenUri, agentWallet: w.success ? decodeAddress(w.returnData) : null, platform: platformOf(tokenUri ?? '').key };
    });
    onBatch(rows);
    onProgress?.(end, to);
  }
}
