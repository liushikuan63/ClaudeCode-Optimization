---
name: rust-engineering
description: 修改或排查 Rust crate、Cargo feature、异步并发、错误处理或 Rust/原生桥接时使用。
---

# Rust 工程检查

- 先读取 workspace、Cargo.toml/Cargo.lock、rust-toolchain、生产 feature、目标平台和现有脚本；按实际 crate/feature 验证，不机械使用 `--all-features`，因为 features 可能互斥或平台专属。
- 依据数据所有权选择借用、slice 或共享状态；避免无必要 clone 掩盖生命周期问题。错误沿项目已有类型保留诊断上下文，不对可预期失败滥用 `unwrap`/`expect`，也不为示例机械新增依赖。
- 异步路径检查阻塞 I/O、锁作用域、持锁 await、取消/超时、任务生命周期及资源释放。测试须能区分成功、超时、取消和释放；优先用事件/可控时钟同步，避免固定 sleep。
- 通过 public API 做集成检查，内部逻辑用 unit test；涉及可执行接口时考虑 doc test。Tauri/原生桥接须核实际 Rust 命令路径，其他语言单测不能替代。
- 使用当前项目工具链与生产 feature 选 fmt/check/clippy/test；不因新版 clippy 警告全局强制 `-D warnings`。汇报 crate、feature、平台及执行/失败/ignored 数量；设备或安装包行为仅在真实运行后声称验证。
