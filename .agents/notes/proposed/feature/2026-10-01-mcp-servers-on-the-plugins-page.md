# Agent Note: MCP servers on the Plugins page

Status: proposed

English | [中文](2026-10-01-mcp-servers-on-the-plugins-page.zh.md)

## Problem

A user adds an MCP server by writing a `@deepseek-ai/dsh-mcp-client` entry into the profile `cordis.patch.yml`, a home patch, or a `--patch` overlay file. The [MCP client](../../implemented/feature/2026-07-07-mcp-client-plugin.md) schema has no `.volatile()` fields, so the generic [plugin configuration forms](../../implemented/architecture/2026-09-16-plugin-configuration-on-the-plugins-page.md) cannot edit it. `ConfigEditor` edits only the `config` of an existing entry; no write path inserts or removes an entry. The client logs connection state and exposes none, so a saved server that fails to connect still shows as an active plugin with no tools.

## Proposal

Add an MCP section to the sidebar Plugins page that lists, adds, edits, and removes MCP servers in the active profile patch. [Settings keeps only the read-only inventory](../../implemented/architecture/2026-09-09-plugin-management-in-the-web-sidebar.md), so this proposal adds no Settings tab.

### Host: `mcpServers` Remote

A new Host service extends `TypertRemoteService` with namespace `mcpServers`:

- `list` returns every active `@deepseek-ai/dsh-mcp-client` entry: id, `serverName`, transport, command or URL, enabled state, and a read-only reason when the row comes from a home patch, overlay, or bundle (the `unaddressable` rule `listPlugins` already applies).
- `upsert` validates the config with the `mcp-client` schema, then inserts or replaces one row.
- `remove` deletes one row the profile patch owns.
- `setEnabled` toggles `disabled` through the existing `writePluginEnabled`.

Row ids use the prefix `mcp-<serverName>`. Writes use the `yaml` AST that `ConfigEditor` and `plugin-manager` already use, so comments and `!!js` expressions survive. They run under `withFileLock` and `hmr.runExclusive`, roll back the file when reconciliation fails, and report whether the change applied or needs a restart (profiles without HMR). The insert and delete primitives are new; `ConfigEditor.edit` handles edits to an existing entry.

### Client: companion package

A new client-only package `ui-plugin-mcp-servers` registers into `plugins.item`, modelled on `ui-settings-web-search`, with a server list and an add/edit dialog per transport. All copy lives in `locales.ts`. The package is mounted in `packages/bundle/web-app/cordis.patch.yml` beside `ui-plugin-manager`.

### Secrets

The form accepts environment-variable references only. For `env` and `headers` values it writes `!!js process.env.NAME` (or the `Bearer` template form) and never stores or returns a literal secret. Credential-reference support in `mcp-client` is out of scope.

### Trust gate

A stdio entry runs an arbitrary command with Host privileges. The Remote requires an explicit confirmation of the command line before `upsert` writes a stdio row, and the dialog shows the exact command.

### Out of scope for the first change

Live connection status needs a new observable service in `mcp-client`, a Remote method, and an entry in `remote-events.ts`. It ships as a separate change; until then the list shows plugin phase only and the dialog says that a successful save does not prove the server connected.

## Alternatives considered

**A Settings tab.** The `settings.plugins.tab` slot permits it. Rejected: configuration moved to the Plugins page deliberately, and a second home for plugin configuration splits discovery.

**Generic add/remove Remotes on `plugin-manager`.** Rejected for now: it grows an already large service with generic power over any entry, and mutating profile code loading from a GUI Remote has no `danger-full-access`-style gate today.

**One `mcpServers: McpServerSpec[]` config on a single hub plugin.** Rejected: it breaks every existing per-entry config, needs an upgrade guide, and gives up per-server HMR isolation.

**Making `mcp-client` fields `.volatile()`.** Rejected: `apply` reads the config once, so volatile fields would stop reconnecting on edit, and the config is a union keyed on `transport`.

## Acceptance criteria

- Adding a server in the page writes one `mcp-<serverName>` row to the profile patch, preserves existing comments and `!!js` values, and the server's tools appear without a restart when HMR is on; without HMR the dialog reports restart-required.
- A duplicate `serverName`, an invalid URL, and an out-of-range timeout are rejected before any file write, and the file is unchanged.
- A failed reconciliation restores the previous file.
- Rows from overlays, home patches, and bundles are listed read-only with a reason.
- No response, event, or log line contains a literal secret value.
- A malformed patch file is never overwritten.
- Client coverage is 100% per file; a web e2e test drives add, edit, disable, and remove through the real Remote; `verify-client-ui-i18n` passes.

## Risks

- **Plaintext values.** A user can still type a literal token into `args` or `command`; the file is mode 0600 but unencrypted.
- **No connection status in the first change.** Users cannot see from the page whether a server connected.
- **Web-app bundle only.** The Plugins page is mounted only in the web-app bundle, so launchers that do not use it get no MCP page.
- **Process cost.** A new Remote regenerates the API assemblies, and the change needs en/zh docs, a GIF in the PR, and possibly an upgrade guide if the row-id prefix rule affects existing entries.
