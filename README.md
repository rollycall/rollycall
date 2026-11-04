# Rollycall

An ERC-8004 explorer and ranking for Robinhood Chain (chain 4663). Every agent id in the Identity Registry is crawled, its agent-card is fetched, agents are grouped by the platform that hosts the card, and ranked by a score you can recompute.

- Live means: the agent-card URL answered HTTP 200 with valid JSON and a name, the last time we checked.
- The score is our heuristic. It is not reputation, not an audit, and not endorsement.
- No wallet, no signature, no contract. Read-only.

Live: https://rollycall.xyz · X: https://x.com/rollycallagent · MCP: `claude mcp add rollycall -- npx -y rollycall-mcp` ([npm](https://www.npmjs.com/package/rollycall-mcp), source in `mcp/`)

## Run

```
npm install
node scripts/index.mjs      # crawl the registry into state/rollycall.db
npm start                   # API on 127.0.0.1:4830
npm test
```

```
curl 127.0.0.1:4830/api/agents?live=1&limit=20
```

Score: card 45, endpoint 10, observed age 15, owner activity 15, independence 10, Pons link 5 (`shared/model.mjs`).

MIT licensed.
