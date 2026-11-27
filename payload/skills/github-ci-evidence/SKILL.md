---
name: github-ci-evidence
description: 检查 GitHub Actions、PR 检查、失败 job 或 CI 成本证据时使用；不用于无关本地测试。
---

# GitHub CI 证据

- 若当前宿主提供已绑定 PR 的状态和 CI monitor，优先使用，并遵守其监控约束；其他宿主按授权使用 gh 对具体 PR/run/job/check 做单次查询。没有授权不启动远程轮询，不假设所有宿主都提供 Desktop monitor。
- 记录准确 PR/head SHA、run attempt、job/runner 和失败 step；区分 workflow run ID、job ID 与 check-run ID。0 steps、404、缺日志只是一条待解释证据，不单独证明配额、跳过原因或任务成功。
- 对成本/耗时优化沿 workflow → 调用脚本 → 实际生成器/门禁追踪；分别报告实测时间、计费费率来源和估算。省时不能靠绕过质量门禁或隐去取消任务。
- 重新运行、取消任务、改收费配置、推送和部署分别需要当前授权。报告远端失败的原始证据与本地复现边界，不把本地测试冒充 CI 通过。
