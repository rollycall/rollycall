import { fileURLToPath } from 'node:url';
const env = process.env;
export const config = {
  port: +(env.PORT || 4830),
  host: env.HOST || '127.0.0.1',
  stateDir: env.STATE_DIR || fileURLToPath(new URL('../../state', import.meta.url)),
  rpcUrl: env.RPC_URL || 'https://robinhood-rpc.publicnode.com',
  ipfsGateways: (env.IPFS_GATEWAY ? [env.IPFS_GATEWAY] : ['https://gateway.pinata.cloud/ipfs/']).concat(['https://w3s.link/ipfs/']),
  domain: env.DOMAIN || 'rollycall.xyz',
  userAgent: `rollycall/0.1 (+https://${env.DOMAIN || 'rollycall.xyz'}/docs#crawler)`,
  idsPerBatch: 166, // 166 ids x 3 calls = 498 calls per aggregate3
  multicallGapMs: 1000,
  plainGapMs: 250,
  rpcTimeoutMs: 15000,
  cardTimeoutMs: 8000,
  cardMaxBytes: 512 * 1024,
  cardJsonStoreBytes: 64 * 1024,
  globalConcurrency: 8,
  perHostConcurrency: 2,
  perHostGapMs: 500, // <= 2 r/s per host
  version: '0.1.0',
};
