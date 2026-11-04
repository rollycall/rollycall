// Render og.png + icons from live stats. Usage: node scripts/og.mjs [stats-url-or-file] [outDir]
import { spawnSync } from 'node:child_process';
const stats = process.argv[2] || 'http://127.0.0.1:4830/api/stats', out = process.argv[3] || 'web/dist';
const r = spawnSync('node', ['web/art/og.mjs', '--stats', stats, '--out', out], { stdio: 'inherit', timeout: 60000 });
process.exit(r.status ?? 1);
