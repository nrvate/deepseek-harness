---
description: "工具输出 guard：在会话日志或模型看到工具结果之前，替换其中已知的凭证和常见令牌格式。"
kind: "package-reference"
---

# @deepseek-ai/dsh-secret-redaction

[English](README.md) | 中文

## 概述

`dsh-secret-redaction` 让凭证不进入对话。工具结果在写入日志或发送给模型之前，其中每个已知的密钥值，以及每个私钥或常见令牌格式，都会被替换为 `[redacted: <名称>]`。已知密钥是名称形似凭证的 harness 环境变量的值，以及凭证提供方存储的值。随附 profile 将它挂载在 `spill-policy` 之后，因此溢出的输出也由已脱敏的内容生成。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `environment` | `true` | 对名称匹配 `KEY`、`TOKEN`、`SECRET`、`PASSW`、`PWD`、`CREDENTIAL`、`AUTH`、`COOKIE`、`_PAT`、`DSN`、`CONNECTION_STRING` 或 `DATABASE_URL` 的 harness 环境变量的值，以及任意变量中 URL 携带的密码进行脱敏 |
| `credentials` | `true` | 对凭证提供方持有的内容脱敏：它解析的 `credentialRefs`、存储的 api key 及其环境变量值，以及存储的授权中的每个字符串 |
| `credentialRefs` | `['DEEPSEEK_API_KEY']` | 每次调用时解析的凭证引用 |
| `patterns` | `true` | 在任何位置对私钥以及 GitHub、GitLab、Slack、AWS、Google、npm 和 `sk-` API key 格式脱敏 |
| `minLength` | `8` | 被脱敏的已知值的最短长度；更短的值会匹配普通文本 |
| `extraNames` | `[]` | 其值为密钥的其他环境变量名称 |

密钥在每次调用时读取，因此启动后才存储的凭证也会在下一次结果中被覆盖。harness 启动时加载的项目 `.env` 会成为其环境的一部分，因此其中名称形似凭证的值同样会被脱敏。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 配置、密钥来源、文本脱敏，以及 `tools/post-execute` 监听器 |

监听器先调用 waterfall 的其余部分，再对返回的决策脱敏：被替换的投影、阻止型监听器的反馈，或结果自身的内容。已知值按长度从长到短替换，因此包含另一个值的值会被整体替换。只修改文本块；图片和其他块原样通过。

不发布运行时不变量伴随模块：监听器在两次调用之间不保存任何状态。

</details>

<a id="model-experience"></a>
## 模型体验

### 已脱敏的结果

#### 模型看到什么

工具结果中的密钥显示为 `[redacted: <名称>]`，名称是环境变量、凭证引用、存储的记录或令牌格式，绝不是值本身。没有密钥的结果保持不变。本包不增加提示词文本，也不增加工具。

#### Token 影响

脱敏标记通常比它替换的密钥短；没有密钥的结果开销不变。

#### KV Cache 影响

无：结果在进入历史之前被脱敏一次，之后不会被改写。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只对 harness 能识别的文本脱敏** — 既没有形似凭证的名称、也没有已知格式的凭证（例如文件中的密码）会原样通过；[受保护路径](../../sandbox/sandbox-policy/README.zh.md)转而让常见的凭证存储不可读。
- **看不到其他监听器替换的值** — 注册表在本监听器运行之后才根据替换后的值渲染内容。
- **模型读取含有脱敏值的文件并写回时，写入的是占位符** — 脱敏改变的是模型看到的内容，而不是文件。
- **模型发送的参数不脱敏** — 模型在调用中输入的密钥会到达该工具。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
