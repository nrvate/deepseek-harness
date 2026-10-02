---
description: "按会话选择哪些已配置的 MCP 服务器到达模型，选择记录在会话日志中，并通过工具注册表强制执行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-selection

[English](README.md) | 中文

## 概述

`dsh-mcp-selection` 让每个会话只使用已配置 MCP 服务器中的一部分。已配置的服务器对所有会话可用；会话只携带它所使用的服务器的工具和指令。随附 profile 将它挂载一次，名为 `mcp-selection`。会话自行选择之前，使用所有在 [`mcp-client`](../mcp-client/README.zh.md) 条目中保持 `defaultActive` 开启的服务器。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

随附 profile 已挂载该服务；自定义 profile 需在 `@deepseek-ai/dsh-mcp-status` 旁添加 `@deepseek-ai/dsh-mcp-selection`。未挂载它的 profile 会让每个会话使用所有已配置的服务器。通过 `ctx.mcpSelection` 读取：

| 成员 | 返回 |
|---|---|
| `active(session)` | 会话当前使用的服务器名称，按配置顺序排列 |
| `logged(session)` | 会话记录的选择；会话仍遵循默认值时为 undefined |
| `isActive(server, agent)` | 该服务器是否到达该 agent 的模型请求；没有 agent 的调用方为 true |
| `select(agent, servers)` | 替换会话的选择之后正在使用的服务器 |
| `hideWhenNone(names)` | 一条规则的清理函数，该规则对不使用任何服务器的会话隐藏指定工具 |

`select` 接收完整列表，去除重复项，遇到未知名称时抛出 `MCP server "<name>" is not configured`，列表与当前使用的服务器相同时不写日志。空列表表示不使用任何服务器。选择从会话的下一次模型请求开始生效。

一次选择是一条 `mcp/servers` 会话事件，包含完整的 `active` 列表。`mcpServers` 投影把最近记录的列表传给客户端；会话尚未记录时为 `active: null`。已记录但其服务器不再配置的名称会被忽略，服务器恢复后重新计入。会话选择之后才添加的服务器在该会话中保持关闭，直到在该会话中选择它。

委派的子会话以父会话已记录选择的副本开始，由 [subagent](../../subagent/subagent/README.zh.md) 包在委派时写入。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | `McpSelection` 服务、`mcp/servers` 事件和 `mcpServers` 投影 |
| [`src/types.ts`](src/types.ts) | 投影值及其键声明 |
| [`src/client.ts`](src/client.ts) | 供客户端程序使用的同一组类型 |

强制执行依靠工具注册表的限制，施加在服务为每个 agent 创建的作用域上。该限制按 [`mcp-status`](../mcp-status/README.zh.md) 报告的公开名称，拒绝会话未使用的每个服务器的工具。工具 schema、查找、执行和 PTC 绑定都经过同一个注册表解析器，因此被拒绝的工具不出现在请求中，直接调用它会返回 `UNKNOWN_TOOL`。

限制逐个列出工具名称，因此服务在 `agent/created`、`tools/change`、`mcp-status/changed` 和 `select` 时重新计算。只有被拒绝的集合发生变化时才替换 agent 的限制。agent 的作用域和限制随 agent 一起销毁。

[`mcp-client`](../mcp-client/README.zh.md) 在提供服务器指令之前询问 `isActive`，[`mcp-resources`](../mcp-resources/README.zh.md) 在列出服务器名称或处理资源请求之前询问它。`mcp-resources` 还用 `hideWhenNone` 登记它的三个共享工具。

不发布运行时不变量伴随模块：选择是会话日志的一次折叠，限制在每次变化时由它推导。

</details>

<a id="model-experience"></a>
## 模型体验

### 会话未使用的服务器

#### 模型看到什么

未使用的服务器不留下任何内容：它的工具不出现在工具 schema 和 PTC 绑定中，它的指令不出现在系统提示中，它的名称不出现在 `MCP resource servers` 小节中。调用它的工具会返回注册表的 `UNKNOWN_TOOL` 错误，指名它的资源请求会返回 `MCP resource server "<name>" is not active in this session`。不使用任何服务器的会话也看不到三个共享资源工具。本包自身不增加任何文本。

#### Token 影响

每个未使用的服务器都会从该会话的每次请求中去掉它的工具定义和指令。使用全部服务器的会话的开销与没有本包时相同。

#### KV Cache 影响

更改会话的选择会改变下一次请求的工具 schema 和系统提示，因此该请求开始新的缓存前缀。两次选择之间的请求共享稳定的前缀。从不选择的会话只有在已配置的服务器或其默认值变化时才会看到前缀变化。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **按配置名称选择服务器** — 重命名服务器会使它从所有指名它的已记录选择中消失。
- **选择以会话为单位，而非以轮次为单位** — 对话中途的更改会让更早的工具调用留在历史中，而其定义已不存在。
- **子会话只复制一次选择** — 父会话之后的更改不会到达正在运行的子会话。
- **不区分 agent 作用域内的服务器** — 在某个 agent 作用域内注册的服务器与全局服务器按相同名称选择。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
