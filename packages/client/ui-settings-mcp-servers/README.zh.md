---
description: "dsh Web 客户端插件页上的 MCP 服务器页：添加、编辑、启用、停用和移除为模型提供 MCP 工具的服务器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-mcp-servers

[English](README.md) | 中文

## 概述

在侧栏打开**插件**，在官方分组里选择 **MCP 服务器**，即可在不编辑文件的情况下添加、编辑、启用、停用和移除当前 profile 的 MCP 服务器。每个服务器是一个本地命令或一个 HTTP 端点。密钥以环境变量的形式选择，从不直接键入 profile 文件。页面只在 Host 提供 `mcpServers` Remote 期间存在。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

**MCP 服务器**卡片打开服务器列表。每一行显示服务器的名称、类型、状态，以及命令或 URL；开关用于启用或停用，**编辑**打开表单，**移除**会先询问。**添加服务器**为新服务器打开同一个表单。

表单需要填写**名称**（字母、数字、`_` 和 `-`，它是该服务器工具名称的前缀）、类型，以及命令（每行一个参数，可选工作目录）或 URL。**环境变量**（本地命令）或**请求头**（HTTP）列出名称和值：每个值可以是服务器启动时从 harness 环境读取的**环境变量**（该变量必须已设置）、以 `Bearer <值>` 发送的 **Bearer 变量**，或纯**文本**。形似凭证的名称（如 `TOKEN` 或 `Authorization`）不接受纯文本。文件中已有的存储值显示为**已存储的值**，文件中已有的表达式显示为**表达式**，二者都保持原样。表单还包含工具调用超时，以及服务器必须连接成功插件才启动的选项。

保存本地命令前，会先显示 harness 将要运行的完整命令，并请用户确认信任。服务器可以编辑，但不能更改类型。

在支持热重载的 profile 上更改会立即生效，否则提示需要重启。来自 bundle、家目录补丁或命令行覆盖的行会列出，但不能在此更改；使用表达式的行或带凭证的 URL 的行可以移除或切换，但不能编辑。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Host 部分是一个空的 `apply`，仅用于让包拥有一个 Loader 行，客户端模块系统据此为其提供浏览器部分。浏览器部分由 `McpServersController` 维护页面：读取 `mcpServers.list`，把表单暂存为 `EditorDraft`，并用 `specFromDraft` 把草稿转换为 `McpServerSpec`。被拒绝的保存会回到表单，显示针对 Host 错误码的本地化语句，并在旁边附上 Host 自己的说明。本地命令要保存两次：第一次调用被 `confirmation-required` 拒绝并返回 Host 的命令行；用户确认信任后，第二次带着这段完全相同的文本作为 `confirmedCommand` 重复提交，因此用户读到的文本就是 Host 校验的文本。控制器在每次更改之后，以及收到 `plugin-manager/changed` 和 `connection/reset` 时重新读取，但只在页面打开之后才这样做。

页面把 `McpServersCard` 注册到插件页的 `plugins.item` 插槽，把 `McpServersToast` 注册到 `shell.overlay`，使结果提示在插件面板关闭后依然存在。包注入 `remote.mcpServers`，因此没有该控制器的部署中不会出现这个页面。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [api-mcp-controller](../../api/mcp-controller/README.zh.md) — 页面调用的 Host Remote 及其执行的规则。
- [mcp-client](../../mcp/mcp-client/README.zh.md) — 每一行所配置的插件。
- [ui-plugin-manager](../ui-plugin-manager/README.zh.md) — 插件页和页面注册到的 `plugins.item` 插槽。
- [ui-primitives](../ui-primitives/README.zh.md) — 页面渲染的对话框、开关和字段组件。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包是浏览器侧的设置界面，不注册任何模型可见内容。

#### KV Cache effect

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有连接状态** — 插件启动后该行就显示**已加载**，即使服务器从未连接成功；连接错误只出现在日志中。
- **并非所有值都可编辑** — 在 `env` 和 `headers` 之外使用表达式的行，或 URL 内嵌凭证的行，可以移除或切换，但不能编辑。
- **浏览器侧校验很少** — 完整配置由 Host 校验，表单会显示 Host 拒绝的内容。
- **运行时 invariant：** 不发布伴生包。页面不持有自己拥有的关系：显示的内容来自 `mcpServers.list`，写入的内容由 Host 校验。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
