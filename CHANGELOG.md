# Changelog

## 0.1.0 (unreleased)
- Shared model: liveness (live / unreachable / dead / opaque / host-down), score `score.v` = 1, platform key, Pons link.
- Indexer: top-id search, full scan through Multicall3 `aggregate3`, host probe, card fetcher (https, data:, ipfs://).
- API: `/api/stats`, `/api/agents`, `/api/agent/:id`, `/api/agent/:id/card`, `/api/platforms`, `/api/top`, `/api/health`.
