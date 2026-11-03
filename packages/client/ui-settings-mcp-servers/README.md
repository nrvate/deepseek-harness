---
description: "The MCP servers page on the dsh web client's Plugins page and the MCP status item below the prompt box: manage, test, and watch the MCP manager's servers and their usage."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-mcp-servers

English | [中文](README.zh.md)

## Summary

Open **Plugins** in the sidebar and select **MCP servers** in the Official group to add, edit, test, enable, disable, and remove the servers the [MCP manager](../../mcp/mcp-manager/README.md) runs, without editing files. Each server is a local command or an HTTP endpoint. Secrets go to the credentials store and the profile settings keep only their names. A status item below the prompt box shows how many servers are connected and opens their usage figures. The page and the item exist while the Host serves the `mcpManager`, `mcpServers`, `settings`, and `credentials` Remotes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The **MCP servers** card opens the list. Each row shows the server's name, type, live state, and command or URL, with a tag for where it comes from: **From the profile**, **Changed from the profile**, **Registered by a plugin**, or none for a server added here. The state reads **Connected**, **Connecting**, **Reconnecting (attempt/limit), next try in …**, **Waiting for credentials**, **Not connected**, **Off**, or **Cleanup incomplete**, and the last error shows under the command. The switch enables or disables a server, **Tools (n)** opens the server's tools, **Reconnect** restarts a server that stopped trying, waits out a retry, or waits for a credential, **Test** connects to the server apart from the running one and reports what it offers, **Edit** opens the form, **Remove** deletes a server added here, and **Restore default** drops the changes made to a server from the profile. A plugin's server can be tested and its tools set, but not edited. **Add server** opens the same form for a new server.

The form asks for a **Name** (letters, digits, `_` and `-`; it prefixes the server's tool names), a type, and either a command with one argument per line and an optional working directory, or a URL. A local command starts with a minimal environment (its path, home directory, locale, and proxy settings), so any other variable it needs must be listed. **Environment variables** (local command) or **Headers** (HTTP) list name and value pairs; each value is plain **Text**, a **Credential**, or for a header a **Bearer** credential sent as `Bearer <value>`. A credential names an entry in the credentials store, proposed from the server and value names; typing a secret beside it stores the secret there on save, and a tag says whether the store holds a value. The settings keep only `${credential:NAME}`. The form also takes a tool-call timeout, **On for new sessions** (when off, the server stays available and a session uses it only after it is selected there), and **Tool calls**: **Ask first** (the default), **Allow**, or **Block** for every tool the server offers. A row tags a server whose calls are allowed or blocked.

Saving a new or changed local command first shows the exact command the harness will run and asks the person to trust it. A server can be edited, but its name and type cannot change.

The **Test** dialog shows the server's reported name and version, how long connecting and listing took, and its tool names, or the stage that failed with the server's message; it also says when the test connection did not close cleanly.

The **Tools** dialog lists every tool under the name the model sees, with its first description line and a filter box. Select a tool to read its full description and a table of its parameters with their types and whether each is required. Each tool shows the mode it runs under, and its expanded help has a **When the model calls this tool** select that gives it its own mode or returns it to the server default; these changes take effect at the next call without reconnecting the server. In the approval prompt of an MCP tool call, **Always allow** sets that tool to Allow the same way and then allows the call.

### Status item

In a conversation, an **MCP 2/3** item sits below the prompt box beside the other readings: connected servers out of enabled ones, with a dot that turns amber while a server is connecting and red when one has failed. Selecting it opens a panel. The top shows calls, errors, and estimated tokens in and out for **This session** and for **All sessions**, then the estimated tokens the tool definitions of the servers this session uses add to every request. Each server then has its state and last error, a switch that decides whether this session uses it, the same four figures as this session / all sessions, and a **Details** row with the server's reported name and version, protocol revision, type, time connected, connection count, tool count, average and slowest call, last call, and its five most used tools. The figures refresh every two seconds while the panel is open. **Manage servers** opens the Plugins page.

**Show MCP status below the prompt box** on the MCP servers page turns the item on or off. The choice is saved with the profile's settings and is on by default. The item never shows when no server is configured.

### Servers per session

Adding a server makes it available; each session decides which servers it uses. In the composer tool row, between the permission and model selectors, an **MCP 2/3** selector shows how many of the running servers this session uses. It opens a list of the servers with a check on each one in use; choosing a server switches it for this session and keeps the list open, and clearing every check uses none. The switches in the status panel do the same. The selector appears on the new-session screen and in a conversation, and a change applies from the session's next request.

A session that has not chosen uses every server whose **On for new sessions** is on. A session's choice is saved with the session, so it survives a restart, and a sub-agent starts with its parent's choice. A server that is not connected can still be selected and says so beside its name.

Every change applies without a restart: the manager starts, rebuilds, or stops only the server that changed, and tool modes apply at the next call.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half registers the status-item preference and keeps its own fiber off the generated settings pages. The browser half keeps the page in `McpServersController`. It reads three Settings namespaces with `settings.describe`: `mcp-manager` for the server entries (resolved value, profile base, and user layer), `mcp-policy` for tool modes, and `mcp-selection` for each server's default. `joinRows` joins them with the manager's live list from `McpFleet`, which holds one `mcpManager.watch` stream for the page, the item, and the selector and reopens it on `connection/reset`. The form stages an `EditorDraft`; `entryFromDraft` writes it over the stored entry, so fields the form does not edit, such as `reconnect`, survive. A save stores typed secrets with `credentials.set`, then writes `servers.<name>` with `settings.mutate` at the revision it read, then the policy default and the session default when they changed. Enable and disable set `servers.<name>.enabled`; remove and restore unset `servers.<name>`, which for an inherited server leaves the profile's entry. A refused write shows the Host's explanation in the form or in a toast. Restart and test call `mcpManager.restart` and `mcpManager.probe`; closing a running test aborts it. The controller re-reads on `settings/document-updated` for those three namespaces, on `plugin-manager/changed`, and on `connection/reset`, but only once the page has opened.

The page registers `McpServersCard` into the Plugins page's `plugins.item` slot, and `McpServersToast` into `shell.overlay` so outcome toasts outlive the Plugins panel. The status item is `McpStatusItem` in the composer's `conversation.composer.dock` slot and the selector is `McpServerSelect` in `conversation.input.right`, both backed by one `McpTrayController`: it joins the manager's list with `mcpServers.overview` for the Session on screen, read when either mounts and when the Host reports a change, and polled only while the panel is open, because usage counters fire no event. A client the manager does not run, such as a profile row, still shows with its usage. Both read the Session's `mcpServers` projection and resolve the servers in use with `useSessionServers`: the logged selection, or each server's default while there is none. A toggle shows at once, sends the complete selection through `mcpServers.setSessionServers`, and gives way to the Session log's next selection or to a refusal. Without the projection, which means the Host mounts no selection service, the selector and the switches are absent. The preference is the `statusItem` field of this package's Host half, a live settings field read and written through `ctx.configForms` under the namespace `ui-settings-mcp-servers`.

The package injects `remote.mcpManager`, `remote.mcpServers`, `remote.settings`, and `remote.credentials`, so the page, the item, and the selector are absent from deployments without them.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [mcp-manager](../../mcp/mcp-manager/README.md) — the server fleet the page manages, its entry fields, status, restart, and probe.
- [api-mcp-controller](../../api/mcp-controller/README.md) — the Remote for tool lists, usage, per-session selection, and **Always allow**.
- [settings](../../settings/settings/README.md) — the namespaces, layers, and revision checks the page writes through.
- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Inherited values cannot be removed** — Settings merges a user override into the profile's entry key by key, so an environment variable or header the profile sets stays even when the form drops it; **Restore default** returns the whole server to the profile's entry.
- **Profile rows outside the manager are not listed** — an `mcp-client` row in a profile still runs and shows in the status item, but the page neither lists nor edits it.
- **Names cannot change** — renaming a server means removing it and adding it under the new name.
- **Errors are the server's own text** — a connection or probe error shows as the SDK or transport reported it, unlocalized.
- **Browser-side validation is minimal** — the page checks the name, the timeout, and credential names; the manager validates the whole entry at the write and the form shows what it refuses.
- **The status item needs a conversation** — the composer dock is not rendered on a blank session's start screen, so the item appears once a conversation has a message.
- **Usage figures are per process and estimated** — counters reset when the harness restarts; token figures are text length at four characters per token.
- **Runtime invariant:** No companion is published. The page holds no owned relationship of its own: what it shows derives from Settings, the manager's list, and `mcpServers.overview`, and what it writes the Host validates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
