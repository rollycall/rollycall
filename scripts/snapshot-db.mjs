// Consistent copy of the SQLite state (WAL-safe) for upload. Usage: node scripts/snapshot-db.mjs [src] [dest]
import Database from 'better-sqlite3';
const src = process.argv[2] || 'state/rollycall.db', dest = process.argv[3] || 'state/rollycall.snapshot.db';
const db = new Database(src, { readonly: true });
await db.backup(dest);
console.log('snapshot written:', dest);
