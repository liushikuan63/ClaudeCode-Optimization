import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { applyInstall, planInstall } from '../scripts/install.mjs';
import { KIT_ROOT, PACKAGE_FILES, PAYLOAD_FILES, assertNoLinks, digest, inside, validateKit } from '../scripts/kit.mjs';

const cli = path.join(KIT_ROOT, 'scripts/install.mjs');
function fixture(t) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cc-workflow-kit-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, root: path.join(base, "配置 root $ & ' [test]") };
}
function seed(root, name, value) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
  return file;
}
function snapshot(root) {
  if (!fs.existsSync(root)) return null;
  const result = [];
  const scan = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${prefix}${entry.name}`;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) result.push([name, 'link', fs.readlinkSync(full)]);
      else if (entry.isDirectory()) { result.push([name, 'directory']); scan(full, `${name}/`); }
      else result.push([name, digest(fs.readFileSync(full))]);
    }
  };
  scan(root);
  return result;
}
const existing = () => ({
  enableWorkflows: true, outputStyle: 'ExistingStyle', model: 'existing-model',
  permissions: { deny: ['Bash(private-task)'] }, mcpServers: { existing: { command: 'existing-tool' } },
  hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: 'existing-recovery', timeout: 15 }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'existing-prompt-hook', args: ['--existing'] }] }],
  },
});
const installedSettings = root => JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
const configuredHook = root => installedSettings(root).hooks.UserPromptSubmit.flatMap(group => group.hooks)
  .find(hook => hook.args?.[0] === path.join(root, 'hooks/local-habits.mjs'));

function copyKit(target) {
  for (const name of PACKAGE_FILES) {
    const to = path.join(target, name);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(KIT_ROOT, name), to);
  }
}

test('package allowlist, frontmatter, routes and all four local references validate', () => {
  assert.deepEqual(validateKit().summary, { packageFiles: 33, skills: 18, skillMarkdownFiles: 21, localReferences: 4 });
});

test('preview performs zero writes, including for a missing configuration root', t => {
  const { root } = fixture(t);
  const plan = planInstall({ configDir: root });
  assert.equal(plan.changes.length, PAYLOAD_FILES.length + 1);
  assert.equal(fs.existsSync(root), false);
  const output = JSON.parse(execFileSync(process.execPath, [cli, '--config-dir', root], { encoding: 'utf8', windowsHide: true }));
  assert.equal(output.applied, false);
  assert.equal(fs.existsSync(root), false);
});

test('fresh install runs the exact generated argv in a Chinese, spaced, shell-special path', t => {
  const { root } = fixture(t);
  const report = applyInstall(planInstall({ configDir: root }));
  assert.equal(report.applied, true);
  assert.equal(report.backupDir, null);
  assert.equal(report.written.length, PAYLOAD_FILES.length + 1);
  assert.equal(fs.existsSync(path.join(root, 'CLAUDE.md')), false);
  assert.equal(fs.existsSync(path.join(root, 'hooks/local-habits.test.mjs')), false);
  for (const name of PAYLOAD_FILES) assert.ok(fs.readFileSync(path.join(root, name)).equals(fs.readFileSync(path.join(KIT_ROOT, 'payload', name))));
  const hook = configuredHook(root);
  assert.equal(hook.command, process.execPath);
  assert.equal(hook.timeout, 3);
  const output = execFileSync(hook.command, hook.args, {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'API 幂等核验 PRIVATE_SENTINEL' }),
    encoding: 'utf8', timeout: 3000, windowsHide: true,
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes(path.join(root, 'skills/api-contracts/SKILL.md').replaceAll('\\', '/')));
  assert.doesNotMatch(output, /PRIVATE_SENTINEL|~\/\.claude/);
  for (const input of ['invalid JSON', JSON.stringify({ hook_event_name: 'Stop', prompt: 'API' })]) {
    assert.equal(execFileSync(hook.command, hook.args, { input, encoding: 'utf8', windowsHide: true }), '');
  }
});

test('CLAUDE_CONFIG_DIR is honored without applying changes', t => {
  const { root } = fixture(t);
  const output = execFileSync(process.execPath, [cli, '--dry-run'], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, CLAUDE_CONFIG_DIR: root },
  });
  assert.equal(JSON.parse(output).configDir, root);
  assert.equal(fs.existsSync(root), false);
});

test('existing settings and hooks survive; reinstall is byte-for-byte idempotent', t => {
  const { root } = fixture(t);
  const original = existing();
  seed(root, 'settings.json', original);
  const report = applyInstall(planInstall({ configDir: root }));
  assert.ok(report.backupDir);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(report.backupDir, 'settings.json'), 'utf8')), original);
  const next = installedSettings(root);
  const { UserPromptSubmit, ...otherHooks } = next.hooks;
  assert.deepEqual(otherHooks, { SessionStart: original.hooks.SessionStart });
  assert.deepEqual(UserPromptSubmit[0], original.hooks.UserPromptSubmit[0]);
  const { hooks, ...otherSettings } = next;
  const { hooks: originalHooks, ...expectedSettings } = original;
  assert.deepEqual(otherSettings, expectedSettings);
  const before = snapshot(root);
  const second = applyInstall(planInstall({ configDir: root }));
  assert.equal(second.changes.length, 0);
  assert.equal(second.backupDir, null);
  assert.deepEqual(snapshot(root), before);
});

test('a late conflicting payload file prevents every write', t => {
  const { root } = fixture(t);
  seed(root, 'hooks/local-habits.mjs', 'existing user file\n');
  seed(root, 'settings.json', existing());
  const before = snapshot(root);
  assert.throws(() => planInstall({ configDir: root }), /File conflict/);
  assert.deepEqual(snapshot(root), before);
});

test('invalid JSON, encoding and hook field shapes all fail with zero writes', t => {
  const { base } = fixture(t);
  const invalid = [
    '{broken PRIVATE_SENTINEL', 'null', '[]', '{"hooks":[]}', '{"hooks":{"Stop":{}}}',
    '{"hooks":{"Stop":[{"hooks":{}}]}}',
    '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"valid","args":"wrong"}]}]}}',
    '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"valid","timeout":0}]}]}}',
    Buffer.from([0xff, 0xfe]),
  ];
  invalid.forEach((data, index) => {
    const root = path.join(base, String(index));
    seed(root, 'settings.json', data);
    const before = snapshot(root);
    assert.throws(() => planInstall({ configDir: root }), error => /Invalid settings/.test(error.message) && !error.message.includes('PRIVATE_SENTINEL'));
    assert.deepEqual(snapshot(root), before);
  });
});

test('explicit replacement verifies recoverable original bytes before overwriting', t => {
  const { root } = fixture(t);
  const priorHook = Buffer.from('existing hook\n');
  seed(root, 'hooks/local-habits.mjs', priorHook);
  seed(root, 'settings.json', existing());
  const originalSettings = fs.readFileSync(path.join(root, 'settings.json'));
  const report = applyInstall(planInstall({ configDir: root, replace: true }));
  assert.ok(fs.readFileSync(path.join(report.backupDir, 'hooks/local-habits.mjs')).equals(priorHook));
  assert.ok(fs.readFileSync(path.join(report.backupDir, 'settings.json')).equals(originalSettings));
});

test('rules are optional, preserve existing CRLF content and merge only once', t => {
  const { root } = fixture(t);
  const prior = '# My existing rules\r\nKeep this content.\r\n';
  seed(root, 'CLAUDE.md', prior);
  applyInstall(planInstall({ configDir: root }));
  assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), prior);
  const report = applyInstall(planInstall({ configDir: root, withRules: true }));
  const merged = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  assert.ok(merged.startsWith(prior));
  assert.equal(merged.split('<!-- cc-workflow-kit:begin -->').length - 1, 1);
  assert.equal(merged.replaceAll('\r\n', '').includes('\n'), false);
  assert.equal(fs.readFileSync(path.join(report.backupDir, 'CLAUDE.md'), 'utf8'), prior);
  const before = snapshot(root);
  assert.equal(applyInstall(planInstall({ configDir: root, withRules: true })).changes.length, 0);
  assert.deepEqual(snapshot(root), before);
  fs.appendFileSync(path.join(root, 'CLAUDE.md'), '<!-- cc-workflow-kit:end -->');
  assert.throws(() => planInstall({ configDir: root, withRules: true, replace: true }), /Ambiguous kit rule markers/);
});

test('editing the managed rule block requires explicit replacement', t => {
  const { root } = fixture(t);
  applyInstall(planInstall({ configDir: root, withRules: true }));
  const rules = path.join(root, 'CLAUDE.md');
  fs.writeFileSync(rules, fs.readFileSync(rules, 'utf8').replace('可选协作习惯模板', 'My edited block'));
  const before = snapshot(root);
  assert.throws(() => planInstall({ configDir: root, withRules: true }), /rule block differs/);
  assert.deepEqual(snapshot(root), before);
});

test('linked roots, ancestors and payload parents cannot redirect installation', t => {
  const { base, root } = fixture(t);
  const outside = path.join(base, 'outside');
  seed(outside, 'sentinel.txt', 'keep');
  const before = snapshot(outside);
  const link = path.join(base, 'redirect');
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => planInstall({ configDir: link }), /Linked path/);
  assert.throws(() => planInstall({ configDir: path.join(link, 'new-root') }), /Linked path/);
  fs.mkdirSync(root);
  fs.symlinkSync(outside, path.join(root, 'hooks'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => planInstall({ configDir: root }), /Linked path/);
  assert.deepEqual(snapshot(outside), before);
});

test('hard-linked files and path traversal are refused', t => {
  const { base, root } = fixture(t);
  const outside = seed(base, 'original.mjs', 'do not replace');
  fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
  fs.linkSync(outside, path.join(root, 'hooks/local-habits.mjs'));
  assert.throws(() => planInstall({ configDir: root, replace: true }), /regular file/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'do not replace');
  for (const relative of ['../escape', 'safe/../../escape', 'safe//file', path.parse(base).root + 'absolute']) {
    assert.throws(() => inside(root, relative), /Unsafe relative path|Path escapes root/);
  }
});

test('concurrent changes after preview are detected before any installation writes', t => {
  const { root } = fixture(t);
  seed(root, 'settings.json', existing());
  const plan = planInstall({ configDir: root });
  seed(root, 'settings.json', { changedByUser: true });
  const before = snapshot(root);
  assert.throws(() => applyInstall(plan), /Concurrent change detected/);
  assert.deepEqual(snapshot(root), before);
});

test('same-byte replacement is still detected by file identity', t => {
  const { root } = fixture(t);
  const file = seed(root, 'settings.json', existing());
  const plan = planInstall({ configDir: root });
  const replacement = seed(root, 'replacement.json', fs.readFileSync(file));
  fs.renameSync(replacement, file);
  const before = snapshot(root);
  assert.throws(() => applyInstall(plan), /Concurrent change detected/);
  assert.deepEqual(snapshot(root), before);
});

test('permission denial retains settings and verified recovery bytes', t => {
  const { root } = fixture(t);
  const file = seed(root, 'settings.json', existing());
  const before = fs.readFileSync(file);
  const plan = planInstall({ configDir: root });
  const firstTarget = plan.changes[0].target;
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', function (target, ...args) {
    if (target === firstTarget) throw Object.assign(new Error('simulated permission denial'), { code: 'EACCES' });
    return write.call(this, target, ...args);
  });
  assert.throws(() => applyInstall(plan), error => {
    assert.equal(error.code, 'EACCES');
    assert.deepEqual(error.installReport.written, []);
    assert.ok(fs.readFileSync(path.join(error.installReport.backupDir, 'settings.json')).equals(before));
    return true;
  });
  assert.ok(fs.readFileSync(file).equals(before));
});

test('interruption before atomic settings replacement reports partial files and preserves recovery', t => {
  const { root } = fixture(t);
  const file = seed(root, 'settings.json', existing());
  const before = fs.readFileSync(file);
  const plan = planInstall({ configDir: root });
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', function (from, to) {
    if (to === file) throw new Error('simulated write interruption');
    return rename.call(this, from, to);
  });
  assert.throws(() => applyInstall(plan), error => {
    assert.match(error.message, /simulated write interruption/);
    assert.equal(error.installReport.written.length, PAYLOAD_FILES.length);
    assert.equal(error.installReport.attempted, 'settings.json');
    assert.ok(fs.readFileSync(path.join(error.installReport.backupDir, 'settings.json')).equals(before));
    return true;
  });
  assert.ok(fs.readFileSync(file).equals(before));
});

test('concurrent settings edit during payload writes is not blindly rolled back or overwritten', t => {
  const { root } = fixture(t);
  const file = seed(root, 'settings.json', existing());
  const before = fs.readFileSync(file);
  const plan = planInstall({ configDir: root });
  const hookFile = path.join(root, 'hooks/local-habits.mjs');
  const concurrent = JSON.stringify({ anotherWriter: 'preserve-me' });
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', function (target, ...args) {
    const result = write.call(this, target, ...args);
    if (target === hookFile) write(file, concurrent);
    return result;
  });
  assert.throws(() => applyInstall(plan), error => {
    assert.match(error.message, /Concurrent change detected/);
    assert.ok(fs.readFileSync(path.join(error.installReport.backupDir, 'settings.json')).equals(before));
    return true;
  });
  assert.equal(fs.readFileSync(file, 'utf8'), concurrent);
});

test('duplicate routing and malformed CLI options fail without writing', t => {
  const { root } = fixture(t);
  const hook = { type: 'command', command: process.execPath, args: [path.join(root, 'hooks/local-habits.mjs')] };
  seed(root, 'settings.json', { hooks: { UserPromptSubmit: [{ hooks: [hook, hook] }] } });
  const before = snapshot(root);
  assert.throws(() => planInstall({ configDir: root }), /Duplicate kit hook/);
  for (const args of [['--unknown'], ['--apply', '--dry-run'], ['--config-dir=']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1);
  }
  assert.deepEqual(snapshot(root), before);
});

test('existing hook disablement is preserved and reported, never silently enabled', t => {
  const { root } = fixture(t);
  seed(root, 'settings.json', { disableAllHooks: true, allowManagedHooksOnly: true });
  const report = applyInstall(planInstall({ configDir: root }));
  assert.equal(report.warnings.length, 2);
  assert.equal(installedSettings(root).disableAllHooks, true);
  assert.equal(installedSettings(root).allowManagedHooksOnly, true);
});

test('reversed, incomplete and duplicate rule markers fail before every write', t => {
  const { base } = fixture(t);
  const begin = '<!-- cc-workflow-kit:begin -->';
  const end = '<!-- cc-workflow-kit:end -->';
  const invalid = [`${end}${begin}`, `${end}\n${begin}`, begin, end, `${begin}${end}${end}`];
  invalid.forEach((markers, index) => {
    const root = path.join(base, `rules-${index}`);
    seed(root, 'CLAUDE.md', `# User rules\n${markers}\n`);
    const before = snapshot(root);
    assert.throws(() => planInstall({ configDir: root, withRules: true, replace: true }), /Ambiguous kit rule markers/);
    const result = spawnSync(process.execPath, [cli, '--config-dir', root, '--with-rules', '--replace', '--apply'], {
      encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stderr).error, /Ambiguous kit rule markers/);
    assert.deepEqual(snapshot(root), before);
  });
});

test('generated settings above the safety limit are refused before backups or payload writes', t => {
  const { root } = fixture(t);
  const limit = 8 * 1024 * 1024;
  const shell = JSON.stringify({ padding: '' });
  const settings = JSON.stringify({ padding: 'x'.repeat(limit - Buffer.byteLength(shell)) });
  assert.equal(Buffer.byteLength(settings), limit);
  seed(root, 'settings.json', settings);
  const before = snapshot(root);
  assert.throws(() => planInstall({ configDir: root }), /Generated file exceeds 8 MiB safety limit: settings\.json/);
  const result = spawnSync(process.execPath, [cli, '--config-dir', root, '--apply'], {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stderr).error, /Generated file exceeds 8 MiB safety limit: settings\.json/);
  assert.deepEqual(snapshot(root), before);
});

test('generated rules above the safety limit are refused before backups or payload writes', t => {
  const { root } = fixture(t);
  seed(root, 'CLAUDE.md', Buffer.alloc(8 * 1024 * 1024, 0x78));
  const before = snapshot(root);
  assert.throws(() => planInstall({ configDir: root, withRules: true, replace: true }), /Generated file exceeds 8 MiB safety limit: CLAUDE\.md/);
  const result = spawnSync(process.execPath, [cli, '--config-dir', root, '--with-rules', '--replace', '--apply'], {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stderr).error, /Generated file exceeds 8 MiB safety limit: CLAUDE\.md/);
  assert.deepEqual(snapshot(root), before);
});

test('generated safety limit includes exactly 8 MiB and remains reinstallable', t => {
  const { root } = fixture(t);
  seed(root, 'settings.json', { padding: '' });
  const initial = planInstall({ configDir: root });
  const overhead = initial.entries.find(entry => entry.relative === 'settings.json').data.length;
  seed(root, 'settings.json', { padding: 'x'.repeat(8 * 1024 * 1024 - overhead) });
  const plan = planInstall({ configDir: root });
  assert.equal(plan.entries.find(entry => entry.relative === 'settings.json').data.length, 8 * 1024 * 1024);
  applyInstall(plan);
  assert.equal(fs.statSync(path.join(root, 'settings.json')).size, 8 * 1024 * 1024);
  assert.equal(planInstall({ configDir: root }).changes.length, 0);
});

test('unexpected package files are rejected, and the package cannot be its own install target', t => {
  const { base } = fixture(t);
  const copy = path.join(base, 'kit-copy');
  copyKit(copy);
  seed(copy, '.env', 'PRIVATE_SENTINEL');
  assert.throws(() => validateKit(copy), error => /allowlist mismatch/.test(error.message) && !error.message.includes('PRIVATE_SENTINEL'));
  assert.throws(() => planInstall({ configDir: path.join(KIT_ROOT, 'nested-config') }), /outside the share package/);
  assertNoLinks(KIT_ROOT);
});
