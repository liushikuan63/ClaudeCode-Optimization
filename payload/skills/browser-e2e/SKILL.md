---
name: browser-e2e
description: 验证页面路由、关键业务交互、浏览器错误或视觉状态时使用；优先使用当前项目已有浏览器测试与 Claude Browser 工具。
---

# 浏览器端到端验收

- 确认当前 checkout、实际服务和页面路由；覆盖受影响入口、关键状态和目标视口，而不是只验证首页或单一成功状态。
- 使用角色、标签、可访问名称等语义定位器，并依赖工具自动等待；网络等待须在触发动作前订阅。避免固定 sleep、宽泛 network-idle 门槛或自动重试掩盖首次失败。
- 隔离测试身份与数据；检查实际业务结果、失败提示、控制台与网络请求。保留首次失败证据；重试成功也报告，不把它改写成首次通过。
- SPA 的文档请求返回 200 可能只是 HTML fallback，不证明路由或 chunk 成功；核 Content-Type、模块加载、API 和应用状态，按一个故障点逐层排查。
- 有视觉变化时对齐视口、路由、状态、字体和滚动位置再比较；用 DOM/计算样式核精确值，截图展示实际视觉。当前宿主工具不能完成浏览器操作时，说明缺口，不假称端到端验收。

按需参考：
- [路由、状态与视口](references/affected-routes-and-viewports.md)
- [SPA 启动分层排障](references/spa-startup-triage.md)
- [动效与主题核验](references/motion-and-theme.md)
