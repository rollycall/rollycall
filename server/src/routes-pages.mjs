import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadLandingData, landingPage } from './pages/landing.mjs';
import { agentsPage, agentPage, notCountedPage, platformsPage, platformPage, docsPage, tokenPage, llmsTxt, X_HANDLE } from './pages/site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

export function registerPages(app, { tokenPath = process.env.TOKEN_JSON || path.join(root, 'web/token.json'), siteUrl = process.env.SITE_URL || 'https://rollycall.xyz' } = {}) {
  const opts = { siteUrl };
  let tok = { at: 0, v: null };
  const token = () => {
    if (Date.now() - tok.at > 60_000) { try { tok = { at: Date.now(), v: JSON.parse(readFileSync(tokenPath, 'utf8')) }; } catch { tok = { at: Date.now(), v: null }; } }
    return tok.v;
  };
  const get = async (url) => { const r = await app.inject({ url, headers: { 'x-rc-internal': '1' } }); if (r.statusCode >= 400) { const e = new Error('http_' + r.statusCode); e.status = r.statusCode; e.body = r.json(); throw e; } return r.json(); };
  const html = (reply, s, code = 200) => reply.code(code).type('text/html; charset=utf-8').header('cache-control', 'public, max-age=60').send(s);
  const safe = (fn) => async (req, reply) => { try { return await fn(req, reply); } catch (e) { return html(reply, '<!doctype html><title>Rollycall</title><p>The index is not readable right now.</p>', 503); } };

  app.get('/', safe(async (req, reply) => {
    const data = await loadLandingData(get);
    const t = token();
    return html(reply, landingPage(data, { siteUrl, token: t, xHandle: X_HANDLE, css: '/dist/app.css', script: '/dist/landing.js' }));
  }));
  app.get('/agents', safe(async (req, reply) => {
    const q = req.query; const status = q.status || 'live';
    const p = new URLSearchParams(); for (const k of ['q', 'platform', 'mass', 'pons', 'sort', 'cursor']) if (q[k]) p.set(k, q[k]); p.set('status', status);
    let data = null; try { data = await get('/api/agents?' + p); } catch (e) { if (e.status !== 400) throw e; data = { items: [], total: 0, cursor: null }; }
    return html(reply, agentsPage({ query: { ...q, status }, data, platforms: await get('/api/platforms').catch(() => []), opts }));
  }));
  app.get('/agent/:id', safe(async (req, reply) => {
    try { return html(reply, agentPage(await get('/api/agent/' + encodeURIComponent(req.params.id)), opts)); }
    catch (e) { if (e.status === 404) return html(reply, notCountedPage(String(req.params.id).slice(0, 12), e.body?.topId ?? 0, opts), 404); throw e; }
  }));
  app.get('/platforms', safe(async (req, reply) => html(reply, platformsPage(await get('/api/platforms'), opts))));
  app.get('/platform/:host', safe(async (req, reply) => {
    const host = req.params.host; const rows = await get('/api/platforms');
    const row = rows.find((r) => r.host === host);
    if (!row) return html(reply, platformPage(host, null, null, {}, opts).replace('No agent matches.', 'Not counted: no agents on this host.'), 404);
    const p = new URLSearchParams({ platform: host, status: req.query.status || 'any', sort: req.query.sort || 'score' }); if (req.query.cursor) p.set('cursor', req.query.cursor);
    return html(reply, platformPage(host, row, await get('/api/agents?' + p), req.query, opts));
  }));
  app.get('/docs', async (req, reply) => html(reply, docsPage(opts)));
  app.get('/token', async (req, reply) => html(reply, tokenPage(token(), opts)));
  app.get('/llms.txt', safe(async (req, reply) => reply.type('text/plain; charset=utf-8').header('cache-control', 'public, max-age=60').send(llmsTxt(await get('/api/stats').catch(() => null), opts))));

  // static: /dist/*, /fonts/* (from dist), root icons
  const serve = (file, reply, cache) => {
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return reply.code(404).type('text/plain').send('Not counted.');
    return reply.type(TYPES[path.extname(file)] || 'application/octet-stream').header('cache-control', cache).send(createReadStream(file));
  };
  app.get('/dist/*', async (req, reply) => serve(path.join(root, 'web/dist', path.normalize('/' + req.params['*'])), reply, 'public, max-age=3600'));
  app.get('/fonts/*', async (req, reply) => serve(path.join(root, 'web/dist/fonts', path.normalize('/' + req.params['*'])), reply, 'public, max-age=604800'));
  for (const f of ['favicon.svg', 'site.webmanifest', 'og.png', 'favicon-32.png', 'icon-192.png', 'icon-512.png']) {
    app.get('/' + f, async (req, reply) => serve(existsSync(path.join(root, 'web/dist', f)) ? path.join(root, 'web/dist', f) : path.join(root, 'web/art', f), reply, 'public, max-age=3600'));
  }
}
