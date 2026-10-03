---
description: "The mcpServers Remote lists, adds, edits, enables, and removes MCP server rows in the active profile patch without hand-editing files."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-mcp-controller

English | [中文](README.zh.md)

## Summary

The `mcpServers` Remote lets a UI manage `@deepseek-ai/dsh-mcp-client` rows in the active profile's `cordis.patch.yml`. Each write keeps comments and unmanaged keys, applies through hot reload when the profile has it, and restores the file when the reload fails. Secrets are written as environment variable references and are never returned.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The [web bundle](../../bundle/web-app/README.md) mounts the controller as `mcp-servers-controller`; the Plugins page consumes it. A custom profile mounts `@deepseek-ai/dsh-api-mcp-controller` after the Loader, `app-boot`'s profile context, and ideally HMR.

| Method | Effect |
|---|---|
| `list()` | Every MCP row of the running profile, including rows from bundles, the home patch, and command-line overlays, with `owned`, `readOnlyReason`, `enabled`, the live `fiberPhase`, and the client's `status` (connection state, last error, attempt count, tool count) when the [status service](../../mcp/mcp-status/README.md) is mounted |
| `upsert(spec, { id?, confirmedCommand? })` | Add `mcp-<serverName>`, or replace the managed keys of the row `id` names |
| `setEnabled(id, enabled)` | Write `disabled` on a row the profile patch owns |
| `removeServer(id)` | Delete a row the profile patch owns |
| `setToolPolicy(id, policy)` | Replace one server's tool-call policy. With [mcp-policy](../../mcp/mcp-policy/README.md) mounted it is written to that store through the config editor, applies without reconnecting the server, and works for every listed row; otherwise only an editable owned row changes, and its server reloads. It runs no command, so it needs no confirmation |
| `allowTool(publicName)` | Let one tool run without asking from now on, by its model-facing name, keeping the rest of its server's policy; needs the policy store |
| `tools(id)` | The tools the server offers right now, with its connection state |
| `reconnectServer(id)` | Ask the server's client to connect now; returns whether an attempt started |
| `overview(sessionId?)` | Every row's connection state and usage counters in one call, with the Host clock they were read at; with a Session id, each row also carries that Session's share as `sessionStats` |
| `setSessionServers(sessionId, active)` | Replace the servers one Session uses through [`mcp-selection`](../../mcp/mcp-selection/README.md); returns the servers in use |

Every write returns `{ changed, application, target, error?, warnings? }`. `application` is `applied` after the Loader reconciled the change, `restart-required` when the profile has no hot reload, and `failed` with an `error.code` otherwise: `invalid-config`, `duplicate-server`, `confirmation-required`, `literal-secret`, `unknown-server`, `read-only`, `unreadable-patch`, or `operation-error`. A failed change leaves the patch file as it was.

A stdio server runs a command with the Host's privileges. `upsert` refuses to add or change one until `confirmedCommand` equals the command line the Host reports in the `confirmation-required` error, so the caller must show that exact text to the person first.

### Secrets

An `env` or `headers` value is a literal, an environment variable reference (`{ kind: 'env', name, scheme? }`, written as `!!js process.env.NAME` or the `Bearer` template), an `expression` the file already holds, or `kept`. An environment reference must name a variable that is set in the Host environment when the change is saved: the Loader refuses a config whose `env` value is undefined, and a `Bearer` header would send the text `undefined`, so `upsert` refuses it with `invalid-config`. A literal under a credential-shaped key (`KEY`, `PASSWORD`, `SECRET`, `TOKEN` for `env`; those plus `authorization`, `cookie` for `headers`) is refused with `literal-secret`, as is a URL with a user name, a password, or a credential-shaped query parameter, and a command-line argument that carries a value for a credential-shaped option (`--token x`, `--api-key=x`). When a hand-written file already holds such a literal, `list` returns `kept` in its place and `upsert` accepts `kept` to leave the stored value unchanged. An `expression` is accepted only when it matches the source already stored under the same key, so a client cannot submit code. A row whose URL or arguments embed credentials is listed read-only with `embedded-credentials`, a URL without them, and a command line with those argument values shown as `***`. Every row lists the `toolPolicy` in force: the stored one, else the row's own, else the plugin default. With the store mounted, `upsert` writes a spec's `toolPolicy` there instead of into the row, and `removeServer` drops the server's stored policy.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The Remote: composes rows from the layered patches, serializes writes with HMR and the profile file lock, rolls back on a failed reload |
| [`src/patch.ts`](src/patch.ts) | Text-to-text edits of the YAML AST that keep comments, unmanaged keys, and the `!!js` tag |
| [`src/spec.ts`](src/spec.ts) | Credential rules, the `mcp-client` Config schema and load-time checks, and redaction |
| [`src/types.ts`](src/types.ts) | Records shared with clients |

The controller edits only rows the profile patch inserts. Rows from bundles, the home patch, and overlays are listed read-only because a profile-patch edit would not be the effective value. Validation imports `@deepseek-ai/dsh-mcp-client` when a write is checked, so a profile without that package fails the write with `invalid-config`, not at load. After a write the controller emits `plugin-manager/changed` so the Plugins page refreshes.

No runtime invariant companion is published: the rows are derived from the same patch files the Loader reads, so there is no second observation to reconcile.

</details>

<a id="model-experience"></a>
## Model Experience

None, as the controller only changes which MCP servers a profile loads, and the model sees the resulting tools and instructions through the [MCP client](../../mcp/mcp-client/README.md#model-experience).

#### KV Cache effect

A change that adds, removes, or reconnects a server changes the tool definitions of later requests as the MCP client describes; the controller itself adds no tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Connection state needs the status service: without it a row has no `status`, and a saved server whose first connection fails is listed with `fiberPhase: 'active'`.
- Only rows the profile patch inserts can be edited, enabled, disabled, or removed; a row with a `!!js` value outside `env` and `headers` can be removed or toggled but not edited.
- The form manages `transport`, `serverName`, the command or URL, `args`, `env`, `headers`, `cwd`, `toolCallTimeoutMs`, `failOnStartupError`, and `defaultActive`. Other keys such as `reconnect` stay as the file holds them.
- A URL that carries a token in its query string is stored as typed and shown in the editable `spec`; the list summary omits the query.
- Profiles without HMR apply a change on the next start; `list` then shows the row with no live phase.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [MCP servers on the Plugins page](../../../.agents/notes/implemented/feature/2026-10-01-mcp-servers-on-the-plugins-page.md) Agent Note records the design and the rejected alternatives.

</details>
