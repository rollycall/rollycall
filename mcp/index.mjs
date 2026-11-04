#!/usr/bin/env node
// rollycall-mcp: stdio MCP server, thin client over the public Rollycall API. Read-only.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API = (process.env.ROLLYCALL_API || 'https://rollycall.xyz/api').replace(/\/$/, '');
const SITE = API.replace(/\/api$/, '');
const NOTE = 'score is a Rollycall heuristic; verify with the cast lines in verify[]';

async function get(path) {
  const r = await fetch(API + path, { headers: { accept: 'application/json', 'user-agent': 'rollycall-mcp/0.1' }, signal: AbortSignal.timeout(15000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ? `${body.error}${body.topId ? ` (top id ${body.topId})` : ''}` : `HTTP ${r.status}`);
  return body;
}
const out = (obj) => ({ content: [{ type: 'text', text: JSON.stringify({ ...obj, note: NOTE }, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: `Rollycall API error: ${e.message}` }] });
const row = (a) => ({ id: a.id, name: a.name, platform: a.platform, status: a.status, score: a.score?.total ?? null, massPlatform: a.massPlatform, url: `${SITE}/agent/${a.id}` });
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); return p.toString(); };

const server = new McpServer({ name: 'rollycall', version: '0.1.0' });

server.tool('search_agents', 'Search ERC-8004 agents on Robinhood Chain by name or description. Live means the agent-card answered 200 with JSON and a name at the last check.',
  { query: z.string().min(1).max(100), live: z.boolean().optional().default(true), platform: z.string().optional(), excludeMassPlatforms: z.boolean().optional().default(false), limit: z.number().int().min(1).max(50).optional().default(20) },
  async ({ query, live, platform, excludeMassPlatforms, limit }) => {
    try {
      const r = await get('/agents?' + qs({ q: query, status: live ? 'live' : 'any', platform, mass: excludeMassPlatforms ? 'exclude' : 'include', limit }));
      return out({ items: r.items.map(row), total: r.total });
    } catch (e) { return fail(e); }
  });

server.tool('get_agent', 'Full record for one agent id: card, services, score breakdown with inputs, Pons link, and cast lines to verify on chain.',
  { id: z.number().int().min(1) },
  async ({ id }) => { try { return out(await get('/agent/' + id)); } catch (e) { return fail(e); } });

server.tool('list_platforms', 'Platforms (card hosts) with agent counts, live/dead split, mass-platform flag and DNS status.', {},
  async () => { try { return out({ items: await get('/platforms') }); } catch (e) { return fail(e); } });

server.tool('top_agents', 'Top live agents by Rollycall score. Mass platforms are excluded by default (echoed in filters).',
  { limit: z.number().int().min(1).max(50).optional().default(10), excludeMassPlatforms: z.boolean().optional().default(true), platform: z.string().optional() },
  async ({ limit, excludeMassPlatforms, platform }) => {
    try {
      const r = await get('/top?' + qs({ limit, mass: excludeMassPlatforms ? 'exclude' : 'include', platform }));
      return out({ items: r.items.map(row), filters: r.filters, total: r.total });
    } catch (e) { return fail(e); }
  });

await server.connect(new StdioServerTransport());
