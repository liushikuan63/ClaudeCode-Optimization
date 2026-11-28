# ClaudeCode-Optimization

[English](#english) | [简体中文](#简体中文)

## English

A portable Claude Code workflow toolkit with **20 on-demand skills, 3 references, 1 read-only verifier agent, 1 keyword prompt hook, optional collaboration rules, and an optional request-recovery gateway**.

Related toolkits: [Qoder-Optimization](https://github.com/liushikuan63/Qoder-Optimization) · [DSH-Optimization](https://github.com/liushikuan63/DSH-Optimization) · [Codex-Optimization](https://github.com/liushikuan63/Codex-Optimization). Each targets a different host; their rules, hooks, skills, and runtime behavior are not interchangeable.

This is not a backup of a user's entire configuration or a cross-client plugin. Default installation does not install or connect the recovery gateway. The package excludes running processes, models, providers, permissions, keys, MCP configuration, sessions, memories, logs, and private project data. The installer does not access the network, start a model or service, or modify other clients.

### Download and versions

| Version | Date | Highlights | Downloads |
| --- | --- | --- | --- |
| **v0.0.1 (current)** | 2026-11-28 | Initial package: 20 skills, an opt-in recovery gateway, and a guarded installer with deterministic asset manifests. | [ZIP](https://github.com/liushikuan63/ClaudeCode-Optimization/archive/refs/tags/v0.0.1.zip) · [tar.gz](https://github.com/liushikuan63/ClaudeCode-Optimization/archive/refs/tags/v0.0.1.tar.gz) |

[Browse all version tags](https://github.com/liushikuan63/ClaudeCode-Optimization/tags) for current and historical source snapshots. **To download from the tags page**, select the ZIP or tar.gz archive link beside the desired tag, or open the tag and use GitHub's source archive downloads. For a direct archive URL, replace `v0.0.1` in the links above with the exact tag name. GitHub generates this tags page, so it cannot host custom per-version instructions; this README provides them. Only `v0.0.1` is published today, and each future tagged version should be added to this table. After extracting, run `node scripts/validate.mjs` and `npm test` from the package directory before installation. GitHub-generated tag archives are source snapshots, not separately built Release packages, and currently have no archive-level `.sha256` attachment. The catalog hashes the managed files inside the package.

### Asset manifests

- [INDEX.md](INDEX.md) is the entry point; [catalog.json](catalog.json) records the path, category, installation mode, byte size, and SHA-256 of each managed source file; [skills-manifest.json](skills-manifest.json) lists the on-demand skills and their files.
- `scripts/asset-manifest.mjs` deterministically generates the manifests from the allowlist in `scripts/kit.mjs`. After changing package assets, run `npm run assets:write`, then `npm run validate`; `npm test` includes a stale-manifest regression test.
- The manifests do not hash themselves. The package validator includes both manifests in the overall package fingerprint. Installation modes distinguish default, explicitly optional, repository-only, and test-only files.
- Only GitHub-generated tag source archives are currently provided; there is no separately built Release package, archive checksum attachment, or remote CI. A source archive is not an independently built and accepted release artifact.

### Compatibility

- Node.js **22+**; built-in modules only, with no third-party dependencies or `npm install` requirement.
- The receiving Claude Code host must support command hooks in **`command` + `args` exec form**. See the [official hooks contract](https://code.claude.com/docs/en/hooks). The documented field has no stated minimum host version; this package does not guess one or fall back to shell-string invocation.
- Installation uses the current Node executable path. Re-preview and verify installation if Node or the configuration directory moves.
- Desktop, CLI, and IDE hosts may expose different capabilities. Skills use only tools available in the active host; Browser, PR monitoring, MCP, and desktop control are not guaranteed.
- Isolated tests do not prove that the receiving host loaded a skill or dispatched a hook.

### Installation

Extract the archive or use the repository root. The target is the **user-level configuration root**, not a project's `.claude` directory.

#### 1. Validate and test

```powershell
node .\scripts\validate.mjs
```

```powershell
npm test
```

`npm run validate` checks the 42-file package allowlist, metadata for 20 skills, 5 local references, routing, verifier-tool boundaries, common credential patterns, source-machine paths, and manifest freshness. It does not run the gateway. This scan cannot prove that no secret exists; review all files before sharing.

#### 2. Preview without writing

```powershell
node .\scripts\install.mjs
```

The default target is `CLAUDE_CONFIG_DIR`, or `~/.claude` when unset. Preview reports the target, proposed additions/updates, and warnings without creating a directory or backup.

To preview against a separate directory:

```powershell
node .\scripts\install.mjs --config-dir ..\cc-kit-demo-config
```

#### 3. Apply after confirming the target

Stop other processes that may concurrently edit the same configuration files, then run:

```powershell
node .\scripts\install.mjs --apply
```

To apply to the isolated demo directory:

```powershell
node .\scripts\install.mjs --config-dir ..\cc-kit-demo-config --apply
```

`--config-dir` takes precedence over the environment variable. In PowerShell, quote a path with spaces or special characters as one argument. The installer does not move existing configuration or change environment variables.

#### Optional rules and conflicts

`CLAUDE.md` is not installed by default, so language and collaboration preferences do not silently become recipient rules. Review [the optional template](rules/CLAUDE.md) and explicitly preview or apply it:

```powershell
node .\scripts\install.mjs --with-rules
```

```powershell
node .\scripts\install.mjs --with-rules --apply
```

Rules are merged once inside the `cc-workflow-kit:begin/end` markers while preserving recipient text. Modified same-name skills, agents, hooks, or rule blocks are rejected by default. Only after reviewing the diff, use `--replace` to replace targets explicitly listed by the package:

```powershell
node .\scripts\install.mjs --replace --with-rules
```

```powershell
node .\scripts\install.mjs --replace --with-rules --apply
```

`--replace` does not remove files outside the package allowlist and does not authorize publishing, committing, deployment, or other actions.

### Optional request-recovery gateway

The recovery runtime is not installed by default. Preview the opt-in files first:

```powershell
node .\scripts\install.mjs --with-recovery
```

After reviewing the changes, apply them explicitly:

```powershell
node .\scripts\install.mjs --with-recovery --apply
```

This option only copies `extensions/request-recovery/gateway.mjs` and its guide. It adds no `SessionStart` hook, starts no process, and changes no model, provider, CC Switch setting, or credentials. You must start the gateway manually and explicitly supply a local HTTP upstream and unused listener port; it binds only to loopback. Recovery summaries send conversation history to that same upstream and may incur cost; local checkpoints and diagnostics may be sensitive. Default retries are bounded; continuing retries require explicit opt-in. See the [gateway guide](payload/extensions/request-recovery/README.md) for installation and privacy boundaries.

### Installation behavior and recovery

- The installer checks the complete package, all target files, UTF-8 JSON, and hook field shapes before writing. Inputs and generated files over 8 MiB are rejected before backup or writes; reversed, missing, or duplicate rule markers are rejected. Path traversal, symlinks, junctions, and multiply hard-linked targets are refused.
- Identical files are skipped. Other `settings.json` fields, events, and hooks are preserved. Normal installation only adds or updates one `UserPromptSubmit` router hook pointing to the package script, with a 3-second timeout and no shell invocation. It adds no `SessionStart` entry or service; `--with-recovery` adds only two inert files.
- Existing `disableAllHooks` and managed-hook restrictions are not overridden; the installer warns rather than escalating permissions to enable itself.
- Before modifying an existing file, original bytes are saved under `backups/cc-workflow-kit-timestamp-random/` beneath the target configuration root and verified by SHA-256. Backups mirror relative paths and may contain sensitive settings: **never commit or upload them**. Windows ACLs are inherited from the containing directory; use a protected configuration location.
- Settings are written last. Existing files use same-directory staging and atomic replacement; new files use exclusive creation. Changes in file content or identity stop the operation.
- **This is not a cross-file atomic transaction and does not lock concurrent writers.** A filesystem race remains between checking and replacement, so do not install while another writer is active. Runtime failures may leave some files written; the error reports `written`, `attempted`, and `backupDir` without blindly overwriting later changes during rollback.
- Before restoring, compare current files with the report, preserve changes made by other sessions, and restore only the necessary files from their matching backups. Newly created files have no previous version; do not delete the whole directory.
- The installer does not prune old recovery points. Retention guidance in the `backup-retention` skill is not an active cleanup service.

### Skills and review agent

| Area | Skills |
| --- | --- |
| Evidence, continuity, and file safety | `verify-before-claim`, `continuation-audit`, `safe-text`, `backup-retention` |
| Recovery, APIs, databases, and backend | `request-recovery`, `api-contracts`, `database-safety`, `spring-mybatis`, `rust-engineering` |
| Browser and performance | `browser-e2e`, `frontend-a11y`, `visual-detail`, `performance-evidence` |
| Engineering workflow and delivery | `windows-project-workflow`, `github-ci-evidence`, `development-delivery`, `parallel-work` |
| Planning, docs, and capability maintenance | `plan-review`, `docs-workflow`, `capability-maintenance` |

The [read-only verifier agent](payload/agents/runtime-truth-verifier.md) can inspect current evidence but cannot authorize fixes, write files, start services, or call paid models for the main agent. Listing a tool does not grant additional permission.

### Hook boundaries

[payload/hooks/local-habits.mjs](payload/hooks/local-habits.mjs) derives skill paths from its installation location, matches prompt keywords, and emits at most **2** skill-path hints. It only accepts `UserPromptSubmit`, limits stdin to 1 MiB and prompts to 65,536 UTF-16 code units, and exits silently for unrelated, invalid, or oversized input. It does not echo prompts, persist state, read sessions, approve actions, or act as a security gate.

Keyword hints are discovery aids: they may miss a skill or show only the first two matches. They do not replace main-agent judgment or the Skill tool. Silent pass-through on invalid input is limited to this non-authorizing index hint and must not be reused as a fail-open security gate.

After installation, use a new receiving-host session to verify skill discovery, actual `UserPromptSubmit` dispatch, and task behavior separately. Isolated package tests do not establish those facts.

### Verification coverage

Hook tests cover 17 routing positive and negative cases. Offline gateway tests cover 41 scenarios, including continuation, summary checkpoints, cancellation, incomplete streams, bounded/explicit persistent retries, loopback binding, and zero state-directory writes without configuration. Installer tests cover first install, zero-write default preview, inert optional gateway copying, idempotent reinstall, preserving existing settings, zero-write conflict/invalid JSON cases, recovery points, optional rules, link escape, concurrent changes, permission denial, and interrupted writes. Tests use temporary paths containing Chinese, spaces, dollar signs, apostrophes, and `&`, and execute the exact configured executable/argv.

Permission denial and interruption are deterministic fault injections; they do not establish behavior across every OS ACL, power loss, or filesystem. There is no remote CI or professional-project end-to-end verification, and none is created automatically.

### Repository layout

- `payload/skills/`: 20 skills and 3 browser references.
- `payload/extensions/request-recovery/`: optional local gateway and guide, not installed by default; offline gateway tests are not installed into user configuration.
- `payload/agents/`: read-only verifier agent.
- `payload/hooks/`: portable router and its tests; tests are not installed.
- `rules/CLAUDE.md`: explicitly optional rules template.
- `INDEX.md`, `catalog.json`, `skills-manifest.json`: overview, per-file asset catalog, and skills manifest.
- `scripts/`: installer, allowlist, asset-manifest generator, and validator.
- `tests/`: isolated installation and failure-boundary tests.

This repository does not include an open-source license; public visibility does not itself grant redistribution rights. The package excludes private executors from other clients, long-term history, and unverified dependencies.

## 简体中文

可迁移的 Claude Code 工程协作能力包：**20 个按需技能、3 篇参考、1 个只读复核代理、1 个关键词提示 hook、可选协作规则，以及一个可选的请求恢复网关**。

相关分享包：[Qoder-Optimization](https://github.com/liushikuan63/Qoder-Optimization) · [DSH-Optimization](https://github.com/liushikuan63/DSH-Optimization) · [Codex-Optimization](https://github.com/liushikuan63/Codex-Optimization)。这些仓库面向不同宿主，规则、hook、技能和运行时能力不可直接互换。

这不是整个用户配置目录的备份，也不是跨客户端插件。默认安装不启动或接入请求恢复网关；包中不含用户当前运行进程、模型、供应商、权限、密钥、MCP、会话、记忆、日志或私人项目资料。安装器不联网，不启动模型或服务，不修改其他客户端。

## 下载与版本

| 版本 | 日期 | 主要内容 | 下载 |
| --- | --- | --- | --- |
| **v0.0.1（当前）** | 2026-11-28 | 首个分享包：20 个技能、可选请求恢复网关，以及带确定性资产清单的防护型安装器。 | [ZIP](https://github.com/liushikuan63/ClaudeCode-Optimization/archive/refs/tags/v0.0.1.zip) · [tar.gz](https://github.com/liushikuan63/ClaudeCode-Optimization/archive/refs/tags/v0.0.1.tar.gz) |

[浏览全部版本标签](https://github.com/liushikuan63/ClaudeCode-Optimization/tags)可查看当前及历史源码快照。**在标签页下载**：选择目标标签旁的 ZIP 或 tar.gz 归档链接，也可以打开标签后选择 GitHub 提供的源码归档下载。直接构造归档链接时，把上方链接中的 `v0.0.1` 替换为目标标签名即可。GitHub 的标签页由平台生成，不能直接添加自定义的逐版本说明，因此这里提供下载指引。目前仅发布了 `v0.0.1`；后续每个带标签的版本都应加入此表。下载并解压后，按“安装”章节先运行 `node scripts/validate.mjs` 与 `npm test`。GitHub 自动生成的 tag 归档是源码快照，不是单独构建的 Release 包，目前没有归档级 `.sha256` 附件；清单中的 SHA-256 用于校验包内受管文件。

## 清单与资产管理

- [INDEX.md](INDEX.md) 是入口索引；[catalog.json](catalog.json) 为所有受管源文件记录路径、类型、安装模式、字节数和 SHA-256；[skills-manifest.json](skills-manifest.json) 独立列出按需技能及其文件。
- 清单由 `scripts/asset-manifest.mjs` 从 `scripts/kit.mjs` 的白名单确定性生成。新增、删除或变更包资产后，运行 `npm run assets:write` 更新，再运行 `npm run validate` 检查清单、引用和整体包指纹；`npm test` 含陈旧清单拒绝回归。
- 清单不自引用自身哈希；包校验器会把两个清单也纳入整体内容指纹。清单中的安装模式区分默认复制、显式可选、仓库维护和仅测试资产。
- 当前仅提供 GitHub 自动生成的 tag 源码归档；尚无单独构建的 Release 包、归档 SHA-256 附件或远程 CI。源码归档不等同于经过独立构建验收的发布资产。

## 环境与兼容性

- Node.js **22+**；使用内置模块，无第三方依赖，无需运行 `npm install`。
- 接收方 Claude Code 必须支持 command hook 的 **`command` + `args` exec form**。参见 [官方 hooks 契约](https://code.claude.com/docs/en/hooks)。官方未在该字段注明最低版本，本包不猜测版本兼容范围，不自动回退到 shell 拼接。
- 安装时使用当前 Node 的真实可执行路径；Node 或配置目录迁移后，应从新位置重新预演、核对并安装。
- Claude Desktop、CLI 与 IDE 宿主能力可能不同。技能只复用当前宿主实际提供的工具，不保证每个宿主都有 Browser、PR monitor、MCP 或桌面操作能力。
- 自动测试使用隔离临时目录，不应把磁盘安装、脚本直测当作 Claude 宿主已加载/已派发的证据。

## 安装

先解压或进入此仓库根目录。安装目标是**用户级配置根**，不是项目的 `.claude` 子目录。

### 1. 校验包与运行测试

```powershell
node .\scripts\validate.mjs
```

```powershell
npm test
```

- `npm run validate`：校验 42 个包文件白名单、20 个技能的元数据、5 条本地引用、路由清单、代理工具边界、常见凭据格式和源机器路径，并检查机器可读清单是否过期。不会运行网关。该扫描不是“绝无秘密”的证明，分享前仍应审查全部文件。

### 2. 只读预演

```powershell
node .\scripts\install.mjs
```

默认目标为 `CLAUDE_CONFIG_DIR`；未设置时为用户主目录下 `.claude`。预演输出目标、拟新增/更新文件和警告，不创建目录、不写备份。

可先使用一个独立目录演练：

```powershell
node .\scripts\install.mjs --config-dir ..\cc-kit-demo-config
```

### 3. 确认目标后应用

安装前停止其他会并发修改同一配置文件的操作。以下命令会写入目标用户配置：

```powershell
node .\scripts\install.mjs --apply
```

独立目录演练的应用命令：

```powershell
node .\scripts\install.mjs --config-dir ..\cc-kit-demo-config --apply
```

`--config-dir` 优先于环境变量。路径含空格或特殊字符时，在 PowerShell 中将整个路径作为一个引号参数传入。安装器不会移动现有配置或改变环境变量。

### 可选规则与冲突处理

默认不安装 `CLAUDE.md`，语言和个人协作偏好不会自动成为接收者规则。需要时先审阅 [可选模板](rules/CLAUDE.md)，再显式选择：

```powershell
node .\scripts\install.mjs --with-rules
```

```powershell
node .\scripts\install.mjs --with-rules --apply
```

规则追加在 `cc-workflow-kit:begin/end` 标记块中，保留接收者原文；重复安装不重复追加。已修改的同名技能、代理、hook 或规则块默认拒绝，整批预检失败时零写入。审查差异后确实需要替换，才使用：

```powershell
node .\scripts\install.mjs --replace --with-rules
```

```powershell
node .\scripts\install.mjs --replace --with-rules --apply
```

`--replace` 只允许替换包内明确列出的目标，不删除未列出的文件；不意味着重新授权发布、提交、部署或执行其他动作。

## 可选请求恢复网关

默认预演与应用都不安装请求恢复运行时。明确选择时先预演：

```powershell
node .\scripts\install.mjs --with-recovery
```

检查差异后再应用：

```powershell
node .\scripts\install.mjs --with-recovery --apply
```

该选项只额外复制 `extensions/request-recovery/gateway.mjs` 和随附说明；不会添加 `SessionStart` hook、启动进程或改动模型、供应商、CC Switch、凭据。网关仍须由你手动启动并显式提供本地 HTTP 上游地址和未占用监听端口；它只绑定回环地址。恢复摘要会把历史对话发给同一上游并可能产生额外费用，本地检查点/诊断信息也可能敏感。默认重试有界，持续重试必须显式启用。安装和隐私边界见[网关说明](payload/extensions/request-recovery/README.md)。

## 安装行为与恢复

- 先检查完整包、所有目标文件、UTF-8 JSON 和 hooks 字段结构，再进行写入。输入与生成后的每个文件均不得超过 8 MiB，超限在创建恢复点或写入前拒绝；逆序、缺失或重复的规则标记也会拒绝。拒绝路径越界、符号链接、目录联接和多硬链接目标。
- 同字节文件跳过；保留 `settings.json` 的其他字段、所有其他事件与 hook。常规安装只新增或更新指向本包脚本的一个 `UserPromptSubmit` 路由，超时为 3 秒，不使用 shell；不增加 `SessionStart` 启动项或启动服务。`--with-recovery` 只增加两个惰性文件。
- 不取消现有 `disableAllHooks` 或受管理 hook 限制；输出警告，但不会为“启用”而提升权限。
- 每次修改已有文件前，在目标配置根 `backups/cc-workflow-kit-时间戳-随机值/` 保存原始字节并校验 SHA-256。目录保留相同相对路径，含敏感设置时备份也同样敏感，**不要提交或上传备份**。Windows 权限沿用所在目录 ACL；请选择受保护的配置位置。
- settings 最后写入；已有文件使用同目录暂存与原子替换，新文件使用独占创建。检测到预像或对象身份变化就停止。
- **这不是跨文件原子事务，也不提供并发写入锁。** 检查与替换间仍有文件系统竞态窗口，不应与其他写者同时安装。运行时故障可能留下部分已写文件；错误报告包含 `written`、`attempted` 和 `backupDir`，不会盲目回滚覆盖后来修改。
- 恢复前先比较当前文件与本次报告，保住其他会话的新改动，再从对应备份恢复需要的文件。新建文件没有旧版本，不要按目录整体删除。
- 安装器不自动清理历史恢复点；`backup-retention` 技能中的保留政策是任务指导，不是已启动的清理服务。

## 能力清单

| 分类 | 技能 |
| --- | --- |
| 证据、接续与文件安全 | `verify-before-claim`、`continuation-audit`、`safe-text`、`backup-retention` |
| 请求恢复、API、数据库与后端 | `request-recovery`、`api-contracts`、`database-safety`、`spring-mybatis`、`rust-engineering` |
| 浏览器与性能 | `browser-e2e`、`frontend-a11y`、`visual-detail`、`performance-evidence` |
| 工程组织与交付 | `windows-project-workflow`、`github-ci-evidence`、`development-delivery`、`parallel-work` |
| 方案、文档与能力维护 | `plan-review`、`docs-workflow`、`capability-maintenance` |

[只读复核代理](payload/agents/runtime-truth-verifier.md) 可以检查当前证据，但不能替主线授权修复、写入、启动服务或付费模型请求；配置中列出的工具并不自动扩大权限。

## Hook 边界

[local-habits.mjs](payload/hooks/local-habits.mjs) 从自身安装位置推导技能路径，匹配提示中的关键词，最多输出 **2 个**技能路径索引。只接收 `UserPromptSubmit`，限制 stdin 为 1 MiB、提示为 65,536 个 UTF-16 code units；无关、坏输入或超限输入静默退出。它不回显用户提示、不保存状态、不读取会话、不批准操作，也不是安全拦截器。

关键词提示只是发现入口：可能漏报或优先匹配前两个技能，不能替代主线判断或正式 Skill 工具。坏输入静默通过仅适用于这个无权限的索引提示，不能复制成安全门禁的 fail-open 策略。

安装后应在接收宿主的新会话中分别确认技能发现、真实 `UserPromptSubmit` 派发和实际任务行为；本包的隔离测试不能替代这些验收。

## 验证覆盖

Hook 测试覆盖 17 组路由正反例；离线网关测试覆盖 41 个场景，包括上下文续接、摘要检查点、取消、不完整流、有限/显式持续重试、回环监听和无配置时零状态目录写入。安装测试另覆盖初装、默认预演零写入、可选网关惰性复制、幂等复装、现有配置保留、冲突/坏 JSON 零写入、恢复点、可选规则、链接逃逸、并发变化、权限拒绝与写入中断。使用中文、空格、美元符号、单引号和 `&` 的临时路径，直接运行生成配置中的精确 executable/argv。

测试中的权限拒绝和中断由确定性故障注入实现，不代表所有操作系统 ACL、断电或文件系统都已实测。没有远程 CI 或专业项目端到端验证，也不自动创建它们。

## 目录

- `payload/skills/`：20 个技能与 3 篇浏览器参考。
- `payload/extensions/request-recovery/`：默认不安装的可选本地网关与使用说明；离线网关测试不安装到用户配置。
- `payload/agents/`：只读复核代理。
- `payload/hooks/`：可迁移路由与原有测试；测试脚本不安装到用户配置。
- `rules/CLAUDE.md`：显式可选的规则模板。
- `INDEX.md`、`catalog.json`、`skills-manifest.json`：总览、逐文件资产目录和技能清单。
- `scripts/`：安装、白名单、资产清单生成与验证逻辑。
- `tests/`：隔离安装与故障边界测试。

本仓库未附加开源许可证；是否公开或授予再分发许可，由仓库拥有者决定。分享包不包含其他客户端的私有执行器、长期历史或未经核验的依赖。
