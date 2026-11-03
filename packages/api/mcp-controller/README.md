---
description: "The mcpServers Remote reports MCP tool lists and usage, sets the servers a Session uses, and lets one tool run without asking."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-mcp-controller

English | [中文](README.zh.md)

## Summary

The `mcpServers` Remote serves the MCP operations a browser needs beyond the [MCP manager](../../mcp/mcp-manager/README.md) and the [Settings](../settings-controller/README.md) Remote: each server's registered tools and usage counters, the servers one Session uses, and a one-click allowance for one tool. Server entries, tool-call policies, and default selection are Settings fields; connection status, restart, and probe are `mcpManager` operations.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The [web bundle](../../bundle/web-app/README.md) mounts the controller as `mcp-servers-controller`; the Plugins page consumes it. Every method is keyed by the server name, the `servers` key of the manager entry or the `serverName` of a static `mcp-client` row.

| Method | Effect |
|---|---|
| `tools(serverName)` | The tools the server registered right now, with descriptions and parameters, from the [status service](../../mcp/mcp-status/README.md) |
| `overview(sessionId?)` | Every running client's usage counters and its default after [mcp-selection](../../mcp/mcp-selection/README.md) overrides, with the Host clock they were read at; with a Session id, each entry also carries that Session's share as `sessionStats` |
| `setSessionServers(sessionId, active)` | Replace the servers one Session uses through `mcp-selection`; returns the servers in use |
| `allowTool(publicName)` | Let one tool run without asking from now on, by its model-facing name, keeping the rest of its server's policy in [mcp-policy](../../mcp/mcp-policy/README.md) |

`allowTool` returns `{ ok: true, serverName, tool }`, or `{ ok: false, code, message }` with `unknown-tool` when no running client offers the tool, `no-policy-store` when the profile does not mount the policy store, and `write-failed` when the config editor refuses the write, for example because a home patch or overlay owns the store's entry. The write goes through the config editor into the profile patch and applies without reconnecting the server.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The Remote: reads `mcpStatus`, delegates selection to `mcpSelection`, and writes the policy store through `configEditor` |
| [`src/types.ts`](src/types.ts) | Records shared with clients |

Every read is served from the status registry at call time, so the controller holds no state. `allowTool` finds the policy store's Loader entry by module name, or by plugin for a composition that registers the class directly.

No runtime invariant companion is published: the controller keeps no state of its own.

</details>

<a id="model-experience"></a>
## Model Experience

None directly. A Session's selection changes which MCP tools and instructions its later requests carry, as [mcp-selection](../../mcp/mcp-selection/README.md#model-experience) describes; an allowed tool stops asking the person but changes no request content.

#### KV Cache effect

A selection change alters the tool definitions of that Session's later requests; the controller itself adds no tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Usage and tool lists cover running clients only: a disabled or failed server has no entry in `overview` and no tools.
- Servers are keyed by name; two Agent scopes that reuse one `serverName` share an entry, and the first registration answers.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [MCP servers on the Plugins page](../../../.agents/notes/implemented/feature/2026-10-01-mcp-servers-on-the-plugins-page.md) Agent Note records the original design; server entries moved to the MCP manager's Settings fields when the fork adopted upstream's manager.

</details>
