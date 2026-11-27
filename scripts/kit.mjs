import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const KIT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const SKILLS = [
  'verify-before-claim', 'safe-text', 'backup-retention', 'api-contracts', 'request-recovery', 'continuation-audit',
  'database-safety', 'rust-engineering', 'spring-mybatis', 'frontend-a11y',
  'performance-evidence', 'browser-e2e', 'windows-project-workflow',
  'github-ci-evidence', 'development-delivery', 'parallel-work',
  'plan-review', 'visual-detail', 'docs-workflow', 'capability-maintenance',
];
export const PAYLOAD_FILES = [
  ...SKILLS.map(name => `skills/${name}/SKILL.md`),
  ...['affected-routes-and-viewports', 'spa-startup-triage', 'motion-and-theme']
    .map(name => `skills/browser-e2e/references/${name}.md`),
  'agents/runtime-truth-verifier.md',
  'hooks/local-habits.mjs',
];
export const RECOVERY_FILES = [
  'extensions/request-recovery/gateway.mjs',
  'extensions/request-recovery/README.md',
];
export const ASSET_MANIFEST_FILES = ['catalog.json', 'skills-manifest.json'];
export const PACKAGE_FILES = [
  ...PAYLOAD_FILES.map(name => `payload/${name}`),
  ...RECOVERY_FILES.map(name => `payload/${name}`),
  'payload/hooks/local-habits.test.mjs',
  'payload/extensions/request-recovery/gateway.test.mjs',
  'rules/CLAUDE.md',
  'INDEX.md', 'README.md', 'catalog.json', 'skills-manifest.json',
  'package.json', '.gitignore', '.gitattributes',
  'scripts/asset-manifest.mjs', 'scripts/kit.mjs', 'scripts/install.mjs', 'scripts/validate.mjs',
  'tests/install.test.mjs',
].sort();

export const digest = data => createHash('sha256').update(data).digest('hex');
export const decode = data => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function inside(root, relative) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..' || !part)) {
    throw new Error('Unsafe relative path');
  }
  const result = path.resolve(root, relative);
  const back = path.relative(path.resolve(root), result);
  if (!back || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) throw new Error('Path escapes root');
  return result;
}

export function assertNoLinks(target) {
  const full = path.resolve(target);
  let current = path.parse(full).root;
  const parts = full.slice(current.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    let info;
    try { info = fs.lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`Linked path refused: ${current}`);
    if (index < parts.length - 1 && !info.isDirectory()) throw new Error(`Not a directory: ${current}`);
  }
}

const identity = stat => [stat.dev, stat.ino, stat.size, stat.mode, stat.mtimeMs, stat.ctimeMs].join(':');

export function image(target) {
  assertNoLinks(target);
  let before;
  try { before = fs.lstatSync(target); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!before.isFile() || before.nlink !== 1) throw new Error(`Expected an unlinked regular file: ${target}`);
  if (before.size > MAX_FILE_BYTES) throw new Error(`File exceeds 8 MiB safety limit: ${target}`);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    if (identity(fs.fstatSync(fd)) !== identity(before)) throw new Error(`File changed while opening: ${target}`);
    const data = fs.readFileSync(fd);
    assertNoLinks(target);
    if (identity(fs.fstatSync(fd)) !== identity(before) || identity(fs.lstatSync(target)) !== identity(before)) {
      throw new Error(`File changed while reading: ${target}`);
    }
    return { data, identity: identity(before), mode: before.mode & 0o777, sha256: digest(data) };
  } finally {
    fs.closeSync(fd);
  }
}

export function assertImage(target, expected) {
  const actual = image(target);
  if (actual?.identity !== expected?.identity || actual?.sha256 !== expected?.sha256) {
    throw new Error(`Concurrent change detected: ${target}`);
  }
}

function tree(root, prefix = '') {
  const entries = [];
  for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
    if (!prefix && name === '.git') continue;
    const relative = prefix ? `${prefix}/${name}` : name;
    const full = inside(root, relative);
    const info = fs.lstatSync(full);
    if (info.isSymbolicLink()) throw new Error(`Linked package path refused: ${relative}`);
    if (info.isDirectory()) entries.push(...tree(root, relative));
    else if (info.isFile()) entries.push(relative);
    else throw new Error(`Unsupported package entry: ${relative}`);
  }
  return entries.sort();
}

function assetCategory(relative) {
  if (relative.startsWith('tests/') || relative.endsWith('.test.mjs')) return 'test';
  if (relative.startsWith('payload/skills/') && relative.includes('/references/')) return 'reference';
  if (relative.startsWith('payload/skills/')) return 'skill';
  if (relative.startsWith('payload/agents/')) return 'agent';
  if (relative.startsWith('payload/hooks/')) return 'hook';
  if (relative.startsWith('payload/extensions/')) return 'extension';
  if (relative.startsWith('rules/')) return 'rule';
  if (relative.startsWith('scripts/')) return 'tool';
  if (relative === 'README.md' || relative === 'INDEX.md') return 'documentation';
  return 'metadata';
}

function assetInstallMode(relative) {
  if (assetCategory(relative) === 'test') return 'test-only';
  if (relative.startsWith('payload/extensions/')) return 'optional: --with-recovery';
  if (relative === 'rules/CLAUDE.md') return 'optional: --with-rules';
  if (assetCategory(relative) === 'tool' || assetCategory(relative) === 'documentation' || relative.endsWith('.json')) return 'repository-only';
  return 'default';
}

export function buildAssetManifests(root = KIT_ROOT, sourceFiles = null) {
  const managedNames = PACKAGE_FILES.filter(name => !ASSET_MANIFEST_FILES.includes(name));
  const files = sourceFiles ?? new Map(managedNames.map(name => [name, image(inside(root, name))]));
  const packageData = JSON.parse(decode(files.get('package.json').data));
  const entries = managedNames.map(relative => ({
    path: relative,
    category: assetCategory(relative),
    install: assetInstallMode(relative),
    bytes: files.get(relative).data.length,
    sha256: files.get(relative).sha256,
  }));
  const catalog = {
    schema: 'cc-optimization/catalog/v1',
    package: {
      name: packageData.name,
      version: packageData.version,
      repository: packageData.repository?.url ?? null,
    },
    generated: 'deterministic-from-package-bytes',
    counts: {
      managedFiles: entries.length,
      skills: SKILLS.length,
      references: entries.filter(entry => entry.category === 'reference').length,
      optional: entries.filter(entry => entry.install.startsWith('optional:')).length,
      tests: entries.filter(entry => entry.category === 'test').length,
    },
    entries,
    statusLegend: {
      default: '复制到用户配置的默认资产',
      'optional: --with-recovery': '仅在显式选择 --with-recovery 时复制',
      'optional: --with-rules': '仅在显式选择 --with-rules 时复制',
      'repository-only': '仓库说明、清单或安装器元数据，不复制到用户配置',
      'test-only': '仅用于离线测试，不安装到用户配置',
    },
  };
  const skillsManifest = {
    package_name: packageData.name,
    version: packageData.version,
    generated: 'deterministic-from-package-bytes',
    skills: SKILLS.map(name => ({
      name,
      tier: 'on-demand',
      install: 'copy-skill',
      route: name,
      files: [
        `payload/skills/${name}/SKILL.md`,
        ...(name === 'browser-e2e' ? [
          'payload/skills/browser-e2e/references/affected-routes-and-viewports.md',
          'payload/skills/browser-e2e/references/spa-startup-triage.md',
          'payload/skills/browser-e2e/references/motion-and-theme.md',
        ] : []),
      ],
    })),
  };
  return { catalog, skillsManifest };
}

export function validateKit(root = KIT_ROOT) {
  assertNoLinks(root);
  const names = tree(root);
  if (JSON.stringify(names) !== JSON.stringify(PACKAGE_FILES)) {
    const missing = PACKAGE_FILES.filter(name => !names.includes(name));
    const extra = names.filter(name => !PACKAGE_FILES.includes(name));
    throw new Error(`Package allowlist mismatch; missing: ${missing.join(', ')}; unexpected: ${extra.join(', ')}`);
  }
  const files = new Map();
  const secret = /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/;
  const machine = /[CD]:[\\/]Users[\\/]Admin\b|D:[\\/]UserData[\\/]|~\/\.(?:dsh|qoder|codex)\//i;
  for (const relative of names) {
    const value = image(inside(root, relative));
    const text = decode(value.data);
    if (secret.test(text)) throw new Error(`Possible credential format in ${relative}; value withheld`);
    if (machine.test(text)) throw new Error(`Machine-specific path in ${relative}`);
    files.set(relative, value);
  }
  let references = 0;
  for (const name of SKILLS) {
    const text = decode(files.get(`payload/skills/${name}/SKILL.md`).data);
    if (!text.startsWith(`---\nname: ${name}\ndescription: `) || !/^description: .+$/m.test(text) || !/\n---\n/.test(text)) {
      throw new Error(`Invalid skill frontmatter: ${name}`);
    }
  }
  for (const [relative, value] of files) {
    if (!relative.startsWith('payload/') || !relative.endsWith('.md')) continue;
    for (const [, link] of decode(value.data).matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
      if (/^(?:https?:|#)/.test(link)) continue;
      const resolved = path.resolve(root, path.dirname(relative), link.split('#')[0]);
      const local = path.relative(root, resolved).split(path.sep).join('/');
      if (!files.has(local)) throw new Error(`Missing local reference in ${relative}`);
      references++;
    }
  }
  const agent = decode(files.get('payload/agents/runtime-truth-verifier.md').data);
  if (!agent.includes('\ntools: Read, Grep, Glob, Bash\n')) throw new Error('Unexpected agent tools');
  const hook = decode(files.get('payload/hooks/local-habits.mjs').data);
  const routes = [...hook.matchAll(/\['([a-z0-9-]+)', \//g)].map(match => match[1]);
  if (routes.length !== SKILLS.length || SKILLS.some(name => !routes.includes(name))) throw new Error('Route inventory mismatch');
  const pkg = JSON.parse(decode(files.get('package.json').data));
  if (pkg.private !== true || pkg.dependencies || pkg.devDependencies || pkg.scripts?.postinstall) {
    throw new Error('Unexpected package dependencies or publish/install settings');
  }
  const generated = buildAssetManifests(root, files);
  const expectedManifests = {
    'catalog.json': generated.catalog,
    'skills-manifest.json': generated.skillsManifest,
  };
  for (const [relative, expected] of Object.entries(expectedManifests)) {
    let actual;
    try { actual = JSON.parse(decode(files.get(relative).data)); }
    catch { throw new Error(`Invalid generated manifest: ${relative}`); }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Stale asset manifest: ${relative}`);
  }
  return { files, summary: { packageFiles: names.length, skills: SKILLS.length, skillMarkdownFiles: 23, localReferences: references } };
}
