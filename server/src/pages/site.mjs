// SSR pages owned by APP: /agents /agent/:id /platforms /platform/:host /docs /token. Pure string templates.
import {
  esc, fmtInt, fmtUtc, fmtDay, trunc, shortAddr, statusChip, massBadge, ponsChip, scoreCell, copyBox, agentsTable, scorePanel,
  splitBar, siteNav, siteFooter, disclaimer, DISCLAIMER,
} from '../../../web/src/styles/components.mjs';

const SITE = 'https://rollycall.xyz';
export const X_HANDLE = 'rollycallagent';
const RPC = 'https://robinhood-rpc.publicnode.com';
const REG = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

export function shell({ title, desc, path, body, canonical, noindex = false, opts = {} }) {
  const site = opts.siteUrl || SITE;
  const url = site + (canonical ?? path);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:type" content="website"><meta property="og:site_name" content="Rollycall"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(site)}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@${X_HANDLE}"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(site)}/og.png">
<meta name="theme-color" content="#06090A"><meta name="color-scheme" content="dark"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/icon-192.png"><link rel="manifest" href="/site.webmanifest">
<link rel="stylesheet" href="/dist/app.css"></head>
<body class="rc"><a class="rc-skip" href="#main">Skip to content</a>
${siteNav({ path, xHandle: X_HANDLE })}
<main id="main"><div class="rc-wrap">${body}</div></main>
${siteFooter({ xHandle: X_HANDLE })}
<script src="/dist/pages.js" defer></script></body></html>`;
}

const head = (h1, sub) => `<div class="pg-head"><h1>${h1}</h1>${sub ? `<p class="pg-sub">${sub}</p>` : ''}</div>`;
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };

// ---------------------------------------------------------------- /agents
export function agentsPage({ query, data, platforms, opts }) {
  const q = { q: query.q || '', status: query.status || (query.live ? 'live' : 'live'), platform: query.platform || '', mass: query.mass === 'exclude' ? 'exclude' : 'include', pons: query.pons === '1' ? '1' : '', sort: query.sort || 'score' };
  const opt = (v, l, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`;
  const plat = (platforms || []).slice(0, 60);
  const filters = `<form class="pg-filters" method="get" action="/agents" role="search">
<label>Search name or #id<input type="search" name="q" value="${esc(q.q)}" placeholder="trading, #500" maxlength="100"></label>
<label>Status<select name="status">${[['live', 'Live'], ['any', 'Any'], ['unreachable', 'Unreachable'], ['host-down', 'Host unreachable'], ['dead', 'Dead'], ['opaque', 'Not fetchable']].map(([v, l]) => opt(v, l, q.status)).join('')}</select></label>
<label>Platform<select name="platform">${opt('', 'All platforms', q.platform)}${plat.map((p) => opt(p.host, `${p.host} (${fmtInt(p.count)})`, q.platform)).join('')}${q.platform && !plat.some((p) => p.host === q.platform) ? opt(q.platform, q.platform, q.platform) : ''}</select></label>
<label>Mass platforms<select name="mass">${opt('include', 'Include', q.mass)}${opt('exclude', 'Exclude', q.mass)}</select></label>
<label>Sort<select name="sort">${[['score', 'Score'], ['newest', 'Newest id'], ['age', 'Oldest observed'], ['id', 'Id ascending']].map(([v, l]) => opt(v, l, q.sort)).join('')}</select></label>
<label class="pg-check"><input type="checkbox" name="pons" value="1"${q.pons ? ' checked' : ''}> Pons-linked only</label>
<div><button type="submit">Apply</button></div></form>`;
  const next = data?.cursor ? `<a class="rc-btn" rel="next" href="/agents${qs({ ...q, cursor: data.cursor })}">Next 50</a>` : '<span></span>';
  const body = !data ? `<div class="pg-empty">The index is not readable right now. Try again in a minute.</div>`
    : data.items.length ? `${agentsTable(data.items, { caption: 'Agents' })}<div class="pg-pager"><span class="rc-muted">${fmtInt(data.total)} match · 50 per page</span>${next}</div>`
    : `<div class="pg-empty"><b>No agent matches.</b> Try <a href="/agents${qs({ ...q, status: 'any', cursor: '' })}">status=any</a>.</div>`;
  return shell({ title: 'Agents · Rollycall', desc: 'Every ERC-8004 agent on Robinhood Chain, with its card status and a score you can recompute.', path: '/agents', canonical: '/agents' + qs({ ...q }), noindex: !!query.cursor, opts,
    body: head('Agents', 'Every agent id in the ERC-8004 Identity Registry on Robinhood Chain, crawled daily. Default view: live cards, ranked by score.') + filters + body + disclaimer() });
}

// ---------------------------------------------------------------- /agent/:id
export function notCountedPage(id, topId, opts) {
  return shell({ title: 'Not counted · Rollycall', desc: 'This id is not in the registry.', path: '/agent/' + id, noindex: true, opts,
    body: head('Not counted (yet)', `Top id is ${fmtInt(topId)}. <a href="/agents">Browse agents</a>.`) });
}
const yn = (b) => (b === true ? 'yes' : b === false ? 'no' : 'not probed yet');
export function agentPage(a, opts) {
  const c = a.card, name = c.name || `Agent #${a.id}`;
  const scheme = /^([a-z][a-z0-9+.-]*:)/i.exec(a.tokenUri || '')?.[1];
  const castO = `cast call ${REG} "ownerOf(uint256)(address)" ${a.id} --rpc-url ${RPC}`;
  const castU = `cast call ${REG} "tokenURI(uint256)(string)" ${a.id} --rpc-url ${RPC}`;
  const failNote = c.status === 'unreachable' || c.status === 'host-down' || c.status === 'dead' ? { not_json: 'Answered 200 but not JSON', no_name: 'JSON without a name', too_large: 'Card larger than 512 KB' }[c.reason] || c.reason : '';
  const services = c.services.length ? `<ul>${c.services.map((s) => `<li><b>${esc(s?.name ?? 'service')}</b> ${s?.endpoint ? `<code>${esc(trunc(s.endpoint, 90))}</code>` : ''}</li>`).join('')}</ul>` : '<span class="rc-muted">none listed</span>';
  const hist = a.history.length ? `<ul class="pg-hist">${a.history.map((h) => `<li>${statusChip(h.status, { compact: true })}<time datetime="${esc(h.checkedAt)}">${fmtUtc(h.checkedAt)}</time>${h.reason ? `<span class="rc-muted">${esc(h.reason)}</span>` : ''}</li>`).join('')}</ul>` : '<span class="rc-muted">No checks yet.</span>';
  const body = `${head(esc(trunc(name, 80)), `#${fmtInt(a.id)} · ${statusChip(c.status, { checkedAt: c.checkedAt, failCount: c.failCount, since: c.firstFailAt, scheme })} · <a href="/platform/${encodeURIComponent(a.platform.host)}">${esc(a.platform.host)}</a>${a.platform.massPlatform ? ' ' + massBadge(a.platform.count) : ''} ${ponsChip(a.ponsLink)}`)}
${failNote ? `<p class="rc-muted">${esc(failNote)}</p>` : ''}
${scorePanel(a.score)}
<div class="pg-grid pg-grid--2">
<section class="pg-card"><h2>Card</h2><dl class="pg-kv">
<dt>Name</dt><dd>${c.name ? esc(c.name) : '<span class="rc-muted">no card name</span>'}</dd>
<dt>Description</dt><dd>${c.description ? esc(trunc(c.description, 400)) : '<span class="rc-muted">none</span>'}</dd>
<dt>Image</dt><dd>${c.image ? `<code>${esc(trunc(c.image, 80))}</code> · probe ${yn(a.probes.imageOk)}` : '<span class="rc-muted">none</span>'}</dd>
<dt>Services</dt><dd>${services}</dd>
<dt>HTTP status</dt><dd>${c.httpStatus ?? '—'}</dd></dl></section>
<section class="pg-card"><h2>Chain</h2><dl class="pg-kv">
<dt>Owner</dt><dd><code>${esc(a.owner)}</code></dd>
<dt>Agent wallet</dt><dd><code>${esc(a.agentWallet || '—')}</code></dd>
<dt>tokenURI</dt><dd><code>${esc(trunc(a.tokenUri || '', 200))}</code></dd></dl>
<p class="rc-muted">Check it yourself:</p>${copyBox(castO, { label: 'ownerOf' })}${copyBox(castU, { label: 'tokenURI' })}</section>
<section class="pg-card"><h2>Owner activity</h2><dl class="pg-kv">
<dt>Agents held</dt><dd>${fmtInt(a.ownerStats.agentCount)}</dd><dt>Transactions (nonce)</dt><dd>${a.ownerStats.nonce === null ? '<span class="rc-muted">not checked yet</span>' : fmtInt(a.ownerStats.nonce)}</dd>
<dt>Checked</dt><dd>${a.ownerStats.checkedAt ? fmtUtc(a.ownerStats.checkedAt) : '—'}</dd></dl></section>
<section class="pg-card"><h2>Pons</h2>${a.ponsLink ? `<p>${ponsChip(a.ponsLink)} ${esc(a.ponsLink.name || '')}</p><dl class="pg-kv"><dt>Market cap</dt><dd>${a.ponsLink.marketCapUsd == null ? '—' : '$' + fmtInt(a.ponsLink.marketCapUsd)}</dd><dt>Volume</dt><dd>${a.ponsLink.volumeUsd == null ? '—' : '$' + fmtInt(a.ponsLink.volumeUsd)}</dd><dt>Trades</dt><dd>${fmtInt(a.ponsLink.tradeCount)}</dd></dl>` : '<p class="rc-muted">No verifiable token address in the card.</p>'}
<h2 style="margin-top:16px">Reputation</h2><p class="rc-muted">Reputation: none readable. The on-chain Reputation Registry has no readable feedback on this chain; we show nothing from it.</p></section>
<section class="pg-card"><h2>Raw</h2><p>Stored card JSON and fetch headers: <a href="/api/agent/${a.id}/card"><code>/api/agent/${a.id}/card</code></a></p>${copyBox(`curl ${opts?.siteUrl || SITE}/api/agent/${a.id}`, { label: 'API' })}</section>
<section class="pg-card"><h2>History (last 30 checks)</h2>${hist}</section>
</div>${disclaimer()}`;
  return shell({ title: `${name} · Rollycall`, desc: `Agent #${a.id} on Robinhood Chain: ${c.status}, score ${a.score.total}/100.`, path: '/agent/' + a.id, canonical: '/agent/' + a.id, body, opts });
}

// ---------------------------------------------------------------- /platforms
export function platformsPage(rows, opts) {
  const body = !rows ? '<div class="pg-empty">The index is not readable right now.</div>' : `<div class="rc-tablewrap"><table class="rc-table pg-plat"><caption class="sr-only">Platforms</caption>
<thead><tr><th scope="col">Host</th><th scope="col">Agents</th><th scope="col">Live</th><th scope="col">Unreachable</th><th scope="col">Dead</th><th scope="col">Not fetchable</th><th scope="col">Host DNS</th><th scope="col">Samples</th></tr></thead><tbody>
${rows.map((p) => `<tr><th scope="row"><a href="/platform/${encodeURIComponent(p.host)}">${esc(trunc(p.display, 40))}</a>${p.massPlatform ? ' ' + massBadge(p.count) : ''}<br>${splitBar({ live: p.live, unreachable: p.unreachable, dead: p.dead, opaque: p.opaque }, { label: p.host + ': ' })}</th>
<td>${fmtInt(p.count)}</td><td>${fmtInt(p.live)}</td><td>${fmtInt(p.unreachable)}</td><td>${fmtInt(p.dead)}</td><td>${fmtInt(p.opaque)}</td>
<td>${p.dnsOk === null ? '<span class="rc-muted">n/a</span>' : p.dnsOk ? 'resolves' : `host unreachable${p.downSince ? ` since ${fmtUtc(p.downSince)}` : ''}`}</td>
<td>${p.sampleIds.map((i) => `<a href="/agent/${i}">#${i}</a>`).join(' ')}</td></tr>`).join('')}</tbody></table></div>`;
  return shell({ title: 'Platforms · Rollycall', desc: 'ERC-8004 agents grouped by the host that serves their card. Mass registrars are labelled, not hidden.', path: '/platforms', canonical: '/platforms', opts,
    body: head('Platforms', 'Agents grouped by the platform that hosts the card. A platform with more than 1,000 agents is labelled <i>mass platform</i>; nothing is dropped.') + body });
}
export function platformPage(host, row, agents, query, opts) {
  const next = agents?.cursor ? `<a class="rc-btn" rel="next" href="/platform/${encodeURIComponent(host)}${qs({ ...query, cursor: agents.cursor })}">Next 50</a>` : '';
  const facts = row ? `<dl class="pg-kv"><dt>Agents</dt><dd>${fmtInt(row.count)} ${row.massPlatform ? massBadge(row.count) : ''}</dd><dt>Live</dt><dd>${fmtInt(row.live)}</dd><dt>Unreachable</dt><dd>${fmtInt(row.unreachable)}</dd><dt>Dead</dt><dd>${fmtInt(row.dead)}</dd><dt>Not fetchable</dt><dd>${fmtInt(row.opaque)}</dd><dt>Host DNS</dt><dd>${row.dnsOk === null ? 'n/a' : row.dnsOk ? 'resolves' : `host unreachable${row.downSince ? ` since ${fmtUtc(row.downSince)}` : ''}`}</dd></dl>` : '';
  const list = agents?.items?.length ? agentsTable(agents.items, { caption: 'Agents on ' + host }) + `<div class="pg-pager"><span class="rc-muted">${fmtInt(agents.total)} agents</span>${next}</div>` : '<div class="pg-empty">No agent matches.</div>';
  return shell({ title: `${host} · Rollycall`, desc: `Agents whose card is served from ${host}.`, path: '/platform/' + host, canonical: '/platform/' + encodeURIComponent(host), opts,
    body: head(esc(host), '<a href="/platforms">All platforms</a>') + `<div class="pg-card">${facts}</div>` + list + disclaimer() });
}

// ---------------------------------------------------------------- /docs
export function docsPage(opts) {
  const D = opts?.siteUrl || SITE;
  const body = `${head('Docs', 'What Rollycall counts, how, and where it stops.')}
<ul class="pg-toc"><li><a href="#live">Live</a></li><li><a href="#score">Score</a></li><li><a href="#platforms">Platforms</a></li><li><a href="#pons">Pons link</a></li><li><a href="#crawler">Index &amp; crawler</a></li><li><a href="#api">API</a></li><li><a href="#mcp">MCP</a></li><li><a href="#privacy">Privacy</a></li><li><a href="#limits">Limits</a></li><li><a href="#verify">Verify it yourself</a></li></ul>
<div class="pg-prose">
<h2 id="what">What it counts</h2><p>Every agent id in the ERC-8004 Identity Registry (<code>${REG}</code>) on Robinhood Chain (chain 4663), crawled daily. For each id Rollycall reads the owner, the tokenURI and the agent wallet on chain, then fetches the agent-card and records what happened.</p>
<h2 id="live">Live</h2><p>Live means: its agent-card URL answered HTTP 200 with valid JSON and a name, the last time we checked (timestamp shown).</p>
<table><thead><tr><th>Status</th><th>Rule</th></tr></thead><tbody>
<tr><td>live</td><td>HTTP 200 (or a decoded <code>data:</code> URI, or an IPFS gateway 200), body parses as JSON, and <code>name</code> is a non-empty string.</td></tr>
<tr><td>unreachable</td><td>Fetch failed (DNS, timeout 8 s, 5xx, 4xx, non-JSON, no name) fewer than 3 consecutive times.</td></tr>
<tr><td>dead</td><td>3 or more consecutive failures spanning 72 hours or more. A dead card that answers again becomes live on the next check.</td></tr>
<tr><td>opaque</td><td>tokenURI scheme we cannot fetch (for example <code>priors:agent:…</code>, an empty string).</td></tr>
<tr><td>host-down</td><td>The card's host failed DNS on the host-level probe this cycle; per-card fetches are skipped. Counts as unreachable, and as dead by the same 3 / 72 h rule.</td></tr></tbody></table>
<h2 id="score">Score</h2><p>Score v1, 0 to 100, every part recomputable from fields the API exposes: card 45, endpoint 10, observed age 15, owner activity 15, independence 10, Pons link 5.</p>
<table><thead><tr><th>Part</th><th>Max</th><th>Formula</th></tr></thead><tbody>
<tr><td>card</td><td>45</td><td>live 30; +5 if name length ≥ 3 and description length ≥ 40; +5 if the image URL answered 2xx; +5 if <code>registrations[]</code> contains this id and the registry <code>eip155:4663:${REG.slice(0, 8)}…</code>. Not live: 0.</td></tr>
<tr><td>endpoint</td><td>10</td><td>10 if <code>url</code> or a <code>services[].endpoint</code> (https) answered 2xx/3xx to a HEAD (fallback GET); else 0.</td></tr>
<tr><td>age</td><td>15</td><td><code>round(15 · L(observedDays, 90) / 100)</code>, observedDays = days since Rollycall first saw the card live.</td></tr>
<tr><td>owner</td><td>15</td><td><code>round(15 · L(ownerNonce, 1000) / 100)</code>; nonce 0 gives 0, 1 gives 2, 30 gives 7, 1,000 gives 15.</td></tr>
<tr><td>independence</td><td>10</td><td>min(hostTier, ownerTier). hostTier by agents on the same platform: ≤ 10: 10 · 11–100: 7 · 101–1,000: 4 · over 1,000: 1. ownerTier by agents held by the owner: ≤ 3: 10 · 4–20: 6 · over 20: 2.</td></tr>
<tr><td>pons</td><td>5</td><td>5 if a verifiable Pons link exists, else 0. The coin's market cap and volume are shown, never scored.</td></tr></tbody></table>
<p><code>L(x, cap) = clamp(100 · log10(1+x) / log10(1+cap), 0, 100)</code>, applied to the unrounded value inside each part. Sort: total descending, then id ascending. Observed age is not mint age: the archive RPC is unavailable, so every agent starts at zero and the age part separates agents only after the first weeks. The endpoint, image, owner-activity and Pons parts are filled in as their probes run; until a probe has run, its part shows 0 and its input shows "not probed yet".</p>
<p>${DISCLAIMER}</p>
<h2 id="platforms">Platforms</h2><p>Grouped by the platform that hosts the card: the registrable domain of the tokenURI host, except shared hosts (<code>fly.dev</code>, <code>vercel.app</code>, <code>github.io</code>, <code>workers.dev</code> and similar) which keep the full host. <code>data:</code> URIs are "Self-contained", <code>ipfs://</code> is "IPFS", any other scheme is its own group. A platform with more than 1,000 agents carries the <i>mass platform</i> badge; the badge is information, nothing is dropped.</p>
<h2 id="pons">Pons link</h2><p>Pons-linked means: the card or its web endpoint names a token address that is a Pons launch (checked against ponsfamily.com). A card that says "our token" without an address gets nothing; a name match is never used.</p>
<h2 id="crawler">Index &amp; crawler</h2><p>The chain is read with plain <code>eth_call</code> through Multicall3 (about 125 calls for a full pass). Cards are fetched over https, from <code>data:</code> URIs, or through an IPFS gateway, at most 2 requests per second per host, 512 KB per card, with the user agent <code>rollycall/0.1 (+${D}/docs#crawler)</code>. One DNS/HTTP probe per host comes before any card fetch; a host that fails DNS is marked host-down without individual requests. To opt a host out, stop answering the user agent above with JSON and the cards will read as unreachable.</p>
<h2 id="api">API</h2><p>Public JSON, no key, CORS open, cached 60 s.</p>${copyBox(`curl ${D}/api/agents?live=1&limit=20`, { label: 'Example' })}
<p>Routes: <a href="/api">/api</a>, <a href="/api/stats">/api/stats</a>, <a href="/api/agents?live=1&amp;limit=20">/api/agents</a>, <code>/api/agent/:id</code>, <code>/api/agent/:id/card</code>, <a href="/api/platforms">/api/platforms</a>, <a href="/api/top?limit=20&amp;mass=exclude">/api/top</a>, <a href="/api/health">/api/health</a>. Also <a href="/llms.txt">llms.txt</a>.</p>
<p>Source: <a href="https://github.com/rollycall/rollycall">github.com/rollycall/rollycall</a> (MIT). MCP server: <a href="https://www.npmjs.com/package/rollycall-mcp">rollycall-mcp on npm</a>.</p>
<h2 id="mcp">MCP</h2><p>For agents, one line:</p>${copyBox('claude mcp add rollycall -- npx -y rollycall-mcp', { label: 'Install' })}<p>Tools: <code>search_agents</code>, <code>get_agent</code>, <code>list_platforms</code>, <code>top_agents</code>.</p>
<h2 id="privacy">Privacy</h2><p>No wallet, no signature, no contract. Nothing to approve. The server stores counts only: no IP address, no user agent.</p>
<h2 id="limits">Limits</h2><ul><li>The on-chain Reputation Registry has no readable feedback on this chain; we show nothing from it.</li><li>Observed age is days since we first saw the card live, not mint age.</li><li>Cards change or die; one host answering again or going silent can move the live number overnight.</li><li>The score is a heuristic with hand-picked weights. It is not reputation, not an audit, and not endorsement.</li><li>Data refreshes daily; each number shows the time it was computed (UTC).</li></ul>
<h2 id="verify">Verify it yourself</h2>${copyBox(`cast call ${REG} "ownerOf(uint256)(address)" 1 --rpc-url ${RPC}`)}${copyBox(`cast call ${REG} "tokenURI(uint256)(string)" 1 --rpc-url ${RPC}`)}
</div>`;
  return shell({ title: 'Docs · Rollycall', desc: 'What Rollycall counts, how liveness and the score are computed, and the limits.', path: '/docs', canonical: '/docs', body, opts });
}

// ---------------------------------------------------------------- /token (pre-launch state)
export function tokenPage(token, opts) {
  const t = token || {};
  const sym = t.tickerPublic && t.symbol ? `$${esc(t.symbol)}` : '';
  if (t.launched && /^0x[0-9a-fA-F]{40}$/.test(t.ca || '') && !/^0x0{40}$/.test(t.ca)) {
    const live = `${head('Token', sym)}
<div class="pg-card pg-prose"><p><b>The only official contract address:</b></p>${copyBox(t.ca, { label: 'Contract address', prompt: 'CA' })}
<p><a class="rc-btn" href="https://ponsfamily.com/launchpad/${esc(t.ca.toLowerCase())}" rel="noopener" target="_blank">Buy on Pons</a></p>
<p>Only on Pons, Robinhood Chain. The same address is on <a href="https://x.com/${esc(X_HANDLE)}" rel="noopener" target="_blank">@${esc(X_HANDLE)}</a>. Anything else is not us.</p>
<p>The product stays open to everyone: no wallet to connect and nothing to approve to use it. No promise of returns.</p></div>${disclaimer()}`;
    return shell({ title: 'Token · Rollycall', desc: `The only official ${sym || 'token'} contract address: ${esc(t.ca)}`, path: '/token', canonical: '/token', body: live, opts });
  }
  const body = `${head('Token', sym ? `${sym} · launch ${esc(fmtDay(t.launchDate) || t.launchDate || '')}` : '')}
<div class="pg-card pg-prose"><p><b>No token yet.</b> Everything here is open to everyone.</p>
<p>There is no contract to approve and no wallet to connect. No promise of returns.</p></div>${disclaimer()}`;
  return shell({ title: 'Token · Rollycall', desc: 'No token yet. Everything on Rollycall is open to everyone.', path: '/token', canonical: '/token', body, opts });
}

// ---------------------------------------------------------------- llms.txt
export function llmsTxt(stats, opts) {
  const D = opts?.siteUrl || SITE;
  return `# Rollycall

> ERC-8004 agents on Robinhood Chain (chain 4663), counted daily: which agent-cards answer, grouped by platform, ranked by a score anyone can recompute. Read-only. No wallet, no login.
${stats ? `\nRegistered: ${stats.registered}. Live: ${stats.live}. Computed at: ${stats.computedAt}.\n` : ''}
## Routes
- ${D}/api  (index)
- ${D}/api/stats
- ${D}/api/agents?live=1&limit=20  (filters: q, status, platform, mass=include|exclude, pons=1, sort=score|id|newest|age, cursor)
- ${D}/api/agent/{id}  and  ${D}/api/agent/{id}/card
- ${D}/api/platforms
- ${D}/api/top?limit=20&mass=exclude
- ${D}/api/health
- ${D}/docs

## Source and MCP
- Source: https://github.com/rollycall/rollycall (MIT)
- MCP server: https://www.npmjs.com/package/rollycall-mcp  (claude mcp add rollycall -- npx -y rollycall-mcp)

## Live
Live means: the agent-card URL answered HTTP 200 with valid JSON and a name, the last time we checked.

## Score (v1, 0-100)
card 45, endpoint 10, observed age 15, owner activity 15, independence 10, Pons link 5. Formula and inputs: ${D}/docs#score

## Limits
The Reputation Registry has no readable feedback on this chain; we show nothing from it. Observed age is not mint age. The score is a heuristic, not reputation, not an audit, not endorsement.

## MCP
claude mcp add rollycall -- npx -y rollycall-mcp
`;
}
