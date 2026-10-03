# MCP

[English](mcp.md) | 中文

## 摘要

模型上下文协议（Model Context Protocol，MCP）让模型使用外部服务器提供的工具。每个已配置服务器都会提供普通 Harness 工具，支持取消、权限检查、结果记录和受支持的图像输出。调用方作用域中配置了服务器时，共享工具负责发现和读取资源，服务器指令则加入已记录的系统提示词。官方 SDK 协商现代或受支持的旧版协议。本参考页介绍 MCP 包组的职责、作用域和组合选择；服务器配置由[客户端 README](../../packages/mcp/mcp-client/README.zh.md) 维护。

## 目录

- [配置](#configuration)
- [职责与作用域](#responsibilities-and-scope)
- [协议与结果](#protocol-and-results)
- [资源与指令](#resources-and-instructions)
- [资源提供方类型](#resource-provider-types)
- [限制](#limits)
- [延伸阅读](#further-reading)

-----

<a id="configuration"></a>
## 配置

MCP 服务器需要主动配置。在目标 Cordis 作用域中，为每台服务器配置一个 `@deepseek-ai/dsh-mcp-client` 条目。每个随附 profile 都提供[工具注册表](tools.zh.md)，并统一挂载共享资源服务一次；用户只需配置客户端条目。调用方没有可见的已配置服务器时，在 native 或 PTC 模式下都不会获得 MCP 提示词文本或工具。

| 选择 | 配置维护位置 |
|---|---|
| 服务器身份、本地进程或 HTTP 端点、凭据和进程环境 | [客户端配置](../../packages/mcp/mcp-client/README.zh.md#use-this-package) |
| 工具与资源请求超时、启动失败策略和重连 | [客户端配置](../../packages/mcp/mcp-client/README.zh.md#use-this-package) |
| 资源发现与读取 | 随附 profile 已包含 [MCP 资源服务](../../packages/mcp/mcp-resources/README.zh.md#use-this-package)；该服务没有配置字段 |
| 服务器指令大小限制 | 客户端 `maxInstructionBytes`；组合提供[系统提示词装配](system-prompt.zh.md) |
| 权限决策和受支持的图像输出 | [工具执行](tools.zh.md)和[附件](attachment.zh.md) |

协议协商遵循 SDK 支持的修订版；产品没有强制指定协议修订版的设置。[配置目录](../config-catalog.zh.md#deepseek-aidsh-mcp-client) 列出客户端接受的字段和默认值。

-----

<a id="responsibilities-and-scope"></a>
## 职责与作用域

客户端是每服务器一个的连接插件，也是 Harness 工具注册表的消费者。它不发布共享的 `ctx.mcp` 服务。外部服务器实现 MCP 操作；SDK 拥有协议交换；客户端将发现的工具适配到 Harness 执行过程。

`mcp-resources` 拥有共享资源工具，并在调用方作用域中选择提供方。每个 MCP 客户端通过自己的连接提供资源操作。作用域中的首个提供方启用本地共享工具，移除最后一个提供方时移除这些工具；继承的提供方仍然可见。服务独立于任何单一客户端拥有这些工具注册。只要可见的客户端条目保持激活，连接失败就不会移除共享资源工具。

配置的 `serverName` 在注册作用域内标识服务器。同一作用域中的两个条目不能占用相同名称；不同 Agent 作用域可以复用该名称。公开工具名包含配置的服务器名称，因此不同服务器的同名工具仍可区分。注册副作用拥有名称和已发现工具；插件释放时关闭连接并移除其贡献。

[原生 Cua Driver 提供方](../../packages/experimental/computer-use-cua-driver-native/README.zh.md) 复用客户端导出的结果适配器，无需打开 MCP 连接。桌面提供方选择属于[计算机使用子系统](computer-use.zh.md)。

-----

<a id="protocol-and-results"></a>
## 协议与结果

stdio 和 Streamable HTTP 都使用官方 SDK 的协商、发现、协议校验和取消机制。工具列表变化通过旧版通知或现代订阅触发发现。刷新失败时保留上一代工具；连接恢复遵循[客户端生命周期](../../packages/mcp/mcp-client/README.zh.md#use-this-package)。

结果适配器为程序化调用方保留规范 MCP JSON，并准备普通工具内容。受支持的图像使用附件系统；不受支持的富内容产生明确的文本诊断。工具注册表仍决定策略失败和结果替换。[工具契约](tools.zh.md) 维护记录和最终呈现规则；[客户端结果参考](../../packages/mcp/mcp-client/README.zh.md#use-this-package) 维护 MCP 特有的投影细节。

-----

<a id="resources-and-instructions"></a>
## 资源与指令

资源调用必须显式指定配置的服务器名称。系统提示词组装服务可用时，资源服务从派发所用的同一注册表列出调用方可见的名称，包括没有工具或指令的服务器。共享注册表在分发前，于调用 Agent 的作用域中解析该名称；不可用的服务器会在发出网络请求前失败。发现和读取均按需执行，也支持只提供资源而不提供工具的服务器。[资源包](../../packages/mcp/mcp-resources/README.zh.md) 维护分页和内容渲染规则；其生成的工具 schema 位于[工具目录](../tool-catalog.zh.md#deepseek-aidsh-mcp-resources)。

资源提供方仍由连接拥有。作用域释放时移除注册；MCP 客户端控制取消和恢复。规范结果为程序化调用方保留完整 JSON，文本投影则以描述替换二进制 blob。返回的文本进入普通工具历史；服务器连接本身不会触发内容读取。

组合包含系统提示词装配时，客户端将非空白的服务器指令发布为带服务器归属的作用域章节。指令保持字面文本，并在发布前通过配置的大小限制。替换连接仅在发现成功后发布指令；缺少指令时不添加章节。[系统提示词子系统](system-prompt.zh.md) 维护装配与记录规则。

-----

<a id="resource-provider-types"></a>
## 资源提供方类型

连接提供方接收一个操作与原始工具执行对象，其中包含调用方和取消信号。

```ts type-equiv
/** One supported resource operation, with server-owned cursors and URIs. */
type McpResourceRequest =
  | { method: 'resources/list' | 'resources/templates/list'; cursor?: string }
  | { method: 'resources/read'; uri: string }
```

```ts type-equiv
/** One configured server's resource access, owned by its MCP connection plugin. */
interface McpResourceProvider {
  /**
   * Run an operation against one live connection generation.
   * @param request - MCP resource method and parameters.
   * @param exec - caller identity and cancellation for this invocation.
   * @returns the protocol result as lossless JSON.
   */
  request(request: McpResourceRequest, exec: ToolExecution): Promise<JsonValue>
}
```

-----

<a id="limits"></a>
## 限制

不支持 MCP 提示词模板、人工输入征询、基于任务的执行和资源订阅。资源工具需要调用方可见的已配置服务器；二进制资源保留为程序化数据，模型接收其文本描述。没有工具能力的服务器以空工具集连接。连接和发现超时遵循 SDK；客户端没有对应的独立设置。

-----

<a id="further-reading"></a>
## 延伸阅读

- [MCP 包组](../../packages/mcp/README.zh.md) — 包入口。
- [MCP 资源](../../packages/mcp/mcp-resources/README.zh.md) — 共享工具与资源提供方语义。
- [资源可见性参考](../../packages/mcp/mcp-resources/README.zh.md) — profile 统一挂载及由已配置服务器决定的可见性。
- [第三方记忆服务器](../user/guide/mcp-memory.zh.md) — 产品配置指南。
- [协议协商参考](../../packages/mcp/mcp-client/README.zh.md) — SDK 职责与兼容性决策。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmcppolicy--mcppolicystore"></a>

### `ctx.mcpPolicy` — `McpPolicyStore`

Holds the person's policies and answers them per server.

```ts cordis-catalog
/**
 * Read one server's stored policy.
 * @param server - configured server name.
 * @returns the policy the person set, or undefined while the store holds none for the server.
 */
policyOf(server: string): McpToolPolicy | undefined
```

Source: [`packages/mcp/mcp-policy/src/index.ts`](../../packages/mcp/mcp-policy/src/index.ts)

<a id="ctxmcpresources--mcpresourceruntime"></a>

### `ctx.mcpResources` — `McpResourceRuntime`

Scoped resource access plus three tools shared by configured MCP servers.

```ts cordis-catalog
/**
 * Register one server and expose resource tools while that scope has providers.
 * @param server - configured server name, unique in this scope.
 * @param provider - connection-owned resource operations.
 * @returns the effect disposer for this exact registration.
 */
register(server: string, provider: McpResourceProvider): () => void
```

Source: [`packages/mcp/mcp-resources/src/index.ts`](../../packages/mcp/mcp-resources/src/index.ts)

<a id="ctxmcpselection--mcpselection"></a>

### `ctx.mcpSelection` — `McpSelection`

Decides and enforces which configured MCP servers each Session uses.

```ts cordis-catalog
/**
 * Read the selection a Session logged for itself.
 * @param session - the Session to read.
 * @returns the logged server names, or undefined while the Session follows the configured defaults.
 */
logged(session: Session): readonly string[] | undefined

/**
 * Resolve the servers a Session uses now: its logged selection restricted to
 * the servers still configured, or the servers configured as active by default.
 * @param session - the Session to resolve for.
 * @returns the active server names, in the order the servers are configured.
 */
active(session: Session): string[]

/**
 * Whether one server reaches an agent's model requests.
 * @param server - configured server name.
 * @param agent - the agent whose Session decides; a caller with no agent is not restricted.
 * @returns false only when the agent's Session does not use the server.
 */
isActive(server: string, agent: Agent | undefined): boolean

/**
 * Replace a Session's selection, log it, and apply it to the agent's tools at once.
 * A request that names the servers already in use logs nothing.
 * @param agent - the agent whose Session selects.
 * @param servers - every server the Session uses from now on; duplicates are dropped.
 * @returns the servers in use afterwards, in configured order.
 * @throws when a name is not a configured server.
 */
select(agent: Agent, servers: readonly string[]): string[]

/**
 * Hide tools that serve MCP servers in general from every Session that uses no server.
 * @param names - registered tool names, such as the shared resource tools.
 * @returns the disposer that stops hiding them.
 */
hideWhenNone(names: readonly string[]): () => void
```

Types: [Agent](core.zh.md) · [Session](session.zh.md)

Source: [`packages/mcp/mcp-selection/src/index.ts`](../../packages/mcp/mcp-selection/src/index.ts)

<a id="ctxmcpserverscontroller--mcpserverscontroller"></a>

### `ctx.mcpServersController` — `McpServersController`

Remote owner of the profile's MCP server rows.

```ts cordis-catalog
/**
 * List every MCP server row of the running profile, including rows from bundles, the
 * home patch, and command-line overlays that cannot be changed here.
 * @returns rows in composition order; stored literal secrets are replaced by `kept`.
 */
@Remote async list(): Promise<McpServerInfo[]>

/**
 * Add an MCP server row, or replace the row `options.id` names. A stdio server runs a
 * command with the Host's privileges, so adding or changing one requires the caller to
 * echo the command line it showed the person.
 * @param spec - configuration to write; secrets are environment variable references.
 * @param options - row to replace and the confirmed command line.
 * @returns the persisted change and whether the running profile applied it.
 */
@Remote async upsert(spec: McpServerSpec, options?: McpUpsertOptions): Promise<McpChangeResult>

/**
 * Remove one server row from the profile patch.
 * The name is not `remove`: a Remote method may not share a name with a member of its namespace service.
 * @param id - row id returned by `list`.
 * @returns the persisted change and whether the running profile applied it.
 */
@Remote async removeServer(id: McpEntryId): Promise<McpChangeResult>

/**
 * Enable or disable one server row the profile patch owns.
 * @param id - row id returned by `list`.
 * @param enabled - whether the row loads.
 * @returns the persisted change and whether the running profile applied it.
 */
@Remote setEnabled(id: McpEntryId, enabled: boolean): Promise<McpChangeResult>

/**
 * Replace one server's tool-call policy. With the policy store mounted the change applies at the
 * next call without reconnecting the server, and works for every listed row; without it, only an
 * editable row the profile patch owns can change, and its server reloads. It runs no command, so it
 * needs no confirmation.
 * @param id - row id returned by `list`.
 * @param policy - the server's default mode and its per-tool modes.
 * @returns the persisted change and whether the running profile applied it.
 */
@Remote async setToolPolicy(id: McpEntryId, policy: McpToolPolicy): Promise<McpChangeResult>

/**
 * Let one MCP tool run without asking from now on, by its model-facing name. The change goes to the
 * policy store, so the server keeps its connection.
 * @param publicName - the tool's model-facing name, as an approval request names it.
 * @returns the persisted change; `unknown-server` when no connected server offers the tool.
 */
@Remote async allowTool(publicName: string): Promise<McpChangeResult>

/**
 * Read the tools one server offers, with its connection state.
 * @param id - row id returned by `list`.
 * @returns the tools registered from the server right now; empty when it is not connected or has no client.
 */
@Remote async tools(id: McpEntryId): Promise<McpToolsResult>

/**
 * Read every configured server's connection state and usage counters in one call.
 * @param sessionId - Session whose own share of the counters to include; omitted reads the totals only.
 * @returns one entry per row in composition order, with the Host clock the figures were read at.
 */
@Remote async overview(sessionId?: string): Promise<McpOverview>

/**
 * Replace the servers one Session uses. The choice is logged on the Session and
 * takes effect on its next model request.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param active - every server name the Session uses from now on; an empty list uses none.
 * @returns the servers in use afterwards.
 * @throws when a name is not a configured server, or the profile mounts no selection service.
 */
@Remote setSessionServers(agent: Agent, active: string[]): McpSessionServers

/**
 * Ask one server's client to connect now instead of waiting out its retry delay, restarting its retry budget.
 * @param id - row id returned by `list`.
 * @returns whether a new attempt started.
 */
@Remote async reconnectServer(id: McpEntryId): Promise<McpReconnectResult>
```

Types: [Agent](core.zh.md)

Source: [`packages/api/mcp-controller/src/index.ts`](../../packages/api/mcp-controller/src/index.ts)

<a id="ctxmcpstatus--mcpstatusruntime"></a>

### `ctx.mcpStatus` — `McpStatusRuntime`

The shared registry the MCP clients register into.

```ts cordis-catalog
/**
 * Publish one server and relay its changes as `mcp-status/changed`.
 * @param server - configured server name.
 * @param handle - live reads and the reconnect action for the server.
 * @returns the disposer that removes this registration.
 */
register(server: string, handle: McpServerHandle): () => void

/**
 * Read every registered server's state.
 * @returns one status per registration, in registration order.
 */
list(): McpServerStatus[]

/**
 * Name every registered server with its configured default.
 * @returns one entry per registration, in registration order.
 */
servers(): McpConfiguredServer[]

/**
 * Read one server's state.
 * @param server - configured server name.
 * @returns its status, or undefined when no client registered it.
 */
get(server: string): McpServerStatus | undefined

/**
 * Read one server's tools.
 * @param server - configured server name.
 * @returns the tools registered from it, empty when no client registered it.
 */
tools(server: string): readonly McpToolInfo[]

/**
 * Read one server's usage counters and connection facts.
 * @param server - configured server name.
 * @param session - a Session id; when given, the counters cover only that Session's calls.
 * @returns its stats, or undefined when no client registered it.
 */
stats(server: string, session?: string): McpServerStats | undefined

/**
 * Ask one server's client to connect now.
 * @param server - configured server name.
 * @returns whether a new attempt started; false for an unknown server or one already live or connecting.
 */
async reconnect(server: string): Promise<boolean>
```

Source: [`packages/mcp/mcp-status/src/index.ts`](../../packages/mcp/mcp-status/src/index.ts)

<a id="mcp-status-events"></a>

### `mcp-status/*` events

<a id="mcp-statuschanged--emit"></a>

#### `mcp-status/changed` — emit

A registered server's connection state or tool list changed, or a server was registered or removed.

```ts cordis-catalog
/**
 * A registered server's connection state or tool list changed, or a server was registered or removed.
 * @mode emit
 * @param server - the configured `serverName`.
 */
'mcp-status/changed'(server: string): void
```

Source: [`packages/mcp/mcp-status/src/index.ts`](../../packages/mcp/mcp-status/src/index.ts)
<!-- END GENERATED cordis-surface -->
