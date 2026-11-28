# ClaudeCode-Optimization Index

This repository is a public source tree for an opt-in Claude Code toolkit. Start with the [README](README.md) for version downloads, release notes, tag-specific download steps, compatibility, installation, privacy boundaries, and test coverage.

## Package inventory

- [Complete file catalog](catalog.json) — asset path, category, installation mode, byte size, and SHA-256 for every managed file except the two generated manifests themselves.
- [Skill manifest](skills-manifest.json) — the on-demand skills, their route names, and source files.
- `npm run assets:check` verifies both generated manifests; `npm run assets:write` regenerates them from the package allowlist.
- `npm run validate` checks the package structure and manifest freshness. `npm test` runs the offline regression suite.

## Skills

- Evidence and continuity: `verify-before-claim`, `continuation-audit`, `capability-maintenance`.
- Safe changes: `safe-text`, `backup-retention`, `database-safety`, `development-delivery`.
- Backend and contracts: `api-contracts`, `request-recovery`, `spring-mybatis`, `rust-engineering`.
- Browser and performance: `browser-e2e`, `frontend-a11y`, `visual-detail`, `performance-evidence`.
- Workflow and collaboration: `windows-project-workflow`, `github-ci-evidence`, `parallel-work`, `plan-review`, `docs-workflow`.

Skills are loaded on demand. A catalog entry or file's presence does not mean it has been installed into a user's Claude configuration or triggered by the host.

## Related optimization repositories

- [Qoder-Optimization](https://github.com/liushikuan63/Qoder-Optimization)
- [DSH-Optimization](https://github.com/liushikuan63/DSH-Optimization)
- [Codex-Optimization](https://github.com/liushikuan63/Codex-Optimization)
