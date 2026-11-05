// Rollycall shared UI components — pure string builders, no Node or DOM imports.
// Used by server/src/pages/landing.mjs and available to every SSR page (APP may import).
// Class prefix `rc-`. Styles in web/src/styles/{tokens,base,components}.css.

export const DOMAIN = 'rollycall.xyz';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const fmtInt = (n) => (Number.isFinite(+n) && n !== null ? Math.round(+n).toLocaleString('en-US') : '—');
export const pct = (part, whole) => (whole > 0 ? (100 * part) / whole : 0);
export const fmtPct = (part, whole) => {
  const p = pct(part, whole);
  return p === 0 ? '0%' : p < 1 ? '<1%' : `${Math.round(p)}%`;
};

/** UTC timestamp → "2026-11-04 13:20 UTC" (never local time). */
export function fmtUtc(iso, { date = false } = {}) {
  if (iso == null || iso === '') return '—';
  const d = new Date(typeof iso === 'number' && iso < 1e12 ? iso * 1000 : iso);
  if (Number.isNaN(d.getTime())) return '—';
  const s = d.toISOString();
  return date ? s.slice(0, 10) : `${s.slice(0, 10)} ${s.slice(11, 16)} UTC`;
}
/** Date-only, for the launch date: "5 Nov 2026". Never prints an hour. */
export function fmtDay(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!m) return '';
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1];
  return `${+m[3]} ${mon} ${m[1]}`;
}
export const shortAddr = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : esc(a || ''));
export const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// ---------- status chip ----------
export const STATUS = {
  live: { label: 'Live', cls: 'live' },
  unreachable: { label: 'Unreachable', cls: 'unreach' },
  dead: { label: 'Dead', cls: 'dead' },
  opaque: { label: 'Not fetchable', cls: 'opaque' },
  'host-down': { label: 'Host unreachable', cls: 'hostdown' },
};
/**
 * statusChip('live', {checkedAt}) → chip. Shape glyph + word, never colour alone.
 * opts: checkedAt (ISO), failCount (n of 3), since (ISO, for dead), scheme (opaque), compact (bool: word only)
 */
export function statusChip(status, opts = {}) {
  const s = STATUS[status] || { label: esc(status || 'Unknown'), cls: 'unreach' };
  let label = s.label;
  if (!opts.compact) {
    if (status === 'unreachable' && opts.failCount) label += ` (${+opts.failCount}/3)`;
    if (status === 'dead' && opts.since) label += ` since ${fmtUtc(opts.since, { date: true })}`;
    if (status === 'opaque' && opts.scheme) label = `Card not fetchable (scheme <code>${esc(opts.scheme)}</code>)`;
  }
  const when = opts.checkedAt ? `<time class="rc-chip__t" datetime="${esc(opts.checkedAt)}">${status === 'live' ? 'checked ' : ''}${fmtUtc(opts.checkedAt)}</time>` : '';
  return `<span class="rc-chip rc-chip--${s.cls}"><i aria-hidden="true"></i><span>${label}</span></span>${when && !opts.compact ? when : ''}`;
}

// ---------- glossary tooltips ----------
export const TERMS = {
  live: 'Its agent-card URL answered HTTP 200 with valid JSON and a name, the last time we checked.',
  unreachable: 'The card fetch failed (DNS, timeout, 4xx/5xx, not JSON, no name) fewer than 3 times in a row.',
  dead: 'At least 3 consecutive failures spanning at least 72 hours.',
  opaque: 'The tokenURI uses a scheme we cannot fetch, e.g. priors:.',
  'host-down': 'The card host failed DNS on this cycle; cards on it count as unreachable.',
  mass: 'A platform hosting more than 1,000 agents. Labelled, not hidden.',
};
/** term('live') → word with a hover/focus tooltip (keyboard reachable). */
export const term = (key, word) => `<span class="rc-term" tabindex="0" data-tip="${esc(TERMS[key] || '')}">${esc(word || key)}</span>`;

export const massBadge = (count) =>
  `<span class="rc-badge rc-badge--mass" title="Mass platform: more than 1,000 agents on this host${count ? ` (${fmtInt(count)})` : ''}. Labelled, not hidden.">mass platform</span>`;

export const ponsChip = (p) =>
  p && p.ca ? `<a class="rc-badge rc-badge--pons" href="https://ponsfamily.com/launchpad/${esc(p.ca)}" rel="nofollow noopener" target="_blank" title="Pons-linked: the card names this Pons launch">Pons${p.symbol ? ` · ${esc(trunc(p.symbol, 10))}` : ''}</a>` : '';

/** Score number with a 10-cell meter (each cell = 10 points). */
export function scoreCell(total) {
  const t = Math.max(0, Math.min(100, Math.round(+total || 0)));
  const filled = Math.round(t / 10);
  const cells = Array.from({ length: 10 }, (_, i) => `<i${i < filled ? ' class="on"' : ''}></i>`).join('');
  return `<span class="rc-score"><b>${t}</b><span class="rc-score__m" aria-hidden="true">${cells}</span></span>`;
}

// ---------- copy box (curl / MCP install) ----------
let copyId = 0;
export function copyBox(cmd, { label = '', prompt = '$', id } = {}) {
  const i = id || `cp${++copyId}`;
  return `<div class="rc-copy">${label ? `<span class="rc-copy__l">${esc(label)}</span>` : ''}<div class="rc-copy__row"><code id="${i}"><span class="rc-copy__p" aria-hidden="true">${esc(prompt)} </span>${esc(cmd)}</code><button class="rc-btn rc-btn--copy" type="button" data-copy="${esc(cmd)}" aria-label="Copy command: ${esc(cmd)}">Copy</button></div></div>`;
}

// ---------- tally marks ----------
/** One five-bar gate. `colors` = up to 5 status classes for the strokes (4 vertical + 1 diagonal). */
export function tallyGate(classes, { size = 28 } = {}) {
  const xs = [5, 11, 17, 23];
  const strokes = classes.slice(0, 4).map((c, i) => `<line class="t-${c}" x1="${xs[i]}" y1="4" x2="${xs[i]}" y2="28" style="--i:${i}"/>`).join('');
  const diag = classes[4] ? `<line class="t-${classes[4]}" x1="1" y1="25" x2="27" y2="7" style="--i:4"/>` : '';
  return `<svg class="rc-gate" viewBox="0 0 28 32" width="${size}" height="${Math.round(size * 32 / 28)}" aria-hidden="true">${strokes}${diag}</svg>`;
}
/**
 * Tally board: one stroke per `per` agents, coloured by status in fixed order.
 * counts = {live, unreachable, dead, opaque}. Returns markup with role=img + text alternative.
 */
export function tallyBoard(counts, { per = 100 } = {}) {
  const order = [['live', 'live'], ['unreachable', 'unreach'], ['dead', 'dead'], ['opaque', 'opaque']];
  const marks = [];
  for (const [k, c] of order) { const n = Math.round((+counts[k] || 0) / per); for (let i = 0; i < n; i++) marks.push(c); }
  const gates = [];
  for (let i = 0; i < marks.length; i += 5) gates.push(tallyGate(marks.slice(i, i + 5)));
  const alt = order.map(([k]) => `${fmtInt(counts[k])} ${k}`).join(', ');
  return `<div class="rc-tally" role="img" aria-label="Tally, one stroke per ${per} agents: ${alt}">${gates.join('')}</div>`;
}

/** Stacked split bar, same order/colours as the tally. */
export function splitBar(counts, { label = '' } = {}) {
  const tot = ['live', 'unreachable', 'dead', 'opaque'].reduce((a, k) => a + (+counts[k] || 0), 0);
  const seg = (k, c) => { const w = pct(+counts[k] || 0, tot); return w > 0 ? `<i class="s-${c}" style="width:${w.toFixed(2)}%"></i>` : ''; };
  return `<span class="rc-split" role="img" aria-label="${esc(label)}${fmtInt(counts.live)} live of ${fmtInt(tot)}">${seg('live', 'live')}${seg('unreachable', 'unreach')}${seg('dead', 'dead')}${seg('opaque', 'opaque')}</span>`;
}

// ---------- agents table (dense) ----------
/** rows = /api/agents items. Renders a table that stacks into 2-line rows under 640 px (no horizontal scroll). */
export function agentsTable(rows, { caption = 'Agents', showCaption = false } = {}) {
  const tr = (a) => `<tr>
<td class="c-id"><a href="/agent/${+a.id}">#${fmtInt(a.id)}</a></td>
<td class="c-name"><a href="/agent/${+a.id}">${a.name ? esc(trunc(a.name, 48)) : `<span class="rc-muted">Agent #${+a.id} (no card name)</span>`}</a></td>
<td class="c-plat"><a href="/platform/${encodeURIComponent(a.platform || '')}">${esc(trunc(a.platform || '—', 28))}</a>${a.massPlatform ? ' ' + massBadge() : ''}</td>
<td class="c-status">${statusChip(a.status, { checkedAt: a.checkedAt })}</td>
<td class="c-score">${scoreCell(a.score?.total)}</td>
${a.ponsLink?.ca ? `<td class="c-pons">${ponsChip(a.ponsLink)}</td>` : '<td class="c-pons is-empty"><span class="rc-muted" aria-label="no Pons link">—</span></td>'}</tr>`;
  return `<div class="rc-tablewrap"><table class="rc-table rc-table--agents">
<caption${showCaption ? '' : ' class="sr-only"'}>${esc(caption)}</caption>
<thead><tr><th scope="col" class="c-id">#id</th><th scope="col" class="c-name">Name</th><th scope="col" class="c-plat">Platform</th><th scope="col" class="c-status">Status</th><th scope="col" class="c-score">Score</th><th scope="col" class="c-pons">Pons</th></tr></thead>
<tbody>${rows.map(tr).join('')}</tbody></table></div>`;
}

// ---------- score breakdown panel (for /agent/:id) ----------
export const SCORE_PARTS = [
  ['card', 45, 'Card'], ['endpoint', 10, 'Endpoint'], ['age', 15, 'Observed age'],
  ['owner', 15, 'Owner activity'], ['independence', 10, 'Independence'], ['pons', 5, 'Pons link'],
];
/**
 * score = {v, total, parts{…}, inputs{…}} from /api/agent/:id.
 * inputsText(partKey, inputs) → optional custom string per row; default prints the relevant raw inputs.
 */
export function scorePanel(score, { inputsText } = {}) {
  const parts = score?.parts || {}, inp = score?.inputs || {};
  const dflt = {
    card: () => `status ${inp.card?.status ?? inp.status ?? '—'} · name ${inp.nameLen ?? '—'} ch · description ${inp.descLen ?? '—'} ch · image ${yn(inp.imageOk)} · self-consistent ${yn(inp.selfConsistent)}`,
    endpoint: () => `endpoint ${yn(inp.endpointOk)}${inp.endpointUrl ? ` · ${esc(trunc(inp.endpointUrl, 48))}` : ''}`,
    age: () => `first seen live ${fmtUtc(inp.firstSeenLiveAt)}`,
    owner: () => `owner ${shortAddr(inp.owner)} · nonce ${fmtInt(inp.ownerNonce)}`,
    independence: () => `host ${esc(inp.platformHost ?? '—')} (${fmtInt(inp.platformCount)} agents) · owner holds ${fmtInt(inp.ownerAgentCount)}`,
    pons: () => (inp.ponsLink?.ca || inp.ca ? `token ${shortAddr(inp.ponsLink?.ca || inp.ca)}` : 'no verifiable token address'),
  };
  const rows = SCORE_PARTS.map(([k, max, name]) => {
    const v = Math.max(0, Math.min(max, +parts[k] || 0));
    const txt = inputsText ? inputsText(k, inp) : dflt[k]();
    return `<li class="rc-part"><span class="rc-part__n">${name}</span><span class="rc-part__bar" style="--max:${max}" aria-hidden="true"><i style="width:${(100 * v / max).toFixed(1)}%"></i></span><span class="rc-part__v"><b>${v}</b>/${max}</span><span class="rc-part__in">${txt}</span></li>`;
  }).join('');
  return `<section class="rc-scorepanel" aria-label="Score breakdown">
<header><span class="rc-eyebrow">Score v${esc(score?.v ?? '1')}</span><b class="rc-scorepanel__t">${Math.round(+score?.total || 0)}</b><span class="rc-muted">/ 100 = card + endpoint + age + owner + independence + pons</span></header>
<ol>${rows}</ol>
${disclaimer({ inline: true })}</section>`;
}
const yn = (b) => (b === true ? 'yes' : b === false ? 'no' : '—');

// ---------- disclaimer + footer ----------
export const DISCLAIMER = 'The score is our heuristic. It is not reputation, not an audit, and not endorsement.';
export const disclaimer = ({ inline = false } = {}) => `<p class="rc-disc${inline ? ' rc-disc--inline' : ''}"><span class="rc-disc__k">Heuristic</span> ${DISCLAIMER}</p>`;

export function siteNav({ path = '/', xHandle = '' } = {}) {
  const links = [['/agents', 'Agents'], ['/platforms', 'Platforms'], ['/docs', 'Docs'], ['/token', 'Token']];
  return `<header class="rc-nav"><div class="rc-wrap rc-nav__in">
<a class="rc-brand" href="/" aria-label="Rollycall home">${brandMark()}<span>Rollycall</span></a>
<nav aria-label="Main">${links.map(([h, l]) => `<a href="${h}"${path.startsWith(h) ? ' aria-current="page"' : ''}>${l}</a>`).join('')}${xHandle ? `<a href="https://x.com/${esc(xHandle)}" rel="noopener" target="_blank">X</a>` : ''}</nav></div></header>`;
}
export const brandMark = (s = 26) =>
  `<svg class="rc-mark" viewBox="0 0 32 32" width="${s}" height="${s}" aria-hidden="true"><rect x=".5" y=".5" width="31" height="31" rx="7" fill="#0B1211" stroke="#39E58C" stroke-opacity=".45"/><g stroke-linecap="round" stroke-width="2.6"><path d="M8 7v18M13 7v18M18 7v18M23 7v18" stroke="#E6F2EC"/><path d="M4.5 21.5L27.5 10.5" stroke="#39E58C"/></g></svg>`;

export function siteFooter({ xHandle = '' } = {}) {
  return `<footer class="rc-foot"><div class="rc-wrap">
<div class="rc-foot__top"><a class="rc-brand" href="/">${brandMark(22)}<span>Rollycall</span></a>
<nav aria-label="Footer"><a href="/agents">Agents</a><a href="/platforms">Platforms</a><a href="/docs">Docs</a><a href="/token">Token</a><a href="/api">API</a><a href="/llms.txt">llms.txt</a>${xHandle ? `<a href="https://x.com/${esc(xHandle)}" rel="noopener" target="_blank">X</a>` : ''}</nav></div>
${disclaimer()}
<p class="rc-foot__fine">Read-only. No wallet, no signature, no contract. Nothing to approve. ERC-8004 Identity Registry on Robinhood Chain (4663). Numbers refresh daily; times are UTC. No promise of returns.</p>
</div></footer>`;
}
