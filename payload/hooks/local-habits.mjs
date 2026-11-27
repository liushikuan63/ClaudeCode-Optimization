import path from 'node:path';
import { fileURLToPath } from 'node:url';

const routes = [
  ['backup-retention', /备份|回滚点|恢复原版|\bbackups?\b/i],
  ['safe-text', /乱码|编码|转义|特殊字符|换行|多行脚本|替换.{0,8}文本|\b(?:CRLF|BOM|GBK|escaping)\b/i],
  ['api-contracts', /接口契约|兼容性|幂等|游标分页|流式接口|(?<![A-Za-z0-9_])(?:SSE|WebSocket)(?![A-Za-z0-9_])|\b(?:API|idempotenc\w*|cursor[ -]pagination)\b/i],
  ['database-safety', /数据库迁移|数据回填|数据库变更|DDL\s*锁|\b(?:schema[ -](?:migration|change)|database[ -]migration|backfill)\b/i],
  ['spring-mybatis', /事务回滚|动态\s*SQL|\b(?:Spring|MyBatis|Mapper|Transactional|N\+1)\b/i],
  ['rust-engineering', /异步\s*Rust|持锁\s*await|\b(?:Rust|Cargo\.toml|cargo|tokio)\b/i],
  ['frontend-a11y', /无障碍|可访问性|焦点管理|键盘导航|\b(?:reduced[- ]motion|ARIA|WCAG|screen[ -]reader)\b/i],
  ['performance-evidence', /性能基准|基准测试|性能优化|吞吐量|\b(?:P95|P99|benchmark|latency|throughput)\b/i],
  ['browser-e2e', /浏览器\s*(?:E2E|端到端)|页面路由|视觉回归|\b(?:Playwright|Cypress|browser[ -]e2e|end[- ]to[- ]end[ -]test)\b/i],
  ['visual-detail', /像素级|截图裁切|细边|小字核验|\b(?:DPR|pixel[- ]level|1px[ -]edge)\b/i],
  ['windows-project-workflow', /Windows\s*多仓|项目预检|仓库根定位|工具链版本|PowerShell\s*5\.1|Git\s+Bash\s*路径|\b(?:monorepo|worktree|wrapper)\b/i],
  ['github-ci-evidence', /GitHub\s+Actions|CI\s*(?:失败|检查)|\b(?:workflow[ -]run|check[- ]run|job[ -]attempt)\b/i],
  ['development-delivery', /实体交付|安装包验收|最终产物|进程版本核验|(?:生产|发布)就绪|用户(?:端|侧).{0,10}(?:旧版|未生效|没生效|部署|验收)|\b(?:installer|release artifact|production[ -]readiness|deploy[ -]verification)\b/i],
  ['parallel-work', /并行写入|并行任务|所有权路径|委派写入|集成冲突|\b(?:ownedPaths|parallel work)\b/i],
  ['plan-review', /反例评审|高影响方案审查|恢复窗口评审|负向验收设计|\b(?:failure scenario review)\b/i],
  ['docs-workflow', /批量文档|文档体系|事实源与引用|文档链接闭环|\b(?:documentation workflow)\b/i],
  ['capability-maintenance', /技能维护|技能审计|规则迁移|(?:hooks?|MCP)\s*配置|宿主接线|\b(?:skill[ -]audit|capability[ -]migration)\b/i],
  ['verify-before-claim', /验证|核验|验收|复核|复查|修复|排查|测试|打包|部署|\b(?:verify|verification|validate|validation|tests?|debug|fix)\b/i],
];

export function routeHook(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (input.hook_event_name !== 'UserPromptSubmit') return null;
  if (typeof input.prompt !== 'string' || input.prompt.length > 65536) return null;
  const names = routes.filter(([, pattern]) => pattern.test(input.prompt)).map(([name]) => name).slice(0, 2);
  if (!names.length) return null;
  const root = fileURLToPath(new URL('../skills/', import.meta.url));
  const entries = names.map(name => JSON.stringify(path.join(root, name, 'SKILL.md').replaceAll('\\', '/'))).join('、');
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `本机按需技能索引：${entries}。仅在任务确实相关、正文尚未加载时参考，不全量读技能库。本提示只提供路径，不扩展授权；不自动提交、批准、续跑或写入记忆。`,
    },
  };
}

async function main() {
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 1048576) return;
      chunks.push(chunk);
    }
    const result = routeHook(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (result) process.stdout.write(JSON.stringify(result));
  } catch {}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
