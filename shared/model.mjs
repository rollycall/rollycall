// Pure model functions: liveness (BRIEF §2.1), score (§2.2, v1), platform (§2.3), Pons link (§2.4).
import { parse as parseDomain } from 'tldts';
import { IDENTITY_REGISTRY, REPUTATION_REGISTRY, MULTICALL3, ZERO_ADDRESS } from './abi.mjs';

export const SCORE_V = '1';
export const MASS_THRESHOLD = 1000;
export const DEAD_AFTER_MS = 72 * 3600_000;
export const DEAD_AFTER_FAILS = 3;
export const MAX_CARD_BYTES = 512 * 1024;
export const REGISTRY_CAIP = `eip155:4663:${IDENTITY_REGISTRY}`;

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// L(x, cap) = clamp(100*log10(1+x)/log10(1+cap), 0, 100). Kept unrounded inside the score so the
// documented anchors hold exactly (nonce 0 -> 0, 1 -> 2, 30 -> 7, 1000 -> 15).
export const L = (x, cap) => clamp((100 * Math.log10(1 + Math.max(0, x))) / Math.log10(1 + cap), 0, 100);

// ---------------------------------------------------------------- 2.1 liveness
export function schemeOf(tokenUri) {
  const s = typeof tokenUri === 'string' ? tokenUri.trim() : '';
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(s);
  return m ? m[1].toLowerCase() : '';
}
export const isFetchableScheme = (u) => ['https', 'data', 'ipfs'].includes(schemeOf(u));

/**
 * livenessOf(obs): classify one card observation.
 * obs = { tokenUri, hostDown?, httpStatus?, error?, body?, truncated?, prev?: {failCount, firstFailAt}, now }
 *   error: 'dns' | 'timeout' | 'network' | 'bad_data_uri' | ... (fetch never produced a response)
 *   body: response text (already decoded for data:), truncated: body hit the 512 KB cap
 * -> { status, reason, failCount, firstFailAt, name, json }
 */
export function livenessOf(obs) {
  const now = obs.now ?? Date.now();
  const prev = obs.prev || {};
  const scheme = schemeOf(obs.tokenUri);
  if (!isFetchableScheme(obs.tokenUri)) {
    return { status: 'opaque', reason: scheme ? `scheme_${scheme}` : 'empty_uri', failCount: 0, firstFailAt: null, name: null, json: null };
  }
  const fail = (reason, hostDown = false) => {
    const failCount = (prev.failCount || 0) + 1;
    const firstFailAt = prev.firstFailAt ?? now;
    const dead = failCount >= DEAD_AFTER_FAILS && now - firstFailAt >= DEAD_AFTER_MS;
    return { status: dead ? 'dead' : hostDown ? 'host-down' : 'unreachable', reason, failCount, firstFailAt, name: null, json: null };
  };
  if (obs.hostDown) return fail('host_down', true);
  if (obs.error) return fail(obs.error);
  const isData = schemeOf(obs.tokenUri) === 'data';
  if (!isData) {
    const st = obs.httpStatus;
    if (st === 429) return fail('http_429');
    if (!(st >= 200 && st < 300) || st !== 200) return fail('http_' + st);
  }
  let json;
  try { json = JSON.parse(obs.body ?? ''); } catch { return fail(obs.truncated ? 'too_large' : 'not_json'); }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return fail('not_json');
  const name = typeof json.name === 'string' ? json.name.trim() : '';
  if (!name) return fail('no_name');
  return { status: 'live', reason: null, failCount: 0, firstFailAt: null, name, json };
}
export const isLive = (a) => a?.status === 'live';

// ---------------------------------------------------------------- 2.3 platform
const SHARED_HOSTS = ['fly.dev', 'vercel.app', 'github.io', 'workers.dev', 'netlify.app', 'pages.dev', 'herokuapp.com', 'onrender.com', 'railway.app', 'web.app', 'firebaseapp.com', 'repl.co', 'replit.app', 'glitch.me', 'ngrok.io', 'ngrok-free.app', 'trycloudflare.com'];
export function hostOf(tokenUri) {
  try { const u = new URL(tokenUri); return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.toLowerCase() : null; } catch { return null; }
}
/** -> { key, display, host|null, kind } */
export function platformOf(tokenUri) {
  const s = typeof tokenUri === 'string' ? tokenUri.trim() : '';
  const scheme = schemeOf(s);
  if (scheme === 'https' || scheme === 'http') {
    const host = hostOf(s);
    if (host) {
      const shared = SHARED_HOSTS.some((h) => host === h || host.endsWith('.' + h));
      let key = host;
      if (!shared) {
        const p = parseDomain(host);
        // eTLD+1 when the public-suffix list knows it; IPs and unknowns keep the host
        key = p.domain && !p.isIp ? p.domain : host;
      }
      return { key, display: key, host: key, kind: 'host' };
    }
  }
  if (scheme === 'data') return { key: 'data:', display: 'Self-contained (data URI)', host: null, kind: 'data' };
  if (scheme === 'ipfs') return { key: 'ipfs:', display: 'IPFS', host: null, kind: 'ipfs' };
  const k = scheme ? scheme + ':' : 'empty:';
  return { key: k, display: scheme ? `Custom scheme \`${k}\`` : 'Empty tokenURI', host: null, kind: 'custom' };
}
export const isMassPlatform = (count) => count > MASS_THRESHOLD;

// ---------------------------------------------------------------- 2.4 Pons link
const ADDR_RE = /0x[0-9a-fA-F]{40}/g;
function collectStrings(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out);
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) collectStrings(v[k], out);
}
/** Candidate token addresses (lowercase, document order, deduped, max 5) from card JSON + optional endpoint text (<= 256 KB). */
export function ponsCandidates(card, endpointText, exclude = {}) {
  const drop = new Set([IDENTITY_REGISTRY, REPUTATION_REGISTRY, MULTICALL3, ZERO_ADDRESS, exclude.owner, exclude.agentWallet].filter(Boolean).map((a) => a.toLowerCase()));
  const strings = [];
  collectStrings(card, strings);
  if (typeof endpointText === 'string' && endpointText.length <= 256 * 1024) strings.push(endpointText);
  const seen = new Set(), out = [];
  for (const s of strings) for (const m of s.match(ADDR_RE) || []) {
    const a = m.toLowerCase();
    if (drop.has(a) || seen.has(a)) continue;
    seen.add(a); out.push(a);
    if (out.length >= 5) return out;
  }
  return out;
}
/**
 * ponsLinkOf(card, endpointText, lookup, exclude): first candidate whose Pons lookup is a launch wins.
 * lookup(ca) -> pons body object (200) | null (404 / unknown). Sync or async. Returns link or null.
 */
export async function ponsLinkOf(card, endpointText, lookup, exclude = {}) {
  for (const ca of ponsCandidates(card, endpointText, exclude)) {
    const b = await lookup(ca);
    if (b && typeof b === 'object' && !b.error) {
      return { ca, symbol: b.symbol ?? null, name: b.name ?? null, marketCapUsd: b.marketCapUsd ?? null, volumeUsd: b.volumeUsd ?? null, tradeCount: b.tradeCount ?? null, stage: b.stage ?? null };
    }
  }
  return null;
}

// ---------------------------------------------------------------- 2.2 score
export const hostTier = (n) => (n <= 10 ? 10 : n <= 100 ? 7 : n <= 1000 ? 4 : 1);
export const ownerTier = (n) => (n <= 3 ? 10 : n <= 20 ? 6 : 2);
/** self-consistent: registrations[] has {agentId: id, agentRegistry: eip155:4663:<registry>} */
export function selfConsistentOf(card, id) {
  const regs = card && Array.isArray(card.registrations) ? card.registrations : [];
  return regs.some((r) => r && Number(r.agentId) === Number(id) && String(r.agentRegistry || '').toLowerCase() === REGISTRY_CAIP.toLowerCase());
}
/**
 * scoreOf(i): i = { id, status, nameLen, descLen, imageOk, selfConsistent, endpointOk, observedDays,
 *                   ownerNonce, platformCount, ownerAgentCount, ponsCa }
 * -> { v, total, parts{card,endpoint,age,owner,independence,pons}, inputs }
 */
export function scoreOf(i) {
  const live = i.status === 'live';
  let card = 0;
  if (live) {
    card = 30;
    if ((i.nameLen || 0) >= 3 && (i.descLen || 0) >= 40) card += 5;
    if (i.imageOk === true) card += 5;
    if (i.selfConsistent === true) card += 5;
  }
  const endpoint = i.endpointOk === true ? 10 : 0;
  const age = Math.round((15 * L(i.observedDays || 0, 90)) / 100);
  const owner = Math.round((15 * L(i.ownerNonce || 0, 1000)) / 100);
  const independence = Math.min(hostTier(i.platformCount ?? 0), ownerTier(i.ownerAgentCount ?? 0));
  const pons = i.ponsCa ? 5 : 0;
  const parts = { card, endpoint, age, owner, independence, pons };
  const total = card + endpoint + age + owner + independence + pons;
  return {
    v: SCORE_V, total, parts,
    inputs: {
      status: i.status, nameLen: i.nameLen || 0, descLen: i.descLen || 0, imageOk: i.imageOk ?? null, selfConsistent: !!i.selfConsistent,
      endpointOk: i.endpointOk ?? null, observedDays: i.observedDays || 0, ownerNonce: i.ownerNonce ?? null,
      platformCount: i.platformCount ?? null, ownerAgentCount: i.ownerAgentCount ?? null, ponsCa: i.ponsCa ?? null,
    },
  };
}
