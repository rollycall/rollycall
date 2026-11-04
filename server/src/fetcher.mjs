// Card fetcher: host probe, per-host pacing, https / data: / ipfs: / opaque. Every network call has a timeout.
import dns from 'node:dns/promises';
import { config } from './config.mjs';
import { livenessOf, schemeOf, isFetchableScheme, hostOf } from '../../shared/model.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET with timeout, <=2 manual redirects, byte cap. -> {httpStatus, contentType, text, bytes, truncated, redirectHost} or throws {kind} */
export async function httpGet(url, { timeoutMs = config.cardTimeoutMs, maxBytes = config.cardMaxBytes, maxRedirects = 2, method = 'GET', fetchImpl = fetch } = {}) {
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    let cur = url, redirectHost = null;
    for (let hop = 0; ; hop++) {
      let r;
      try { r = await fetchImpl(cur, { method, redirect: 'manual', signal: ac.signal, headers: { accept: 'application/json', 'user-agent': config.userAgent } }); }
      catch (e) {
        const code = e?.cause?.code || '';
        throw { kind: e.name === 'AbortError' ? 'timeout' : /ENOTFOUND|EAI_AGAIN/.test(code) ? 'dns' : 'network', detail: code || e.message };
      }
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        if (hop >= maxRedirects) { r.body?.cancel?.().catch(() => {}); return { httpStatus: r.status, contentType: null, text: '', bytes: 0, truncated: false, redirectHost, tooManyRedirects: true }; }
        const next = new URL(r.headers.get('location'), cur); r.body?.cancel?.().catch(() => {});
        if (next.protocol !== 'https:') throw { kind: 'network', detail: 'redirect_non_https' };
        redirectHost = next.hostname; cur = next.href; continue;
      }
      const chunks = []; let bytes = 0, truncated = false;
      if (method !== 'HEAD' && r.body) {
        const reader = r.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            bytes += value.length; chunks.push(value);
            if (bytes > maxBytes) { truncated = true; reader.cancel().catch(() => {}); break; }
          }
        } catch (e) { throw { kind: e.name === 'AbortError' ? 'timeout' : 'network', detail: e.message }; }
      }
      const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      return { httpStatus: r.status, contentType: r.headers.get('content-type'), text: buf.subarray(0, maxBytes).toString('utf8'), bytes, truncated, redirectHost };
    }
  } finally { clearTimeout(to); }
}

export function decodeDataUri(uri) {
  const m = /^data:([^,]*),(.*)$/is.exec(uri);
  if (!m) return null;
  try { return /;base64/i.test(m[1]) ? Buffer.from(m[2], 'base64').toString('utf8') : decodeURIComponent(m[2]); } catch { return null; }
}

/** Host-level probe: one DNS lookup + one HEAD /. DNS failure => dnsOk=false. Other failures leave dnsOk=true. */
export async function probeHost(host, { timeoutMs = config.cardTimeoutMs } = {}) {
  const t = setTimeout(() => {}, 0); clearTimeout(t);
  try { await Promise.race([dns.lookup(host), sleep(timeoutMs).then(() => { throw { code: 'TIMEOUT' }; })]); }
  catch (e) { return { host, dnsOk: false, note: e.code || 'dns_error' }; }
  try { const r = await httpGet(`https://${host}/`, { method: 'HEAD', timeoutMs, maxRedirects: 2 }); return { host, dnsOk: true, note: 'http_' + r.httpStatus }; }
  catch (e) { return { host, dnsOk: true, note: e.kind || 'error' }; }
}

/** One card, one network observation (no pacing here). -> livenessOf input fields merged with raw facts */
export async function observeCard(tokenUri, opts = {}) {
  const uri = (tokenUri ?? '').trim(); const scheme = schemeOf(uri);
  if (!isFetchableScheme(uri)) return { tokenUri: uri };
  if (scheme === 'data') {
    const text = decodeDataUri(uri);
    if (text == null) return { tokenUri: uri, error: 'bad_data_uri' };
    return { tokenUri: uri, body: text, bytes: Buffer.byteLength(text), contentType: 'application/json' };
  }
  if (scheme === 'ipfs') {
    const path = uri.slice(7).replace(/^ipfs\//, '');
    if (!/^[A-Za-z0-9]/.test(path)) return { tokenUri: uri, error: 'bad_ipfs_uri' };
    let last = null;
    for (const gw of (opts.gateways ?? config.ipfsGateways)) {
      try {
        const r = await httpGet(gw + path, { timeoutMs: 10000 });
        if (r.httpStatus === 200) return { tokenUri: uri, httpStatus: 200, body: r.text, bytes: r.bytes, truncated: r.truncated, contentType: r.contentType };
        last = { tokenUri: uri, httpStatus: r.httpStatus, body: r.text, bytes: r.bytes, contentType: r.contentType };
      } catch (e) { last = { tokenUri: uri, error: e.kind || 'network' }; }
    }
    return last;
  }
  try {
    const r = await httpGet(uri);
    return { tokenUri: uri, httpStatus: r.httpStatus, body: r.text, bytes: r.bytes, truncated: r.truncated, contentType: r.contentType, redirectHost: r.redirectHost, redirected: !!r.redirectHost };
  } catch (e) { return { tokenUri: uri, error: e.kind || 'network' }; }
}

// ipfs cards share one paced queue (the gateway rate-limits bursts); other non-https schemes need no network and are unpaced
export const hostKeyOf = (tokenUri) => (schemeOf(tokenUri) === 'https' ? hostOf(tokenUri) : schemeOf(tokenUri) === 'ipfs' ? 'ipfs-gateway.local' : schemeOf(tokenUri) + ':');

/**
 * Run a queue of jobs {key, run()} with global concurrency, per-host concurrency and per-host start gap.
 * onResult(job, result). hostBackoff(key) -> ms to wait extra (429 handling) is driven by job.run result `.rateLimited`.
 */
export async function runPaced(jobs, { onResult, global = config.globalConcurrency, perHost = config.perHostConcurrency, gapMs = config.perHostGapMs, unlimitedKeys = (k) => !k.includes('.') } = {}) {
  const queues = new Map();
  for (const j of jobs) { if (!queues.has(j.key)) queues.set(j.key, []); queues.get(j.key).push(j); }
  const st = new Map([...queues.keys()].map((k) => [k, { inflight: 0, next: 0, backoff: 0, strikes: 0 }]));
  let running = 0, left = jobs.length;
  return new Promise((resolve) => {
    if (!left) return resolve();
    const tick = () => {
      const now = Date.now();
      for (const [key, q] of queues) {
        if (running >= global) break;
        const s = st.get(key); const lim = unlimitedKeys(key) ? 4 : perHost; const gap = unlimitedKeys(key) ? 0 : gapMs;
        while (q.length && s.inflight < lim && now >= s.next && now >= s.backoff && running < global) {
          const job = q.shift(); s.inflight++; running++; s.next = now + gap;
          job.run().then((res) => {
            if (res?.rateLimited) { s.strikes++; s.backoff = Date.now() + Math.min(8, 2 ** (s.strikes - 1)) * 60_000; } else if (res) s.strikes = 0;
            return onResult(job, res);
          }).catch((e) => onResult(job, { crashed: String(e?.message || e) })).finally(() => { s.inflight--; running--; if (--left === 0) { clearInterval(iv); resolve(); } });
          if (gap) break;
        }
      }
    };
    const iv = setInterval(tick, 25); tick();
  });
}
