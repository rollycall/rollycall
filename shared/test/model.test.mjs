import test from 'node:test';
import assert from 'node:assert/strict';
import { livenessOf, scoreOf, platformOf, ponsLinkOf, ponsCandidates, selfConsistentOf, L, IDENTITY_REGISTRY, MULTICALL3, isMassPlatform } from '../index.mjs';

const NOW = Date.UTC(2026, 10, 4, 12);
const H = 3600_000;
const a2a = JSON.stringify({ protocolVersion: '0.3.0', name: 'Alpha', url: 'https://x.example/a2a' });
const reg = JSON.stringify({ type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'Beta', services: [{ name: 'web', endpoint: 'https://b.example' }] });
const https = 'https://card.example/agent-card.json';

// 12 liveness fixtures
const F = [
  ['A2A card', { tokenUri: https, httpStatus: 200, body: a2a }, 'live', null],
  ['registration-v1', { tokenUri: https, httpStatus: 200, body: reg }, 'live', null],
  ['data: base64 (decoded)', { tokenUri: 'data:application/json;base64,e30=', body: reg }, 'live', null],
  ['ipfs gateway 200', { tokenUri: 'ipfs://bafkreiabc', httpStatus: 200, body: a2a }, 'live', null],
  ['HTML 200', { tokenUri: https, httpStatus: 200, body: '<html>hi</html>' }, 'unreachable', 'not_json'],
  ['JSON without name', { tokenUri: https, httpStatus: 200, body: '{"url":"x"}' }, 'unreachable', 'no_name'],
  ['custom scheme', { tokenUri: 'priors:agent:0xabc' }, 'opaque', 'scheme_priors'],
  ['DNS fail (host probe)', { tokenUri: https, hostDown: true }, 'host-down', 'host_down'],
  ['timeout', { tokenUri: https, error: 'timeout' }, 'unreachable', 'timeout'],
  ['429', { tokenUri: https, httpStatus: 429 }, 'unreachable', 'http_429'],
  ['redirect then 200', { tokenUri: https, httpStatus: 200, redirected: true, body: a2a }, 'live', null],
  ['> 512 KB truncated', { tokenUri: https, httpStatus: 200, truncated: true, body: '{"name":"x","pad":"' + 'a'.repeat(1000) }, 'unreachable', 'too_large'],
];
for (const [label, obs, status, reason] of F) {
  test('liveness: ' + label, () => {
    const r = livenessOf({ ...obs, now: NOW });
    assert.equal(r.status, status);
    assert.equal(r.reason, reason);
  });
}
test('liveness: extra edge cases', () => {
  assert.equal(livenessOf({ tokenUri: '', now: NOW }).status, 'opaque');
  assert.equal(livenessOf({ tokenUri: 'javascript:alert(1)', now: NOW }).status, 'opaque');
  assert.equal(livenessOf({ tokenUri: https, httpStatus: 500, now: NOW }).reason, 'http_500');
  assert.equal(livenessOf({ tokenUri: https, httpStatus: 200, body: '[]', now: NOW }).status, 'unreachable');
  assert.equal(livenessOf({ tokenUri: 'data:application/json;base64,!!', error: 'bad_data_uri', now: NOW }).reason, 'bad_data_uri');
});
test('liveness: 3 fails over 72 h => dead; fewer or shorter => unreachable; success resets', () => {
  let p = livenessOf({ tokenUri: https, error: 'timeout', now: NOW });
  assert.equal(p.failCount, 1); assert.equal(p.firstFailAt, NOW);
  p = livenessOf({ tokenUri: https, error: 'timeout', now: NOW + 24 * H, prev: p });
  p = livenessOf({ tokenUri: https, error: 'timeout', now: NOW + 48 * H, prev: p });
  assert.equal(p.failCount, 3); assert.equal(p.status, 'unreachable'); // only 48 h
  const d = livenessOf({ tokenUri: https, error: 'timeout', now: NOW + 72 * H, prev: p });
  assert.equal(d.status, 'dead'); assert.equal(d.firstFailAt, NOW);
  const hd = livenessOf({ tokenUri: https, hostDown: true, now: NOW + 80 * H, prev: { failCount: 3, firstFailAt: NOW } });
  assert.equal(hd.status, 'dead');
  const back = livenessOf({ tokenUri: https, httpStatus: 200, body: a2a, now: NOW + 96 * H, prev: d });
  assert.equal(back.status, 'live'); assert.equal(back.failCount, 0);
});

// score anchors
const base = { status: 'live', nameLen: 5, descLen: 60, imageOk: true, selfConsistent: true, endpointOk: true, observedDays: 0, ownerNonce: 0, platformCount: 5, ownerAgentCount: 1, ponsCa: null };
test('score: card part', () => {
  assert.equal(scoreOf({ ...base }).parts.card, 45);
  assert.equal(scoreOf({ ...base, imageOk: false, selfConsistent: false, descLen: 10 }).parts.card, 30);
  assert.equal(scoreOf({ ...base, status: 'dead' }).parts.card, 0);
  assert.equal(scoreOf({ ...base, status: 'unreachable', endpointOk: false }).total, 0 + 0 + 0 + 0 + 10);
});
test('score: owner anchors 0/1/30/1000', () => {
  const o = (n) => scoreOf({ ...base, ownerNonce: n }).parts.owner;
  assert.deepEqual([o(0), o(1), o(30), o(1000), o(10 ** 7)], [0, 2, 7, 15, 15]);
});
test('score: age anchors', () => {
  const a = (d) => scoreOf({ ...base, observedDays: d }).parts.age;
  assert.deepEqual([a(0), a(90), a(900), a(1)], [0, 15, 15, 2]);
});
test('score: independence tiers (min of host, owner)', () => {
  const s = (p, o) => scoreOf({ ...base, platformCount: p, ownerAgentCount: o }).parts.independence;
  assert.equal(s(10, 3), 10); assert.equal(s(11, 3), 7); assert.equal(s(100, 1), 7); assert.equal(s(101, 1), 4);
  assert.equal(s(1000, 1), 4); assert.equal(s(1001, 1), 1); assert.equal(s(5, 4), 6); assert.equal(s(5, 20), 6); assert.equal(s(5, 21), 2); assert.equal(s(1500, 50), 1);
});
test('score: pons 5, total, version, max 100', () => {
  const r = scoreOf({ ...base, observedDays: 90, ownerNonce: 1000, ponsCa: '0xabc' });
  assert.equal(r.parts.pons, 5); assert.equal(r.total, 100); assert.equal(r.v, '1');
  assert.equal(r.total, Object.values(r.parts).reduce((a, b) => a + b, 0));
  assert.equal(r.inputs.ponsCa, '0xabc');
});
test('L helper clamps', () => { assert.equal(L(-5, 90), 0); assert.equal(L(1e9, 90), 100); });
test('selfConsistentOf', () => {
  const card = { registrations: [{ agentId: 7, agentRegistry: `eip155:4663:${IDENTITY_REGISTRY}` }] };
  assert.equal(selfConsistentOf(card, 7), true); assert.equal(selfConsistentOf(card, 8), false); assert.equal(selfConsistentOf({}, 7), false);
});

// platform keying (10 hosts + non-http)
const P = [
  ['https://bv7x.ai/agents/1/card.json', 'bv7x.ai'],
  ['https://api.synths.lol/a/1', 'synths.lol'],
  ['https://hoodai.fly.dev/c/9', 'hoodai.fly.dev'],
  ['https://foo.hoodai.fly.dev/c/9', 'foo.hoodai.fly.dev'],
  ['https://my-agent.vercel.app/card', 'my-agent.vercel.app'],
  ['https://user.github.io/repo/card.json', 'user.github.io'],
  ['https://a.b.workers.dev/x', 'a.b.workers.dev'],
  ['https://www.priors.trade/x', 'priors.trade'],
  ['https://tasklane.org/x', 'tasklane.org'],
  ['https://spin.trading/token/69', 'spin.trading'],
  ['https://foo.example.co.uk/x', 'example.co.uk'],
];
for (const [u, k] of P) test('platform: ' + u, () => { assert.equal(platformOf(u).key, k); });
test('platform: non-http', () => {
  assert.deepEqual(platformOf('data:application/json;base64,e30='), { key: 'data:', display: 'Self-contained (data URI)', host: null, kind: 'data' });
  assert.equal(platformOf('ipfs://bafk').display, 'IPFS');
  assert.equal(platformOf('priors:agent:0x1').key, 'priors:');
  assert.equal(platformOf('priors:agent:0x1').display, 'Custom scheme `priors:`');
  assert.equal(platformOf('').key, 'empty:');
  assert.equal(isMassPlatform(1000), false); assert.equal(isMassPlatform(1001), true);
});

// ponsLink
const COIN = '0x1111111111111111111111111111111111111111';
const NOTCOIN = '0x2222222222222222222222222222222222222222';
const OWNER = '0x3333333333333333333333333333333333333333';
const lookup = async (ca) => (ca === COIN ? { name: 'Coin', symbol: 'CN', marketCapUsd: 5, volumeUsd: 1, tradeCount: 3, stage: 'curve' } : null);
test('pons: card with Pons CA', async () => {
  const r = await ponsLinkOf({ name: 'x', description: `buy ${COIN.toUpperCase().replace('0X', '0x')} now` }, null, lookup);
  assert.equal(r.ca, COIN); assert.equal(r.symbol, 'CN');
});
test('pons: non-Pons address => null', async () => {
  assert.equal(await ponsLinkOf({ name: 'x', wallet: NOTCOIN }, null, lookup), null);
});
test('pons: no address => null; lookup not called', async () => {
  let n = 0; assert.equal(await ponsLinkOf({ name: 'our token' }, null, async () => { n++; return {}; }), null); assert.equal(n, 0);
});
test('pons: known non-coins dropped, endpoint text scanned, first hit wins, max 5', async () => {
  const c = ponsCandidates({ r: IDENTITY_REGISTRY, m: MULTICALL3, o: OWNER, z: '0x' + '0'.repeat(40) }, `see ${COIN}`, { owner: OWNER });
  assert.deepEqual(c, [COIN]);
  const many = ponsCandidates({ a: Array.from({ length: 8 }, (_, i) => '0x' + String(i + 1).repeat(40)) }, null);
  assert.equal(many.length, 5);
  assert.equal(ponsCandidates({}, 'x'.repeat(300 * 1024) + COIN).length, 0);
});
