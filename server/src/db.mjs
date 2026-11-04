import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY, owner TEXT, agent_wallet TEXT, token_uri TEXT, platform TEXT,
  first_seen_at INTEGER, first_seen_live_at INTEGER, last_scanned_at INTEGER, "exists" INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS agents_platform ON agents(platform);
CREATE INDEX IF NOT EXISTS agents_owner ON agents(owner);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY, status TEXT NOT NULL, reason TEXT, http_status INTEGER, content_type TEXT, bytes INTEGER,
  json TEXT, json_truncated INTEGER DEFAULT 0, name TEXT, description TEXT, image TEXT, endpoint_url TEXT,
  self_consistent INTEGER DEFAULT 0, redirect_host TEXT, fail_count INTEGER DEFAULT 0, first_fail_at INTEGER,
  checked_at INTEGER, next_check_at INTEGER);
CREATE INDEX IF NOT EXISTS cards_status ON cards(status);
CREATE TABLE IF NOT EXISTS card_history (id INTEGER, checked_at INTEGER, status TEXT, reason TEXT);
CREATE INDEX IF NOT EXISTS card_history_id ON card_history(id);
CREATE TABLE IF NOT EXISTS probes (id INTEGER PRIMARY KEY, image_ok INTEGER, endpoint_ok INTEGER, probed_at INTEGER);
CREATE TABLE IF NOT EXISTS owners (owner TEXT PRIMARY KEY, nonce INTEGER, agent_count INTEGER, checked_at INTEGER);
CREATE TABLE IF NOT EXISTS hosts (host TEXT PRIMARY KEY, dns_ok INTEGER, down_since INTEGER, last_probe_at INTEGER, agent_count INTEGER, note TEXT);
CREATE TABLE IF NOT EXISTS pons_links (id INTEGER PRIMARY KEY, ca TEXT, symbol TEXT, name TEXT, market_cap_usd REAL, volume_usd REAL, trade_count INTEGER, stage TEXT, fetched_at INTEGER);
CREATE TABLE IF NOT EXISTS pons_negative (ca TEXT PRIMARY KEY, until INTEGER);
CREATE TABLE IF NOT EXISTS scores (id INTEGER PRIMARY KEY, v TEXT, total INTEGER, card INTEGER, endpoint INTEGER, age INTEGER, owner INTEGER, independence INTEGER, pons INTEGER, computed_at INTEGER);
CREATE INDEX IF NOT EXISTS scores_total ON scores(total DESC, id ASC);
CREATE TABLE IF NOT EXISTS stats_daily (day TEXT PRIMARY KEY, registered INTEGER, live INTEGER, unreachable INTEGER, dead INTEGER, opaque INTEGER, platforms INTEGER, computed_at INTEGER);
CREATE TABLE IF NOT EXISTS holders (address TEXT PRIMARY KEY, raw TEXT, checked_at INTEGER);
CREATE TABLE IF NOT EXISTS metrics (day TEXT, key TEXT, count INTEGER, PRIMARY KEY(day, key));
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  if (path !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);
  return db;
}
export const getMeta = (db, k, d = null) => db.prepare('SELECT value FROM meta WHERE key=?').get(k)?.value ?? d;
export const setMeta = (db, k, v) => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
