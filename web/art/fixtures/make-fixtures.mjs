// Writes hand-made FIXTURE responses for the four landing endpoints (BRIEF §3.4 shapes).
// These are NOT live numbers. Every file carries "_fixture". Re-run: node web/art/fixtures/make-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const NOTE = 'FIXTURE — hand-written for the landing preview, not live data';
const at = '2026-11-04T07:40:00Z';

// host, display, count, live, unreachable, dead, opaque, dnsOk
const named = [
  ['hoodai.fly.dev', 'hoodai.fly.dev', 10142, 0, 10142, 0, 0, false],
  ['bv7x.ai', 'bv7x.ai', 5614, 5381, 133, 100, 0, true],
  ['synths.lol', 'synths.lol', 910, 402, 108, 400, 0, true],
  ['priors:', 'Custom scheme priors:', 931, 0, 0, 0, 931, null],
  ['spin.trading', 'spin.trading', 702, 651, 21, 30, 0, true],
  ['loomdesk.trade', 'loomdesk.trade', 412, 120, 12, 280, 0, true],
  ['a-identity.xyz', 'a-identity.xyz', 288, 260, 8, 20, 0, true],
  ['tasklane.org', 'tasklane.org', 197, 52, 0, 145, 0, true],
  ['meshgateway.co', 'meshgateway.co', 96, 90, 4, 2, 0, true],
  ['alpharc.app', 'alpharc.app', 61, 41, 0, 20, 0, true],
  ['data:', 'Self-contained (data URI)', 44, 40, 4, 0, 0, null],
  ['ipfs:', 'IPFS', 31, 18, 13, 0, 0, null],
  ['tickerspring.com', 'tickerspring.com', 27, 27, 0, 0, 0, true],
  ['evoevo.ai', 'evoevo.ai', 19, 19, 0, 0, 0, true],
];
// 24 small placeholder hosts (clearly fake names) sharing the remaining 1,277 ids
let rest = 1277;
for (let i = 1; i <= 24; i++) {
  const c = i === 24 ? rest : Math.max(4, Math.round(rest / (25 - i) * (1.6 - i / 24)));
  rest -= c;
  const live = Math.round(c * 0.55), dead = Math.round(c * 0.3);
  named.push([`fixture-host-${String(i).padStart(2, '0')}.example`, `fixture-host-${String(i).padStart(2, '0')}.example`, c, live, c - live - dead, dead, 0, true]);
}
let nextId = 1;
const platforms = named.map(([host, display, count, live, unreachable, dead, opaque, dnsOk]) => {
  const first = nextId; nextId += count;
  return { host, display, count, live, dead, unreachable, opaque, massPlatform: count > 1000, dnsOk, lastProbeAt: at, sampleIds: [first, first + 1, first + 2] };
}).sort((a, b) => b.count - a.count);

const sum = (k) => platforms.reduce((a, p) => a + p[k], 0);
const stats = {
  _fixture: NOTE,
  registered: sum('count'), live: sum('live'), unreachable: sum('unreachable'), dead: sum('dead'), opaque: sum('opaque'),
  platforms: platforms.length, massPlatforms: platforms.filter((p) => p.massPlatform).length,
  topId: sum('count'), computedAt: at, rpcOk: true,
};

const row = (id, name, platform, status, total, ponsLink = null) => ({
  id, name, platform, status, checkedAt: status === 'opaque' ? null : at, score: { total },
  owner: '0x' + (id * 7919).toString(16).padStart(40, '0'), ponsLink, massPlatform: platform === 'bv7x.ai' || platform === 'hoodai.fly.dev',
});
const agents = {
  _fixture: NOTE,
  items: [
    row(20700, 'Spinner #69', 'spin.trading', 'live', 71),
    row(20311, 'Fixture Agent Kestrel', 'a-identity.xyz', 'live', 68, { ca: '0x' + 'f1'.repeat(20), symbol: 'FIXT' }),
    row(19982, 'Fixture Agent Ledgerline', 'meshgateway.co', 'live', 66),
    row(1204, 'Fixture Agent bv7x-1204', 'bv7x.ai', 'live', 58),
    row(20118, 'Fixture Agent Tasker', 'tasklane.org', 'live', 55),
    row(3381, 'Fixture Agent bv7x-3381', 'bv7x.ai', 'live', 54),
    row(19840, 'Fixture Agent Loom', 'loomdesk.trade', 'unreachable', 12),
    row(20502, 'Fixture Agent Prior', 'priors:', 'opaque', 4),
    row(15000, null, 'hoodai.fly.dev', 'host-down', 3),
    row(20044, 'Fixture Agent Synth', 'synths.lol', 'dead', 2),
  ],
  cursor: 'fixture', total: stats.registered,
};
const top = { _fixture: NOTE, filters: { mass: 'exclude' }, items: agents.items.filter((a) => !a.massPlatform).slice(0, 3) };

const token = { symbol: 'ROLLY', ca: '0x0000000000000000000000000000000000000000', launched: false, tickerPublic: true, teamWallet: '', minHold: 0, taxBps: null, launchDate: '2026-11-05' };
const transcript = {
  _fixture: NOTE + ' (replace with a real MCP capture on day 3)',
  lines: [
    '> search_agents {"query":"trading","limit":3}',
    '{ "items": [',
    '  { "id": 20700, "name": "Spinner #69", "platform": "spin.trading", "status": "live", "score": 71 },',
    '  { "id": 19840, "name": "Fixture Agent Loom", "platform": "loomdesk.trade", "status": "unreachable", "score": 12 } ],',
    '  "total": 2,',
    '  "note": "score is a Rollycall heuristic; verify with the cast lines in verify[]" }',
  ],
};

const w = (f, o) => fs.writeFileSync(path.join(dir, f), JSON.stringify(o, null, 2) + '\n');
w('stats.json', stats);
w('top.json', top);
w('agents.json', agents);
w('platforms.json', platforms); // the API returns a bare array
w('token.json', token);
w('mcp-transcript.json', transcript);
console.log('fixtures:', stats);
