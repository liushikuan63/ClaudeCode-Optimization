# Optional request recovery gateway

This runtime is opt-in and inert until you start it yourself. Preview installation with `node scripts/install.mjs --with-recovery`, then add `--apply` after reviewing the plan; the default installation omits the runtime. The option adds `gateway.mjs` and this README to the regular skill installation, which can still merge the prompt-routing hook into `settings.json`. It does not add a recovery startup hook, start a process, or change providers, models, credentials, or network configuration.

Requires Node.js 22+. Before manual startup, explicitly set `CC_RECOVERY_PORT` to an unused port from 1–65535 and `CC_RECOVERY_UPSTREAM` to a compatible HTTP API endpoint on the IP literal `127.0.0.1` or `[::1]` with an explicit port. The listener is restricted to loopback IP literals. No default upstream, port, key, or credentials are bundled. `CC_RECOVERY_HOME` optionally selects the local checkpoint and diagnostic directory; otherwise state is kept under `~/.claude/cc-workflow-kit-recovery`.

The gateway can summarize closed conversation history after turn/context limits. That sends historical conversation content to the same configured upstream model and may incur additional cost; local checkpoints and diagnostics may contain sensitive conversation-derived data. Protect and retain that directory accordingly. The runtime does not send data to a bundled service.

Transient retries are bounded by default. Set `CC_RECOVERY_KEEP_TRYING=true` only when you deliberately want persistent retries; stop the process or cancel the request to end them. A transport failure can leave upstream execution status unknown, so retrying a non-idempotent operation may repeat its side effect. Review the recovery skill before using this with consequential operations.

This is not a Claude Code host hook and does not prove that a provider uses the gateway. Connecting a client to it is a separate, deliberate configuration step; test against an isolated local endpoint before using it with real data.
