---
name: windows-project-workflow
description: 在 Windows 多仓、monorepo、worktree 或混合脚本项目中定位真实验证入口与当前工具链时使用。
---

# Windows 项目预检

- 从当前路径向上、向下辨认实际仓库根、嵌套仓、worktree 与适用的 CLAUDE.md/AGENTS.md 指令；历史目录清单和仓库名称只是线索。不要把真实数据、安装包或用户目录误认为可清理临时副本。
- 按当前仓库的锁文件、wrapper、目标平台和 CI 选择运行入口；版本号只从本仓工具配置和执行器现场读取。不统一升级全机工具，不把 Web 构建当作原生/设备验证。
- 确认代码是否生成、被生成物的上游和正式门禁；测试 skip、忽略数与报告要核实，不凭命令返回码或无日志宣称全量通过。
- Windows 命令问题沿实际解释器、argv/路径转换、编码/原始字节、stdout/stderr 与退出码分层排查。PowerShell 5.1、PowerShell 7、Git Bash 的路径和编码规则不同；先确认实际 shell，不盲目套用路径或 BOM 修复。
- 失败保留首个现场，一次只改一个诊断变量；“重跑变绿”只证明本次重跑通过，不能证明根因已修复。没有运行项目时，将结果标作静态检查和缺口。
