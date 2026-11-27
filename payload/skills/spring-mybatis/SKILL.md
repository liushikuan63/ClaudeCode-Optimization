---
name: spring-mybatis
description: 处理 Spring 事务、MyBatis 映射、动态 SQL、分页或查询性能时使用。
---

# Spring 与 MyBatis

- 从当前构建文件、父依赖、配置和调用链确认 Java/Spring/MyBatis 版本及项目既有风格；沿真实 controller/job → service → mapper 排查，不跨版本照抄语法或混用 `javax`/`jakarta`。
- 事务围绕完整业务操作。核对代理入口、自调用、异常传播、rollbackFor、多数据源和异步边界；方法有 `@Transactional` 不等于实际调用路径已回滚。
- MyBatis 值用 `#{...}` 参数绑定；`${...}` 是 SQL 文本替换，列名/排序等只能从服务端闭合集合中选择。核对多参数绑定、namespace/id 和结果映射。
- 动态 SQL 的空集合/空过滤条件须明确定义，避免条件被省略后变成全表更新/删除。JOIN 检查行倍增、去重及分页；nested select 检查 N+1。批处理检查 flush、部分失败、幂等和恢复位置。
- 沿项目真实数据库集成测试检查绑定、方言、约束和事务回滚；H2/mock 不能单独证明生产引擎行为。按 Maven/Gradle 的实际门禁核实运行和跳过数量。schema 变化同时遵循 `database-safety`。
