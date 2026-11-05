import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setMeta } from '../src/db.mjs';
import { makeRpc } from '../src/rpc.mjs';
import { findTopId, scanIds } from '../src/scan.mjs';
import { decodeDataUri, httpGet, observeCard } from '../src/fetcher.mjs';
import { upsertAgents, checkCards, probeHosts, computeScores, refreshOwners, writeStats } from '../src/indexer.mjs';
import { buildApp } from '../src/app.mjs';

const resp = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const noSleep = async () => {};

test('rpc: retries then succeeds; timeout path; circuit opens after 5 failures', async () => {
  let n = 0;
  const rpc = makeRpc({ fetch: async () => (++n < 3 ? Promise.reject(new Error('boom')) : resp({ result: '0x1' })), sleep: noSleep, plainGapMs: 0 });
  assert.equal(await rpc.ethCall('0x1', '0x'), '0x1'); assert.equal(n, 3);
  const dead = makeRpc({ fetch: async () => { throw new Error('down'); }, sleep: noSleep, plainGapMs: 0 });
  await assert.rejects(() => dead.ethCall('0x1', '0x'));            // 4 attempts
  await assert.rejects(() => dead.ethCall('0x1', '0x'), /circuit_open|down|network/);
  assert.equal(dead.ok(), false);
  await assert.rejects(() => dead.ethCall('0x1', '0x'), /circuit_open/);
  const slow = makeRpc({ fetch: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))), timeoutMs: 20, backoffs: [], sleep: noSleep });
  await assert.rejects(() => slow.ethCall('0x1', '0x'), /timeout/);
});
test('rpc: revert is an answer, not an outage', async () => {
  const rpc = makeRpc({ fetch: async () => resp({ error: { message: 'execution reverted' } }), sleep: noSleep, plainGapMs: 0 });
  for (let i = 0; i < 8; i++) await assert.rejects(() => rpc.ethCall('0x1', '0x'), /revert/);
  assert.equal(rpc.ok(), true);
});

function fakeChain(top, uriOf = (id) => `https://h${id % 3}.example/c/${id}`) {
  const w = (n) => BigInt(n).toString(16).padStart(64, '0');
  const str = (s) => '0x' + w(0x20) + w(s.length) + Buffer.from(s).toString('hex').padEnd(Math.ceil(s.length / 32) * 64, '0');
  const calls = { multi: 0, single: 0 };
  return {
    calls,
    ethCall: async (to, data) => { calls.single++; const id = parseInt(data.slice(10), 16); if (id < 1 || id > top) throw Object.assign(new Error('revert'), { kind: 'rpc_error' }); return '0x' + w(id); },
    aggregate3: async (cs) => { calls.multi++; const out = []; for (let i = 0; i < cs.length; i += 3) { const id = parseInt(cs[i].callData.slice(10), 16), ok = id <= top;
      out.push({ success: ok, returnData: ok ? '0x' + '0'.repeat(24) + id.toString(16).padStart(40, '0') : '0x' }, { success: ok, returnData: ok ? str(uriOf(id)) : '0x' }, { success: ok, returnData: ok ? '0x' + w(id) : '0x' }); } return out; },
    ok: () => true, stats: () => ({ multicalls: calls.multi, plain: calls.single }),
  };
}
test('scan: top id search and batched scan (166 ids per multicall)', async () => {
  const chain = fakeChain(20749);
  assert.equal(await findTopId(chain, 1), 20749);
  assert.equal(await findTopId(chain, 20749), 20749);
  const db = openDb(':memory:'); let seen = 0;
  await scanIds(chain, 1, 20749, (rows) => { seen += rows.length; upsertAgents(db, rows); });
  assert.equal(seen, 20749); assert.equal(chain.calls.multi, Math.ceil(20749 / 166)); assert.ok(chain.calls.multi <= 130);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agents WHERE "exists"=1').get().n, 20749);
  assert.equal(db.prepare('SELECT token_uri u FROM agents WHERE id=7').get().u, 'https://h1.example/c/7');
});
test('scan: burned id below top is exists=0', async () => {
  const chain = fakeChain(10); const orig = chain.aggregate3;
  chain.aggregate3 = async (cs) => { const r = await orig(cs); r[3 * 4] = { success: false, returnData: '0x' }; return r; };
  const db = openDb(':memory:'); await scanIds(chain, 1, 10, (rows) => upsertAgents(db, rows));
  assert.equal(db.prepare('SELECT "exists" e FROM agents WHERE id=5').get().e, 0);
});

test('fetcher: data uri decode', () => {
  assert.equal(decodeDataUri('data:application/json;base64,eyJuYW1lIjoiYSJ9'), '{"name":"a"}');
  assert.equal(decodeDataUri('data:application/json,%7B%22name%22%3A%22a%22%7D'), '{"name":"a"}');
  assert.equal(decodeDataUri('data:garbage'), null);
});
const bodyOf = (s) => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(s)); c.close(); } });
const hdr = (o = {}) => ({ get: (k) => o[k.toLowerCase()] ?? null });
test('fetcher: 512 KB cap truncates; redirect capped at 2; timeout; dns', async () => {
  const big = await httpGet('https://x.example/', { fetchImpl: async () => ({ status: 200, headers: hdr(), body: bodyOf('a'.repeat(600 * 1024)) }) });
  assert.equal(big.truncated, true); assert.equal(big.text.length, 512 * 1024);
  let hops = 0;
  const r = await httpGet('https://x.example/', { fetchImpl: async () => { hops++; return { status: 302, headers: hdr({ location: `https://y${hops}.example/` }), body: bodyOf('') }; } });
  assert.equal(r.tooManyRedirects, true); assert.equal(hops, 3);
  await assert.rejects(() => httpGet('https://x.example/', { timeoutMs: 20, fetchImpl: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))) }), { kind: 'timeout' });
  await assert.rejects(() => httpGet('https://x.example/', { fetchImpl: async () => { throw Object.assign(new Error('f'), { cause: { code: 'ENOTFOUND' } }); } }), { kind: 'dns' });
});
test('fetcher: opaque scheme does no network', async () => {
  assert.deepEqual(await observeCard('priors:agent:0x1'), { tokenUri: 'priors:agent:0x1' });
});

function seedDb() {
  const db = openDb(':memory:');
  const rows = [];
  for (let id = 1; id <= 60; id++) rows.push({ id, exists: 1, owner: '0x' + String(id % 7).repeat(40), agentWallet: null,
    tokenUri: id <= 20 ? `https://alive.example/c/${id}` : id <= 50 ? `https://gone.example/c/${id}` : id <= 55 ? 'priors:agent:0xabc' : `data:application/json;base64,${Buffer.from(JSON.stringify({ name: 'Inline ' + id })).toString('base64')}`,
    platform: id <= 20 ? 'alive.example' : id <= 50 ? 'gone.example' : id <= 55 ? 'priors:' : 'data:' });
  upsertAgents(db, rows); setMeta(db, 'top_id', 60); refreshOwners(db);
  return db;
}
test('cards: dead host => host-down without per-card fetches; live/opaque/data statuses; scores; stats', async () => {
  const db = seedDb(); let fetches = 0;
  await probeHosts(db, { probe: async (host) => ({ host, dnsOk: host !== 'gone.example', note: 'x' }) });
  const observe = async (uri) => { fetches++; if (uri.startsWith('data:')) return (await import('../src/fetcher.mjs')).observeCard(uri); return { tokenUri: uri, httpStatus: 200, body: JSON.stringify({ name: 'Agent', description: 'x'.repeat(50) }), bytes: 80 }; };
  const r = await checkCards(db, { observe });
  assert.equal(r.hostDown, 30); assert.equal(fetches, 30); // 20 https + 5 data + 5 opaque (observeCard does no network for those)
  const st = Object.fromEntries(db.prepare('SELECT status s, COUNT(*) n FROM cards GROUP BY s').all().map((x) => [x.s, x.n]));
  assert.deepEqual(st, { live: 25, 'host-down': 30, opaque: 5 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agents WHERE first_seen_live_at IS NOT NULL').get().n, 25);
  computeScores(db); writeStats(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM scores').get().n, 60);
  const again = await checkCards(db, { observe }); assert.equal(again.checked, 0); // nothing due
  // a daily card stamped minutes after the timer fired is still rechecked by the next day's run
  const nowSec = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE cards SET next_check_at=?').run(nowSec + 180);
  const nextDay = await checkCards(db, { observe }); assert.ok(nextDay.checked > 0);
  db.prepare('UPDATE cards SET next_check_at=?').run(nowSec + 7 * 3600);
  assert.equal((await checkCards(db, { observe })).checked, 0); // not due yet
});

test('api: shapes, filters, pagination, 404s', async () => {
  const db = seedDb();
  await probeHosts(db, { probe: async (host) => ({ host, dnsOk: host !== 'gone.example' }) });
  await checkCards(db, { observe: async (uri) => uri.startsWith('data:') ? (await import('../src/fetcher.mjs')).observeCard(uri) : { tokenUri: uri, httpStatus: 200, body: JSON.stringify({ name: 'Agent ' + uri.split('/').pop(), url: 'https://alive.example', registrations: [{ agentId: 3, agentRegistry: 'eip155:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' }] }), bytes: 50 } });
  computeScores(db); writeStats(db);
  const app = buildApp({ db });
  const get = async (u) => { const r = await app.inject(u); return { code: r.statusCode, body: r.json(), headers: r.headers }; };

  const s = await get('/api/stats');
  assert.deepEqual(Object.keys(s.body).sort(), ['computedAt', 'dead', 'hostDown', 'live', 'massPlatforms', 'opaque', 'pending', 'platforms', 'registered', 'rpcOk', 'topId', 'unreachable'].sort());
  assert.equal(s.body.registered, 60); assert.equal(s.body.live, 25); assert.equal(s.body.unreachable, 30); assert.equal(s.body.topId, 60);
  assert.equal(s.headers['access-control-allow-origin'], '*');

  const p1 = await get('/api/agents?live=1&limit=10');
  assert.equal(p1.body.items.length, 10); assert.equal(p1.body.total, 25); assert.ok(p1.body.cursor);
  assert.deepEqual(Object.keys(p1.body.items[0]).sort(), ['checkedAt', 'id', 'massPlatform', 'name', 'owner', 'platform', 'ponsLink', 'score', 'status']);
  const seen = new Set(p1.body.items.map((x) => x.id)); let cur = p1.body.cursor;
  while (cur) { const n = await get('/api/agents?live=1&limit=10&cursor=' + cur); n.body.items.forEach((x) => { assert.ok(!seen.has(x.id)); seen.add(x.id); }); cur = n.body.cursor; }
  assert.equal(seen.size, 25);
  const sorted = p1.body.items.map((x) => x.score.total); assert.deepEqual(sorted, [...sorted].sort((a, b) => b - a));

  assert.equal((await get('/api/agents?status=host-down')).body.total, 30);
  assert.equal((await get('/api/agents?q=%233')).body.items[0].id, 3);
  assert.equal((await get('/api/agents?q=agent%2017')).body.items.length, 1);
  assert.equal((await get('/api/agents?platform=gone.example&limit=999')).body.items.length, 30 > 50 ? 50 : 30);
  assert.equal((await get('/api/agents?status=bogus')).code, 400);
  assert.equal((await get('/api/agents?cursor=!!')).code, 400);
  assert.equal((await get('/api/top?limit=3')).body.filters.mass, 'exclude');

  const a = await get('/api/agent/3');
  assert.equal(a.body.card.status, 'live'); assert.equal(a.body.score.v, '1'); assert.equal(a.body.score.parts.card, 35); // 30 + self-consistent 5 (desc missing)
  assert.equal(a.body.score.total, Object.values(a.body.score.parts).reduce((x, y) => x + y, 0));
  assert.equal(a.body.reputation.readable, false);
  assert.equal((await get('/api/agent/3/card')).body.raw.name, 'Agent 3');
  const dead = await get('/api/agent/30'); assert.equal(dead.body.card.status, 'host-down');
  for (const bad of ['0', '61', 'abc', '-1', '1.5']) { const r = await get('/api/agent/' + bad); assert.equal(r.code, 404); assert.deepEqual(r.body, { error: 'no_such_agent', topId: 60 }); }

  const pl = await get('/api/platforms');
  assert.equal(pl.body[0].host, 'gone.example'); assert.equal(pl.body[0].count, 30); assert.equal(pl.body[0].dnsOk, false); assert.ok(pl.body[0].downSince);
  assert.equal(pl.body.find((x) => x.host === 'alive.example').dnsOk, true);
  assert.deepEqual(pl.body[0].sampleIds, [21, 22, 23]);
  const h = await get('/api/health'); assert.deepEqual(Object.keys(h.body).sort(), ['cardQueue', 'lastCardCycleAt', 'lastScanAt', 'ok', 'rpcOk', 'topId', 'uptimeSec']);
  assert.equal((await get('/api/nope')).code, 404);
});

import { probeImagesAndEndpoints, ownerNonces, ponsScan } from '../src/probes.mjs';
test('probes, owner nonce and pons scan feed the score', async () => {
  const db = openDb(':memory:');
  upsertAgents(db, [{ id: 1, exists: 1, owner: '0x' + '1'.repeat(40), agentWallet: null, tokenUri: 'https://a.example/c', platform: 'a.example' }]);
  refreshOwners(db);
  const COIN = '0x' + '5'.repeat(40);
  await checkCards(db, { observe: async (u) => ({ tokenUri: u, httpStatus: 200, body: JSON.stringify({ name: 'Alpha', description: 'd'.repeat(50), image: 'https://a.example/i.png', url: 'https://a.example', note: COIN }), bytes: 9 }) });
  await probeImagesAndEndpoints(db, { check: async () => ({ ok: true }) });
  await ownerNonces(db, { nonce: async () => '0x3e8' });
  await ponsScan(db, { lookup: async (ca) => (ca === COIN ? { symbol: 'AL', name: 'Alpha coin', marketCapUsd: 10 } : null) });
  computeScores(db);
  const s = db.prepare('SELECT * FROM scores WHERE id=1').get();
  assert.equal(s.card, 40); assert.equal(s.endpoint, 10); assert.equal(s.owner, 15); assert.equal(s.pons, 5);
  assert.equal(db.prepare('SELECT ca FROM pons_links WHERE id=1').get().ca, COIN);
});

test('visits: aggregate counter stores no ip/ua, groups pages, refs and bots', async () => {
  const { pageOf, refOf, kindOf } = await import('../src/visits.mjs');
  assert.equal(pageOf('/agent/123'), '/agent/:id'); assert.equal(pageOf('/dist/app.css'), null); assert.equal(pageOf('/'), '/');
  assert.equal(refOf('https://t.co/abc', 'rollycall.xyz'), 'x'); assert.equal(refOf('https://rollycall.xyz/agents', 'rollycall.xyz'), 'internal');
  assert.equal(refOf(undefined, 'rollycall.xyz'), 'direct'); assert.equal(kindOf('Twitterbot/1.0'), 'bot'); assert.equal(kindOf('Mozilla/5.0 (iPhone)'), 'browser');
  const db = openDb(':memory:');
  const app = buildApp({ db });
  await app.inject({ method: 'GET', url: '/', headers: { referer: 'https://t.co/x', 'user-agent': 'Mozilla/5.0' } });
  await app.inject({ method: 'GET', url: '/', headers: { referer: 'https://t.co/y', 'user-agent': 'Mozilla/5.0' } });
  await app.inject({ method: 'GET', url: '/api/health', headers: { 'user-agent': 'curl/8' } });
  const rows = db.prepare('SELECT * FROM visits').all();
  assert.deepEqual(rows.map((r) => [r.page, r.ref, r.kind, r.n]), [['/', 'x', 'browser', 2]]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['hour', 'kind', 'n', 'page', 'ref']);
});
