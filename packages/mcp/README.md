---
description: "The MCP package group: connect external Model Context Protocol servers, call their tools, and read their resources."
kind: "package-group"
---

# MCP — Model Context Protocol

English | [中文](README.zh.md)

## Summary

The `mcp/` group lets the model call external Model Context Protocol (MCP) tools and read server resources. Configure only `mcp-client` entries; shipped profiles already mount `mcp-resources` once. MCP tools and prompt text appear only for callers with a configured server in scope. Connections also supply server instructions. Package READMEs own configuration and limitations.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The client owns each configured connection; the shared resource package supplies resource tools across those connections, the status package reports each connection's state, and the selection package decides which servers each Session uses.

| Package | What it provides |
|---|---|
| [`mcp-client/`](mcp-client/README.md) | Connect one MCP server, expose its tools and instructions, and provide its resource operations |
| [`mcp-resources/`](mcp-resources/README.md) | Discover and read resources through shared tools with explicit server selection |
| [`mcp-status/`](mcp-status/README.md) | Live connection state and tool lists of the configured servers, for management surfaces |
| [`mcp-selection/`](mcp-selection/README.md) | Per-Session choice of which configured servers reach the model |
| [`mcp-policy/`](mcp-policy/README.md) | Live store of each server's tool-call policy, changed without reconnecting the server |

-----

<a id="related-documentation"></a>
## Related documentation

Try the worked example configurations to see the plugin in action, then read the Agent Note for the behavior decisions behind it.

- [MCP client plugin Agent Note](../../.agents/notes/implemented/feature/2026-07-07-mcp-client-plugin.md) — the bridge's design: server-qualified naming, discovery, execution, and environment scrubbing.
- [Resources and instructions Agent Note](../../.agents/notes/implemented/feature/2026-09-12-mcp-resources-and-instructions.md) — on-demand resource access and scoped server guidance.
- [Per-Session selection Agent Note](../../.agents/notes/implemented/feature/2026-10-02-per-session-mcp-server-selection.md) — why a Session's servers are logged and enforced through the tool registry.
- [Third-party memory MCP guide](../../docs/user/guide/mcp-memory.md) — runnable overlay rows and setup instructions.
- [Tools subsystem reference](../../docs/subsystems/tools.md) — the `ToolRuntime` that receives the registered tools.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
