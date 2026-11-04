// Visit report from the aggregate counter. Usage: node scripts/visits.mjs [--state DIR] [--since 2026-11-05T00]
import { openDb } from '../server/src/db.mjs';
import { config } from '../server/src/config.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const db = openDb(arg('state', config.stateDir) + '/rollycall.db');
const since = arg('since', new Date(Date.now() - 24 * 3600e3).toISOString().slice(0, 13));
const q = (sql) => db.prepare(sql).all(since);

const total = q(`SELECT kind, SUM(n) n FROM visits WHERE hour >= ? GROUP BY kind`);
console.log(`since ${since}:00Z  ` + total.map((r) => `${r.kind} ${r.n}`).join(' · '));
console.log('\nbrowser page views per hour (UTC)');
for (const r of q(`SELECT hour, SUM(n) n FROM visits WHERE hour >= ? AND kind='browser' AND page!='api' GROUP BY hour ORDER BY hour`)) console.log(`  ${r.hour}  ${r.n}`);
console.log('\nbrowser views by page');
for (const r of q(`SELECT page, SUM(n) n FROM visits WHERE hour >= ? AND kind='browser' GROUP BY page ORDER BY n DESC`)) console.log(`  ${String(r.n).padStart(5)}  ${r.page}`);
console.log('\nbrowser views by referrer');
for (const r of q(`SELECT ref, SUM(n) n FROM visits WHERE hour >= ? AND kind='browser' GROUP BY ref ORDER BY n DESC LIMIT 15`)) console.log(`  ${String(r.n).padStart(5)}  ${r.ref}`);
