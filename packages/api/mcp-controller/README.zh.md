---
description: "mcpServers Remote 报告 MCP 工具列表与用量，设置会话使用的服务器，并允许单个工具免询问运行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-mcp-controller

[English](README.md) | 中文

## 概述

`mcpServers` Remote 提供浏览器在 [MCP 管理器](../../mcp/mcp-manager/README.zh.md)与[设置](../settings-controller/README.zh.md) Remote 之外所需的 MCP 操作：每个服务器已注册的工具和用量计数、单个会话使用的服务器，以及一键允许单个工具。服务器条目、工具调用策略和默认选择都是设置字段；连接状态、重启和探测是 `mcpManager` 的操作。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

[Web 包](../../bundle/web-app/README.zh.md)将控制器挂载为 `mcp-servers-controller`，插件页面使用它。每个方法都以服务器名称为键，即管理器条目的 `servers` 键或静态 `mcp-client` 行的 `serverName`。

| 方法 | 作用 |
|---|---|
| `tools(serverName)` | 该服务器当前已注册的工具及其描述和参数，来自[状态服务](../../mcp/mcp-status/README.zh.md) |
| `overview(sessionId?)` | 每个运行中客户端的用量计数，以及经 [mcp-selection](../../mcp/mcp-selection/README.zh.md) 覆盖后的默认值，并附读取时的宿主时钟；传入会话 id 时，每项还以 `sessionStats` 附带该会话的份额 |
| `setSessionServers(sessionId, active)` | 通过 `mcp-selection` 替换单个会话使用的服务器；返回正在使用的服务器 |
| `allowTool(publicName)` | 按模型可见名称让单个工具此后免询问运行，并保留该服务器在 [mcp-policy](../../mcp/mcp-policy/README.zh.md) 中的其余策略 |

`allowTool` 返回 `{ ok: true, serverName, tool }`，或返回带 `code` 与 `message` 的 `{ ok: false }`：没有运行中的客户端提供该工具时为 `unknown-tool`，profile 未挂载策略存储时为 `no-policy-store`，配置编辑器拒绝写入时为 `write-failed`，例如家目录补丁或覆盖层拥有该存储的条目。写入经配置编辑器进入 profile 补丁，无需重连服务器即可生效。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Remote：读取 `mcpStatus`，把选择委托给 `mcpSelection`，并经 `configEditor` 写入策略存储 |
| [`src/types.ts`](src/types.ts) | 与客户端共享的记录 |

每次读取都在调用时由状态注册表提供，因此控制器不保存状态。`allowTool` 按模块名查找策略存储的 Loader 条目；对直接注册该类的组合则按插件查找。

不发布运行时 invariant 伴生包：控制器自身不保存状态。

</details>

<a id="model-experience"></a>
## 模型体验

无直接影响。会话的选择会改变其后续请求携带哪些 MCP 工具与指令，见 [mcp-selection](../../mcp/mcp-selection/README.zh.md#model-experience)；被允许的工具不再询问用户，但不改变请求内容。

#### KV Cache effect

选择变化会改变该会话后续请求的工具定义；控制器本身不增加 Token。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 用量与工具列表只覆盖运行中的客户端：已禁用或已失败的服务器在 `overview` 中没有条目，也没有工具。
- 服务器以名称为键；两个 Agent 作用域复用同一个 `serverName` 时共享一项，由第一个注册作答。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

[插件页面上的 MCP 服务器](../../../.agents/notes/implemented/feature/2026-10-01-mcp-servers-on-the-plugins-page.zh.md) Agent Note 记录了最初的设计；fork 采用上游管理器后，服务器条目改为 MCP 管理器的设置字段。

</details>
