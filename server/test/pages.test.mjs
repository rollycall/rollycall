import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setMeta } from '../src/db.mjs';
import { upsertAgents, checkCards, probeHosts, computeScores, refreshOwners, writeStats } from '../src/indexer.mjs';
import { buildApp } from '../src/app.mjs';

async function seeded() {
  const db = openDb(':memory:'); const rows = [];
  for (let id = 1; id <= 130; id++) rows.push({ id, exists: 1, owner: '0x' + String(id % 9).repeat(40), agentWallet: null,
    tokenUri: id <= 60 ? `https://alive.example/c/${id}` : id <= 120 ? `https://gone.example/c/${id}` : 'priors:agent:0x1', platform: id <= 60 ? 'alive.example' : id <= 120 ? 'gone.example' : 'priors:' });
  upsertAgents(db, rows); setMeta(db, 'top_id', 130); refreshOwners(db);
  await probeHosts(db, { probe: async (host) => ({ host, dnsOk: host !== 'gone.example' }) });
  await checkCards(db, { observe: async (u) => ({ tokenUri: u, httpStatus: 200, body: JSON.stringify({ name: 'Agent <b>' + u.split('/').pop(), description: 'trading helper '.repeat(5) }), bytes: 50 }) });
  computeScores(db); writeStats(db);
  return buildApp({ db });
}
test('pages render with the right status and no placeholders', async () => {
  const app = await seeded();
  const page = async (u) => { const r = await app.inject(u); return { code: r.statusCode, text: r.body, type: r.headers['content-type'] }; };
  for (const u of ['/', '/agents', '/agents?q=trading&status=any&sort=newest', '/agent/5', '/agent/125', '/agent/100', '/platforms', '/platform/gone.example', '/docs', '/token']) {
    const r = await page(u); assert.equal(r.code, 200, u); assert.match(r.type, /text\/html/);
    assert.doesNotMatch(r.text, /\bsoon\b|coming|WIB|0x0{40}/i, u);
    assert.doesNotMatch(r.text, /<b>1\b/, u); // card names are escaped
  }
  assert.match((await page('/agent/5')).text, /Agent &lt;b&gt;5/);
  assert.match((await page('/agent/100')).text, /Host unreachable/);
  assert.match((await page('/agent/125')).text, /scheme <code>priors:/);
  for (const u of ['/agent/9999', '/agent/abc', '/platform/nope.example']) assert.equal((await page(u)).code, 404, u);
  assert.match((await page('/agent/9999')).text, /Top id is 130/);
  assert.match((await page('/agents?q=zzzz')).text, /No agent matches/);
  assert.match((await page('/platforms')).text, /host unreachable since/);
  const tk = (await page('/token')).text; assert.match(tk, /No token yet/); assert.match(tk, /\$ROLLY/); assert.doesNotMatch(tk, /\d{1,2}:\d{2}/);
  const llms = await page('/llms.txt'); assert.equal(llms.code, 200); assert.match(llms.text, /rollycall-mcp/);
});
test('agents page: cursor pagination link and filters in URL', async () => {
  const app = await seeded();
  const r = (await app.inject('/agents?status=any')).body;
  const m = /rel="next" href="([^"]+)"/.exec(r); assert.ok(m, 'next link');
  const r2 = await app.inject(m[1].replace(/&amp;/g, '&')); assert.equal(r2.statusCode, 200);
  assert.match(r2.body, /name="status"/);
});
test('holder routes are disabled pre-launch', async () => {
  const app = await seeded();
  const r = await app.inject({ method: 'POST', url: '/api/holder/check', payload: { address: '0x' + '1'.repeat(40) } });
  assert.deepEqual(r.json(), { enabled: false });
  assert.equal((await app.inject('/api/export.csv')).statusCode, 404);
});
