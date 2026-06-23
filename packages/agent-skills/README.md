# Argent Agent Skills

This package contains installable skill content for agents that work with Argent through its CLI or MCP server.

The skill intentionally avoids private local paths and private data. Agents should read through MCP/CLI first, create proposals for suggested changes, and apply proposals only after an explicit user request.

From a published Argent repository:

```sh
npx skills add <owner>/argent --skill argent
```
