// The only code that talks to the chain RPC. Pacing per class, timeout everywhere, retry 1s/4s/16s, circuit breaker.
import { config } from './config.mjs';
import { encodeAggregate3, decodeAggregate3, MULTICALL3 } from '../../shared/abi.mjs';

export class RpcError extends Error {
  constructor(kind, detail = '') { super(kind + (detail ? ': ' + detail : '')); this.kind = kind; }
}

export function makeRpc(o = {}) {
  const url = o.url ?? config.rpcUrl, doFetch = o.fetch ?? fetch, now = o.now ?? (() => Date.now());
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const backoffs = o.backoffs ?? [1000, 4000, 16000];
  const timeoutMs = o.timeoutMs ?? config.rpcTimeoutMs, circuitMs = o.circuitMs ?? 5 * 60_000, circuitAfter = o.circuitAfter ?? 5;
  const gaps = { multi: o.multicallGapMs ?? config.multicallGapMs, plain: o.plainGapMs ?? config.plainGapMs };
  const S = { fails: 0, openUntil: 0, last: { multi: 0, plain: 0 }, chain: { multi: Promise.resolve(), plain: Promise.resolve() }, calls: 0, multicalls: 0, plain: 0, okAt: null };
  let nextId = 1;

  const isOpen = () => now() < S.openUntil;

  async function attempt(method, params) {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await doFetch(url, { method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }) });
      if (!r.ok) throw new RpcError('http', String(r.status));
      const j = await r.json();
      if (j.error) throw new RpcError('rpc_error', j.error.message || JSON.stringify(j.error));
      return j.result;
    } catch (e) {
      if (e instanceof RpcError) throw e;
      throw new RpcError(e.name === 'AbortError' ? 'timeout' : 'network', e.message);
    } finally { clearTimeout(to); }
  }

  // One paced slot per class: calls of a class run strictly one at a time with a minimum gap.
  function slot(cls, fn) {
    const run = S.chain[cls].then(async () => {
      const wait = S.last[cls] + gaps[cls] - now();
      if (wait > 0) await sleep(wait);
      S.last[cls] = now();
      return fn();
    });
    S.chain[cls] = run.catch(() => {});
    return run;
  }

  async function send(cls, method, params) {
    if (isOpen()) throw new RpcError('circuit_open');
    return slot(cls, async () => {
      let lastErr;
      for (let i = 0; i <= backoffs.length; i++) {
        if (isOpen()) throw new RpcError('circuit_open');
        try {
          S.calls++; cls === 'multi' ? S.multicalls++ : S.plain++;
          const res = await attempt(method, params);
          S.fails = 0; S.okAt = now();
          return res;
        } catch (e) {
          lastErr = e;
          // an execution revert is an answer, not an outage
          if (e.kind === 'rpc_error' && /revert|execution|nonexist/i.test(e.message)) { S.fails = 0; throw e; }
          S.fails++;
          if (S.fails >= circuitAfter) { S.openUntil = now() + circuitMs; S.fails = 0; throw new RpcError('circuit_open', e.message); }
          if (i < backoffs.length) await sleep(backoffs[i]);
        }
      }
      throw lastErr;
    });
  }

  return {
    ethCall: (to, data) => send('plain', 'eth_call', [{ to, data }, 'latest']),
    nonce: (addr) => send('plain', 'eth_getTransactionCount', [addr, 'latest']),
    aggregate3: async (calls) => decodeAggregate3(await send('multi', 'eth_call', [{ to: MULTICALL3, data: encodeAggregate3(calls) }, 'latest'])),
    ok: () => !isOpen(),
    stats: () => ({ calls: S.calls, multicalls: S.multicalls, plain: S.plain, okAt: S.okAt, circuitOpen: isOpen() }),
  };
}
