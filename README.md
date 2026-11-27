# CC Workflow Kit

可迁移的 Claude Code 工程协作能力包：**20 个按需技能、3 篇参考、1 个只读复核代理、1 个关键词提示 hook、可选协作规则，以及一个可选的请求恢复网关**。

这不是整个用户配置目录的备份，也不是跨客户端插件。默认安装不启动或接入请求恢复网关；包中不含用户当前运行进程、模型、供应商、权限、密钥、MCP、会话、记忆、日志或私人项目资料。安装器不联网，不启动模型或服务，不修改其他客户端。

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

校验器按 38 个包文件白名单检查：20 个技能的元数据、5 条本地引用、路由清单、代理工具边界、常见凭据格式和源机器路径，以及可选网关文件。不运行网关。该扫描不是“绝无秘密”的证明，分享前仍应审查全部文件。

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
- `scripts/`：安装、白名单与验证逻辑。
- `tests/`：隔离安装与故障边界测试。

本仓库未附加开源许可证；是否公开或授予再分发许可，由仓库拥有者决定。分享包不包含其他客户端的私有执行器、长期历史或未经核验的依赖。
