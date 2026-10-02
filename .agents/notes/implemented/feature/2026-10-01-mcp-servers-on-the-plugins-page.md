# Agent Note: MCP servers on the Plugins page

Status: implemented

English | [中文](2026-10-01-mcp-servers-on-the-plugins-page.zh.md)

## Problem

A user adds an MCP server by writing a `@deepseek-ai/dsh-mcp-client` entry into the profile `cordis.patch.yml`, a home patch, or a `--patch` overlay file. The [MCP client](2026-07-07-mcp-client-plugin.md) schema has no `.volatile()` fields, so the generic [plugin configuration forms](../architecture/2026-09-16-plugin-configuration-on-the-plugins-page.md) cannot edit it. `ConfigEditor` edits only the `config` of an existing entry; no write path inserts or removes an entry. The client logged its connection state and exposed none, so a saved server that failed to connect still showed as an active plugin with no tools.

## Decision

**The Plugins page lists, adds, edits, enables, disables, and removes MCP servers in the active profile patch.** [Settings keeps only the read-only inventory](../architecture/2026-09-09-plugin-management-in-the-web-sidebar.md), so the page is a `plugins.item` entry in the Official group, not a Settings tab.

**A Host `mcpServers` Remote owns every write.** `@deepseek-ai/dsh-api-mcp-controller` extends `TypertRemoteService` with `list`, `upsert`, `setEnabled`, and `removeServer`:

- `list` composes every MCP row of the running profile from the layered patches and marks each as owned by the profile patch or read-only (`unaddressable`, `custom-expression`, `embedded-credentials`).
- A write inserts, replaces, or deletes one row by editing the YAML AST of `cordis.patch.yml`, so comments, unmanaged keys such as `reconnect`, and the `!!js` tag survive. It runs under the profile file lock and `hmr.runExclusive`, reports `applied` or `restart-required`, and restores the file when the reload fails. A new row is `mcp-<serverName>`.
- The configuration is validated with the `mcp-client` Config schema and the plugin's load-time checks, so the plugin rejects at load what the controller refuses at save.
- Every write emits `plugin-manager/changed`, which the Plugins page already refreshes on.

**Secrets are environment variable references and never leave the Host.** A value is a literal, an environment reference written as `!!js process.env.NAME` (or the `Bearer` template), an `expression` the file already holds, or `kept`. An environment reference must name a variable that is set when the change is saved, because an undefined `env` value makes the plugin refuse its config and a `Bearer` header would send `undefined`. A literal under a credential-shaped name and a URL with a user name or password are refused with `literal-secret`. A stored literal comes back as `kept` and is preserved when `kept` is sent. An `expression` is accepted only when it equals the source already stored under that key, so the Remote cannot be used to submit code. The list summary omits the URL's credentials and query.

**A stdio server is saved only after the person trusts the exact command.** A first `upsert` returns `confirmation-required` with the Host's command line; the client shows that text and repeats the call with it as `confirmedCommand`. The Host compares the two, so the text the person read is the text it checks.

**Connection state comes from a shared status service.** `@deepseek-ai/dsh-mcp-status` is a Cordis service, mounted once by the base bundle like `mcp-resources`, that each `mcp-client` registers a live handle into: its state (connecting, connected, reconnecting with the attempt count, failed), last error, tool list, and a reconnect-now action. The handle reads the supervisor's own variables, so the service holds no copy that could disagree with the connection. A change fires `mcp-status/changed`, and the controller turns bursts of them into one debounced `plugin-manager/changed`, which the Plugins page already refreshes on. `list` attaches each row's status, `tools` returns the server's tools, and `reconnectServer` asks the client to connect now.

**The Tools dialog is read-only help.** It lists each tool under the name the model sees, with a filter and a native expandable row showing the description and a parameter table derived from the tool's input schema.

**Usage counters ride the same handle, and a status item shows them.** Each client counts its tool calls, failures, call time, and estimated tokens in and out (text length at four characters per token, the density the context meter uses), plus the estimated tokens its tool definitions add to every request. `overview` returns every server's state and counters in one call. A `conversation.composer.dock` entry shows connected servers out of enabled ones and opens a panel of those figures. Counters fire no event, since they change on every call, so the panel polls only while it is open. The item is on by default and a switch on the MCP servers page turns it off; the preference is a live settings field on the companion package's Host half, the mechanism the theme and chat preferences use.

**The browser half is a companion package.** `@deepseek-ai/dsh-client-ui-settings-mcp-servers` follows the other `ui-settings-*` companions: an empty Host `apply`, a `plugins.item` entry, and a dictionary. It injects `remote.mcpServers`, so it is absent where the controller is. Outcome toasts register into `shell.overlay` so they outlive the Plugins panel.

## Alternatives considered

**A Settings tab.** The `settings.plugins.tab` slot permits it. Rejected: configuration moved to the Plugins page deliberately, and a second home for plugin configuration splits discovery.

**Generic add and remove Remotes on `plugin-manager`.** Rejected: it grows an already large service with generic power over any entry, and mutating profile code loading from a GUI Remote has no `danger-full-access` gate today.

**One `mcpServers: McpServerSpec[]` config on a single hub plugin.** Rejected: it breaks every existing per-entry config, needs an upgrade guide, and gives up per-server HMR isolation.

**Making `mcp-client` fields `.volatile()`.** Rejected: `apply` reads the config once, so volatile fields would stop reconnecting on edit, and the config is a union keyed on `transport`.

**Credential references resolved by `mcp-client`.** Deferred: it is a package change beyond this surface, and environment references need none.

## Consequences

Users manage servers without editing files, and every write is validated by the same schema the plugin loads with. Where the status service is not mounted a row reads **Loaded** when the plugin started and shows no connection state. Connection errors are shown as the SDK or transport reported them, unlocalized.

A user can still type a literal token into `args` or `command`; the file is mode 0600 but unencrypted. A URL that carries a token in its query is stored as typed and shown in the editable spec, while the list summary omits the query.

Usage counters are per Host process: they reset on restart, and token figures are estimates. [Per-Session selection](2026-10-02-per-session-mcp-server-selection.md) attributes each call to its Session. The status item appears only once a conversation has a message, because the composer dock is not rendered on a blank session's start screen.

The Plugins page is mounted only in the web-app bundle, so launchers that do not use it get no MCP page. Rows from bundles, the home patch, and overlays are listed but cannot be changed here.

## Testing

`packages/api/mcp-controller/tests` boot a real profile Include, Loader, and hot reload with a stub client plugin and assert the patch file after each operation, including rollback and refusal. `packages/client/ui-settings-mcp-servers/tests` drive the page through the real controller over a scripted Remote. `apps/web/tests/mcp-servers.e2e.ts` runs the page in a browser against a real Host and reads the patch file back.
