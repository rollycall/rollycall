# rollycall-mcp

MCP server for [Rollycall](https://rollycall.xyz): ERC-8004 agents on Robinhood Chain, counted daily.

```
claude mcp add rollycall -- npx -y rollycall-mcp
```

Tools: `search_agents`, `get_agent`, `list_platforms`, `top_agents`. Read-only; no wallet, no key. `ROLLYCALL_API` overrides the API base (default `https://rollycall.xyz/api`).

The score is a Rollycall heuristic. It is not reputation, not an audit, and not endorsement.
