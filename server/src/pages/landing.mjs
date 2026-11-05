// Rollycall landing — `/` (owner: LANDING). Pure string template, isomorphic:
// runs in Node (SSR) and in the browser (web/src/landing/preview.html renders it from fixtures).
// Reads ONLY the frozen interface (BRIEF §9.1): /api/stats, /api/top?limit=3&mass=exclude, /api/agents?limit=10, /api/platforms.
//
// SSR usage (APP):
//   import { loadLandingData, landingPage } from './landing.mjs';
//   const data = await loadLandingData((p) => internalGet(p));        // p = '/api/stats' etc., returns parsed JSON or throws
//   reply.type('text/html').send(landingPage(data, { siteUrl, token: tokenJson, xHandle: 'rollycallagent' }));
import {
  esc, fmtInt, fmtPct, fmtUtc, fmtDay, trunc, DOMAIN,
  statusChip, massBadge, scoreCell, copyBox, splitBar, agentsTable, term,
  siteNav, siteFooter, brandMark,
} from '../../../web/src/styles/components.mjs';

export const LANDING_ENDPOINTS = {
  stats: '/api/stats',
  top: '/api/top?limit=3&mass=exclude',
  agents: '/api/agents?limit=10',
  platforms: '/api/platforms',
};
export const MCP_LINE = 'claude mcp add rollycall -- npx -y rollycall-mcp';
export const MCP_TOOLS = ['search_agents', 'get_agent', 'list_platforms', 'top_agents'];

/** get(path) → Promise<json>. A failed endpoint becomes null; the section then renders an honest empty state (never fake zeros). */
export async function loadLandingData(get) {
  const keys = Object.keys(LANDING_ENDPOINTS);
  const res = await Promise.allSettled(keys.map((k) => get(LANDING_ENDPOINTS[k])));
  const out = {};
  keys.forEach((k, i) => { out[k] = res[i].status === 'fulfilled' ? res[i].value : null; });
  return out;
}

const itemsOf = (x) => (Array.isArray(x) ? x : Array.isArray(x?.items) ? x.items : []);
const empty = (msg) => `<div class="lx-empty" role="status"><span class="lx-empty__i" aria-hidden="true"></span>${msg}</div>`;

const searchForm = (id = 'lx-q') => `<form class="lx-search" action="/agents" method="get" role="search"><label class="sr-only" for="${id}">Search agents by name or #id</label>
<span class="lx-search__p" aria-hidden="true">›</span><input id="${id}" name="q" type="search" placeholder="name or #id" autocomplete="off" enterkeyhint="search"><input type="hidden" name="live" value="1"><button class="lx-search__b" type="submit">Search</button></form>`;

// ---------- 1 · hero: the radar + the alive number ----------
function hero(stats) {
  if (!stats) {
    return `<section class="lx-hero"><div class="rc-wrap"><p class="rc-eyebrow">ERC-8004 · Robinhood Chain 4663</p><h1 class="lx-h1">ERC-8004 agents on Robinhood Chain, counted daily.</h1>
${empty('The index is not readable right now. Numbers return with the next good scan; nothing here is a placeholder count.')}${searchForm()}</div></section>`;
  }
  const reg = +stats.registered || 0;
  return `<section class="lx-hero" aria-labelledby="lx-h1"><div class="rc-wrap lx-hero__grid">
<div class="lx-hero__copy">
<p class="rc-eyebrow"><span class="lx-dot" aria-hidden="true"></span>Roll call · ERC-8004 · Robinhood Chain 4663</p>
<h1 class="lx-h1" id="lx-h1"><span class="lx-h1__reg"><span data-count="${reg}">${fmtInt(reg)}</span> registered.</span> <span class="lx-h1__live"><span data-count="${+stats.live || 0}">${fmtInt(stats.live)}</span> alive.</span></h1>
<p class="lx-sub">ERC-8004 agents on Robinhood Chain, counted daily. No wallet, no login.</p>
${searchForm()}
<div class="lx-cta"><a class="rc-btn" href="/agents?live=1">Browse live agents</a><a class="lx-link" href="#mcp">Install the MCP <span aria-hidden="true">→</span></a></div>
<p class="lx-computed"><span>computed <time datetime="${esc(stats.computedAt || '')}">${fmtUtc(stats.computedAt)}</time></span><span>top id #${fmtInt(stats.topId)}</span>${stats.rpcOk === false ? '<span class="lx-warn">RPC paused · serving last good scan</span>' : ''}</p>
</div>
<figure class="lx-radar">
<div class="lx-radar__disc"><canvas data-radar data-live="${+stats.live || 0}" data-unreachable="${+stats.unreachable || 0}" data-dead="${+stats.dead || 0}" data-opaque="${+stats.opaque || 0}" aria-hidden="true"></canvas>
<span class="lx-radar__hud lx-radar__hud--tl" aria-hidden="true">SWEEP · DAILY</span><span class="lx-radar__hud lx-radar__hud--br" aria-hidden="true">${fmtPct(stats.live, reg)} ANSWER</span></div>
<figcaption>One dot per registered agent (${fmtInt(reg)}). Colours are today's exact counts; dot positions are not ids.</figcaption>
</figure>
</div></section>`;
}

// ---------- 2 · proof: three numbers + the split ----------
function proof(stats, platforms) {
  if (!stats) return '';
  const reg = +stats.registered || 0;
  const bad = (+stats.unreachable || 0) + (+stats.dead || 0) + (+stats.opaque || 0);
  const big = [
    ['Registered', reg, `ids 1 … ${fmtInt(stats.topId)} in the Identity Registry`, ''],
    [term('live', 'Live'), stats.live, `${fmtPct(stats.live, reg)} of registered`, 'live'],
    ['Platforms', stats.platforms, `${fmtInt(stats.massPlatforms)} ${term('mass', 'mass platforms')}`, ''],
  ].map(([l, n, d, c]) => `<div class="lx-big${c ? ' lx-big--' + c : ''}"><dt>${l}</dt><dd><b data-count="${+n || 0}">${fmtInt(n)}</b><span>${d}</span></dd></div>`).join('');
  const rows = [
    ['unreachable', 'Unreachable', stats.unreachable, 'unreach'],
    ['dead', 'Dead', stats.dead, 'dead'],
    ['opaque', 'Not fetchable', stats.opaque, 'opaque'],
  ].map(([k, l, n, c]) => `<li class="lx-st lx-st--${c}"><span class="rc-chip rc-chip--${c}"><i aria-hidden="true"></i><span>${term(k, l)}</span></span><b>${fmtInt(n)}</b><span class="lx-st__p">${fmtPct(n, reg)}</span></li>`).join('');
  const mass = itemsOf(platforms).filter((p) => p.massPlatform).slice(0, 3).map((p) => {
    const state = p.dnsOk === false
      ? `${statusChip('host-down', { compact: true })}<span class="lx-nw">probed ${fmtUtc(p.lastProbeAt)}</span>`
      : `<span>${fmtInt(p.live)} live (${fmtPct(p.live, p.count)})</span>`;
    return `<li><a href="/platform/${encodeURIComponent(p.host)}" class="lx-mass__h">${esc(p.host)}</a><span class="lx-mass__n"><b>${fmtInt(p.count)}</b> cards</span><span class="lx-mass__s">${state}</span></li>`;
  }).join('');
  return `<section class="rc-section lx-proof" aria-labelledby="pf-h"><div class="rc-wrap lx-proof__grid">
<div class="lx-proof__h rc-reveal"><p class="rc-eyebrow">The count</p><h2 id="pf-h">Who answered the roll.</h2>
<p class="lx-lead">${term('live', 'Live')} means: its agent-card URL answered HTTP 200 with valid JSON and a name, the last time we checked (timestamp shown).</p></div>
<div class="lx-proof__body rc-reveal">
<dl class="lx-bigs">${big}</dl>
${splitBar({ live: stats.live, unreachable: stats.unreachable, dead: stats.dead, opaque: stats.opaque }, { label: 'Split: ' })}
<ul class="lx-sts" aria-label="${fmtInt(bad)} did not answer">${rows}</ul>
${mass ? `<div class="lx-mass"><p class="rc-eyebrow lx-mass__t">Mass platforms · labelled, not hidden</p><ul>${mass}</ul></div>` : ''}
</div></div></section>`;
}

// ---------- 3 · try: top 3 + curl ----------
function tryIt(top, o) {
  const rows = itemsOf(top).slice(0, 3);
  const chips = rows.length
    ? rows.map((a, i) => `<li><a class="lx-top" href="/agent/${+a.id}"><span class="lx-top__r">0${i + 1}</span><span class="lx-top__m"><b>${esc(trunc(a.name || `Agent #${a.id}`, 34))}</b><span class="mono">#${fmtInt(a.id)} · ${esc(trunc(a.platform || '', 24))}</span></span>${scoreCell(a.score?.total ?? a.score)}</a></li>`).join('')
    : `<li>${empty('Top list not available right now.')}</li>`;
  return `<section class="rc-section lx-try" id="try" aria-labelledby="try-h"><div class="rc-wrap lx-try__grid">
<div class="rc-reveal"><p class="rc-eyebrow">Try it</p><h2 id="try-h">Ask the API. No key.</h2><p class="lx-lead">Public JSON API, no key. Open the card yourself: raw tokenURI and the fetched JSON are on every agent page.</p>
${copyBox(`curl https://${o.domain}/api/agents?live=1&limit=20`, { label: 'curl' })}</div>
<div class="lx-glass rc-reveal"><p class="lx-glass__h"><span class="rc-eyebrow">Top 3 by score</span><span class="rc-muted">mass platforms excluded</span></p><ol class="lx-tops">${chips}</ol><a class="rc-more" href="/agents">Full ranking →</a></div>
</div></section>`;
}

// ---------- 4 · MCP ----------
function mcpBox(o) {
  const tr = Array.isArray(o.mcpTranscript) && o.mcpTranscript.length
    ? `<figure class="lx-term rc-reveal"><figcaption><span class="lx-term__dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${esc(o.mcpTranscriptLabel || 'Transcript')}</span></figcaption><pre><code>${o.mcpTranscript.slice(0, 6).map((l) => esc(l)).join('\n')}</code></pre></figure>`
    : '';
  return `<section class="rc-section lx-mcp" id="mcp" aria-labelledby="mcp-h"><div class="rc-wrap lx-mcp__grid${tr ? '' : ' lx-mcp__grid--solo'}">
<div class="rc-reveal"><p class="rc-eyebrow">For agents</p><h2 id="mcp-h">For agents: one line.</h2><p class="lx-lead">An MCP server over the same public API. Tools: search_agents, get_agent, list_platforms, top_agents.</p>
${copyBox(MCP_LINE, { label: 'Claude Code' })}
<ul class="lx-tools" aria-label="Tools">${MCP_TOOLS.map((t) => `<li><code>${t}</code></li>`).join('')}</ul></div>
${tr}
</div></section>`;
}

// ---------- 5 · token slot ----------
function tokenSlot(t, o) {
  t = t || {};
  const sym = t.tickerPublic && t.symbol ? `$${esc(t.symbol)}` : '';
  const x = o.xHandle ? ` and on <a href="https://x.com/${esc(o.xHandle)}" rel="noopener" target="_blank">@${esc(o.xHandle)}</a>` : '';
  const realCa = /^0x[0-9a-fA-F]{40}$/.test(t.ca || '') && !/^0x0{40}$/.test(t.ca);
  if (t.launched && realCa) {
    return `<section class="lx-token" aria-label="Token"><div class="rc-wrap"><div class="lx-token__in lx-glass">
<span class="lx-token__sym">${sym || 'Token'}</span>
${copyBox(t.ca, { label: 'Contract address', prompt: 'CA' })}
<a class="rc-btn" href="https://ponsfamily.com/launchpad/${esc(t.ca.toLowerCase())}" rel="noopener" target="_blank">Buy on Pons</a>
<p class="lx-token__note">The only official CA is the one on this page${x}. No promise of returns.</p></div></div></section>`;
  }
  const day = fmtDay(t.launchDate);
  return `<section class="lx-token" aria-label="Token"><div class="rc-wrap"><div class="lx-token__in lx-glass">
${sym ? `<span class="lx-token__sym">${sym}</span>` : ''}${day ? `<span class="lx-token__day">Launch ${esc(day)}</span>` : ''}
<p class="lx-token__note"><b>No token yet.</b> Everything here is open to everyone. No contract address is published before launch; the official one will be on this page${x}.</p></div></div></section>`;
}

// ---------- 6 · ledger ----------
function agentsPreview(agents) {
  const rows = itemsOf(agents).slice(0, 10);
  const total = agents && agents.total != null ? `${fmtInt(agents.total)} in the index` : '';
  return `<section class="rc-section lx-ledger" aria-labelledby="ag-h"><div class="rc-wrap">
<div class="rc-section__h rc-reveal"><div><p class="rc-eyebrow">The ledger</p><h2 id="ag-h">Ranked by a score you can recompute.</h2><p>card 45 · endpoint 10 · observed age 15 · owner activity 15 · independence 10 · Pons link 5.</p></div><a class="rc-more" href="/agents">All agents${total ? ` · ${total}` : ''} →</a></div>
<div class="lx-ledger__t rc-reveal"><p class="lx-prompt" aria-hidden="true"><span>$</span> rollycall top --limit 10</p>
${rows.length ? agentsTable(rows, { caption: 'Top of the agent ledger' }) : empty('The agent list is not available right now.')}</div>
<p class="rc-disc"><span class="rc-disc__k">Heuristic</span> The score is our heuristic. It is not reputation, not an audit, and not endorsement.</p>
</div></section>`;
}

// ---------- 7 · platforms ----------
function platformsStrip(platforms) {
  const all = itemsOf(platforms);
  const rows = all.slice(0, 8);
  if (!rows.length) return '';
  const max = Math.max(...rows.map((p) => +p.count || 0), 1);
  const li = rows.map((p) => `<li class="lx-plat">
<span class="lx-plat__h"><a href="/platform/${encodeURIComponent(p.host)}">${esc(trunc(p.display && !p.display.includes(' ') ? p.display : p.host, 30))}</a>${p.massPlatform ? massBadge(p.count) : ''}${p.dnsOk === false ? statusChip('host-down', { compact: true }) : ''}</span>
<span class="lx-plat__bar" style="--w:${(100 * (+p.count || 0) / max).toFixed(1)}%">${splitBar({ live: p.live, unreachable: p.unreachable, dead: p.dead, opaque: p.opaque }, { label: `${p.host}: ` })}</span>
<span class="lx-plat__n"><b>${fmtInt(p.count)}</b> · ${fmtPct(p.live, p.count)} live</span></li>`).join('');
  const more = all.length > rows.length ? `+ ${fmtInt(all.length - rows.length)} more platforms` : 'All platforms';
  return `<section class="rc-section lx-plats-s" aria-labelledby="pl-h"><div class="rc-wrap lx-plats__grid">
<div class="rc-reveal"><p class="rc-eyebrow">Platforms</p><h2 id="pl-h">Who registered them.</h2><p class="lx-lead">Grouped by the platform that hosts the card. Mass registrars are labelled, not hidden.</p><a class="rc-more" href="/platforms">${more} →</a></div>
<ol class="lx-plats lx-glass rc-reveal">${li}</ol></div></section>`;
}

// ---------- 8 · API ----------
function apiBlock() {
  const routes = [
    ['/api/stats', 'registered, live, dead, unreachable, opaque, platforms, computedAt'],
    ['/api/agents?live=1&limit=20', 'search and filter; q, status, platform, mass, pons, sort, cursor'],
    ['/api/agent/20700', 'one agent: card, chain facts, score parts and inputs'],
    ['/api/agent/20700/card', 'the raw card JSON we stored, with headers'],
    ['/api/platforms', 'every host with counts and DNS status'],
    ['/api/top?limit=20&mass=exclude', 'top by score'],
  ];
  return `<section class="rc-section lx-api" id="api" aria-labelledby="api-h"><div class="rc-wrap lx-api__grid">
<div class="rc-reveal"><p class="rc-eyebrow">API</p><h2 id="api-h">Public JSON, no key.</h2><p class="lx-lead">Also <a href="/llms.txt">llms.txt</a> and <a href="/api">/api</a> index for any crawler. No wallet, no signature, no contract. Nothing to approve.</p></div>
<dl class="lx-routes rc-reveal">${routes.map(([r, d]) => `<div><dt><span class="lx-get">GET</span><a href="${esc(r)}"><code>${esc(r)}</code></a></dt><dd>${esc(d)}</dd></div>`).join('')}</dl>
</div></section>`;
}

// ---------- page ----------
export function landingBody(data, opts = {}) {
  const o = { domain: DOMAIN, ...opts };
  return `${hero(data.stats)}
${proof(data.stats, data.platforms)}
${tryIt(data.top, o)}
${mcpBox(o)}
${tokenSlot(o.token, o)}
${agentsPreview(data.agents)}
${platformsStrip(data.platforms)}
${apiBlock(o)}`;
}

/**
 * Full HTML document.
 * opts: siteUrl ('https://rollycall.xyz'), token (web/token.json), xHandle, mcpTranscript (string[] — real output only),
 *       mcpTranscriptLabel, css (href, default '/dist/app.css'), script (src, default '/dist/landing.js'), fixtureNote (preview only).
 */
export function landingPage(data, opts = {}) {
  const site = opts.siteUrl || `https://${DOMAIN}`;
  const s = data.stats;
  const title = s ? `Rollycall · ${fmtInt(s.registered)} registered, ${fmtInt(s.live)} alive` : 'Rollycall · ERC-8004 agents on Robinhood Chain';
  const desc = 'ERC-8004 agents on Robinhood Chain, counted daily: which agent-cards answer, grouped by platform, ranked by a score you can recompute. No wallet, no login.';
  const x = opts.xHandle ? `<meta name="twitter:site" content="@${esc(opts.xHandle)}">` : '';
  const fixture = opts.fixtureNote ? `<div class="rc-fixture" role="note"><b>Fixture data</b> · ${esc(opts.fixtureNote)}</div>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(site)}/">${opts.fixtureNote ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:type" content="website"><meta property="og:site_name" content="Rollycall"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(site)}/"><meta property="og:image" content="${esc(site)}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">${x}<meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(site)}/og.png">
<meta name="theme-color" content="#06090A"><meta name="color-scheme" content="dark"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/icon-192.png"><link rel="manifest" href="/site.webmanifest">
<link rel="stylesheet" href="${esc(opts.css || '/dist/app.css')}"></head>
<body class="rc"><a class="rc-skip" href="#main">Skip to content</a>${fixture}
${siteNav({ path: '/', xHandle: opts.xHandle })}
<main id="main">${landingBody(data, opts)}</main>
${siteFooter({ xHandle: opts.xHandle })}
<script type="module" src="${esc(opts.script || '/dist/landing.js')}"></script></body></html>`;
}

export { brandMark };
