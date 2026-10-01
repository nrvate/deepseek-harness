---
description: "已配置 MCP 服务器的实时连接状态和工具列表，由各自的客户端注册，供管理界面读取。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-status

[English](README.md) | 中文

## 概述

`dsh-mcp-status` 为每个已配置的 MCP 服务器保存一条实时记录：它正在连接、已连接、重连中还是已失败，最近一次错误，以及它提供的工具。随附 profile 只挂载一次。每个 [MCP 客户端](../mcp-client/README.zh.md)会自行注册，无需配置。它不增加任何模型可见文本。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

随附 profile 已将该服务挂载为 `mcp-status`；自定义 profile 需在 MCP 客户端条目之前添加 `@deepseek-ai/dsh-mcp-status`。通过 `ctx.mcpStatus` 读取：

| 成员 | 返回 |
|---|---|
| `list()` | 所有已注册服务器的状态 |
| `get(server)` | 单个服务器的 `McpServerStatus`，或 undefined |
| `tools(server)` | 当前已从该服务器注册的工具 |
| `stats(server)` | 该服务器的 `McpServerStats`：用量计数和连接信息，或 undefined |
| `reconnect(server)` | 是否开始了新的尝试 |

`McpServerStatus` 包含 `state`（`connecting`、`connected`、`reconnecting`、`failed`）、失败的 `attempt` 次数和配置的 `maxAttempts`、最近的 `error`、`connectedAt` 以及 `toolCount`。`failed` 表示没有待执行的尝试：重试预算已用尽、已禁用重连，或失败的连接无法关闭。`reconnect` 会立即连接、跳过等待中的重试延迟并重置重试预算；连接已建立或正在建立时它不做任何事。

`McpServerStats` 统计工具调用次数和失败次数，累计并记录最长调用耗时，并按每 Token 四个字符估算发送参数和返回结果文本的 Token 数。它还包含该服务器的工具定义为每次模型请求增加的估算 Token 数、已建立的连接次数、服务器自报的名称和版本、协商的协议版本、传输方式，以及按工具统计的调用次数。计数从客户端加载时开始，重连后保留，按需读取；它们不触发事件。

每次注册、移除、状态变化和工具列表变化之后，都会触发带有服务器名称的 `mcp-status/changed` 事件。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `McpStatusRuntime` 服务：以 effect 形式的注册、读取和事件转发 |
| [`src/types.ts`](src/types.ts) | `McpServerStatus`、`McpToolInfo`，以及客户端注册的 `McpServerHandle` |

客户端注册的 handle 是对其监督器的实时闭包读取，因此服务自身不保存任何状态，也不会与连接不一致。服务订阅每个 handle，并把变化转发为同一个事件。注册是一个 effect，因此会随客户端的 fiber 一起消失，包括热重载时。

不发布运行时 invariant 伴生包：服务只保存注册，每个回答都读取自所属客户端。

</details>

<a id="model-experience"></a>
## 模型体验

无，因为该服务只向管理界面报告连接状态，不注册任何工具、提示词或会话事件。

#### KV Cache effect

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **服务器仅以配置的名称为键** — 两个 Agent 作用域复用同一个 `serverName` 时都会注册，读取方返回第一个。
- **错误是 SDK 或传输层的原始消息** — 未经本地化，且可能很长。
- **计数以进程为单位** — Host 重启或客户端插件重载时清零，且不归属到某个 Session。
- **Token 数为估算值** — 按每 Token 四个字符的文本长度计算；图片和其他二进制块计为零。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
