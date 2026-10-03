# Agent Note: 工具与外发数据的最小权限默认值

Status: implemented

[English](2026-10-02-least-privilege-tool-defaults.md) | 中文

## 问题

对本 fork 的五方面审计发现，数据会在用户不知情的情况下离开本机或到达模型。即使在只读会话中，每个 MCP 工具也会不经询问直接运行。`web_fetch` 会发送模型选择的任意 URL，因此受提示词注入的模型可以把对话内容放进查询字符串。模型可以读取 harness 自己的凭证文件、云服务和 SSH 凭证以及环境中的密钥，而在会话日志和模型提供方收到工具输出之前，没有任何机制把它们移除。原始会话日志包含多于模型所见的内容，却默认随每次 DeepSeek 请求上传。

## 决策

外发操作先询问，凭证不进入工具输出，上传需要选择加入。

**MCP 工具调用遵循按服务器配置的策略。** `mcp-client` 新增 `toolPolicy`：一个 `default` 模式和逐工具模式，取值为 `allow`、`ask` 或 `deny`，默认 `ask`。关卡是客户端为自己的工具注册的 `tools/pre-execute` 监听器，因此原生调用、PTC 调用和子 agent 调用都会经过它；它永远不会放宽后续监听器的拒绝。GUI 在服务器表单中编辑服务器默认值，在工具对话框中编辑逐工具模式，MCP 调用的审批提示还提供**始终允许**。这些修改写入 `mcp-policy`：这是一个存储，Loader 会原地更新它唯一的 volatile 字段。`mcp-client` 的配置是按传输方式区分的 union，其中的字段不能是 volatile，写在那里会使服务器重新连接，丢失其状态以及正在等待审批的调用。

**`web_fetch` 在获取允许列表之外的主机前先询问。** `tool-web` 新增 `fetchApproval`（默认 `ask`）和 `fetchAllowedHosts`。审批提示显示完整 URL。

**拥有完全访问权限的会话不会被询问。** `danger-full-access` 是用户选择不经提示运行，因此两个关卡在该模式下都放行。没有审批渠道的调用方（例如审批策略固定为 `never` 的委派子级）会被拒绝。

**工具输出会被脱敏。** `secret-redaction` 在每个工具结果写入日志之前，把名称形似凭证的环境变量的值、凭证提供方持有的值、私钥以及常见令牌格式替换为 `[redacted: <名称>]`。

**凭证存储是受保护路径。** `sandbox-policy` 新增 `protectedPaths`，默认包括 SSH、GPG、云服务、容器和软件源凭证位置，以及 harness 的凭证文件和 `.env`。bwrap 和 Seatbelt 对受限命令隐藏它们；沙箱文件系统在所有模式下拒绝访问它们。

**会话日志上传需要选择加入。** `session-log-deepseek.enabled` 默认为 `false`。

**stdio MCP 服务器继承允许列表环境**，而不再使用按名称模式的清洗。

工具本身就是所启用功能的第一方集成（浏览器操作和计算机操作驱动）显式设置 `toolPolicy: { default: allow }`。

## 备选方案

**信任 MCP 工具注解（`readOnlyHint`）。** 作为默认值被否决：服务器控制自己的注解，恶意服务器会把每个工具都标为只读。

**为所有工具使用一个通用的外发策略插件。** 推迟：拥有该工具的插件知道一次调用发送了什么（URL、服务器和工具），因此每个关卡留在自己的工具中，并显示具体的提示。

**按键值启发式（`NAME=value` 行）脱敏。** 否决：它会破坏模型读取后写回的代码。脱敏只匹配已知值和格式，受保护路径则覆盖其值没有固定格式的存储。

**只对 shell 拒绝受保护路径。** 否决：文件工具和 GUI 文件端点通过同一个文件系统读取，因此拒绝也放在那里。

## 后果

调用 MCP 工具或获取网页的 headless、SDK 和 ACP 运行现在需要审批渠道、`toolPolicy`/`fetchApproval: allow` 或完全访问权限；ACP 客户端会在每次调用时收到权限请求。调用这些工具的录制场景和 Python 冒烟测试显式设置 `allow`。

Landlock 和 Windows ACL runner 无法隐藏受保护路径，完全访问权限下的 shell 不受限制。脱敏看不到其他 post-execute 监听器替换的值，模型改写含有脱敏值的文件时会写入占位符。

## 测试

`packages/mcp/mcp-client/tests/policy.spec.ts` 和 `packages/web/tool-web/tests/fetch-approval.spec.ts` 通过真实的工具注册表、配合桩审批服务和沙箱策略服务驱动这两个关卡。`packages/guard/secret-redaction/tests` 覆盖每种来源和格式。`packages/sandbox/sandbox-local/tests/bwrap.e2e.ts` 运行真实的 bwrap 受限执行，验证其无法读取受保护的文件或目录；`packages/fs/fs-sandbox/tests` 覆盖所有模式下以及经由链接的拒绝。`apps/web/tests/mcp-servers.e2e.ts` 在浏览器中针对真实 MCP 服务器设置工具的模式。
