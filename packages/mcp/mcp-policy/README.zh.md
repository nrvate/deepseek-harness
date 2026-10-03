---
description: "实时保存用户为 MCP 服务器设置的工具调用策略，每个 MCP 客户端在每次调用时读取，因此修改策略不会使服务器重新连接。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-policy

[English](README.md) | 中文

## 概述

`dsh-mcp-policy` 保存用户为每个 MCP 服务器设置的工具调用策略：每个工具是直接运行、先询问还是被拒绝。它的 `servers` 字段是 volatile 的，因此写入 profile 补丁的修改无需重新加载任何内容即可到达正在运行的存储。每个 [MCP 客户端](../mcp-client/README.zh.md)在每次调用时读取其服务器的条目，存储中没有条目时使用其自身配置中的 `toolPolicy`。随附 profile 将它挂载一次，名为 `mcp-policy`。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

MCP 服务器页面会写入该存储；手写的 profile 补丁也可以：

```yaml
- id: mcp-policy
  config:
    servers:
      docs:
        default: ask
        tools:
          search: allow
          delete_page: deny
```

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `servers` | `{}` | 按配置的服务器名称保存的策略：`default`（`ask`、`allow` 或 `deny`，默认 `ask`）以及 `tools`，即服务器自己的工具名称到各自模式的映射。修改从下一次调用开始生效，无需重新加载 |

通过 `ctx.mcpPolicy.policyOf(server)` 读取，它返回存储的策略或 undefined。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | `McpPolicyStore` 服务及其 volatile 配置 |
| [`src/types.ts`](src/types.ts) | `McpToolMode` 与 `McpToolPolicy` |

策略不能作为 `mcp-client` 条目自身的 volatile 字段：该插件的配置是按传输方式区分的 union，而 Loader 只把固定对象路径视为 volatile，因此那里的任何修改都会重新加载客户端并使其服务器重新连接。一个只含一个 volatile 字段的独立条目让策略修改保持实时生效。[MCP 控制器](../../api/mcp-controller/README.zh.md)通过配置编辑器写入它。

不发布运行时不变量伴随模块：存储只保存配置，按需读取。

</details>

<a id="model-experience"></a>
## 模型体验

无，因为该存储只保存配置；关卡以及模型读到的拒绝信息由 [MCP 客户端](../mcp-client/README.zh.md#tool-call-policy)负责。

#### KV Cache effect

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **策略按服务器名称保存** — 重命名服务器会让其存储的策略留在旧名称下；通过 MCP 控制器移除服务器会删除其条目。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
