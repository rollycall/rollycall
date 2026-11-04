import { openDb } from './db.mjs';
import { buildApp } from './app.mjs';
import { makeRpc } from './rpc.mjs';
import { config } from './config.mjs';

const db = openDb(config.stateDir + '/rollycall.db');
const app = buildApp({ db, rpc: makeRpc() });
await app.listen({ port: config.port, host: config.host });
console.log(`rollycall api on http://${config.host}:${config.port}`);
