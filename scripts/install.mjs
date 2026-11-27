import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { KIT_ROOT, MAX_FILE_BYTES, PAYLOAD_FILES, assertImage, assertNoLinks, decode, digest, image, inside, isObject, validateKit } from './kit.mjs';

const BEGIN = '<!-- cc-workflow-kit:begin -->';
const END = '<!-- cc-workflow-kit:end -->';
const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

function settingsFrom(before) {
  let settings;
  try { settings = before ? JSON.parse(decode(before.data).replace(/^﻿/, '')) : {}; }
  catch { throw new Error('Invalid settings.json: expected UTF-8 JSON'); }
  if (!isObject(settings)) throw new Error('Invalid settings.json: expected an object');
  if (settings.hooks !== undefined) {
    if (!isObject(settings.hooks)) throw new Error('Invalid settings.json: hooks must be an object');
    for (const groups of Object.values(settings.hooks)) {
      if (!Array.isArray(groups)) throw new Error('Invalid settings.json: hook events must contain arrays');
      for (const group of groups) {
        if (!isObject(group) || !Array.isArray(group.hooks) || (group.matcher !== undefined && typeof group.matcher !== 'string')) {
          throw new Error('Invalid settings.json: invalid hook group');
        }
        for (const hook of group.hooks) {
          if (!isObject(hook) || typeof hook.type !== 'string' || !hook.type) throw new Error('Invalid settings.json: invalid hook entry');
          if (hook.type === 'command' && (typeof hook.command !== 'string' || !hook.command.trim())) {
            throw new Error('Invalid settings.json: command must name a command');
          }
          if (hook.args !== undefined && (!Array.isArray(hook.args) || hook.args.some(arg => typeof arg !== 'string'))) {
            throw new Error('Invalid settings.json: args must be strings');
          }
          if (hook.timeout !== undefined && (typeof hook.timeout !== 'number' || !Number.isFinite(hook.timeout) || hook.timeout <= 0)) {
            throw new Error('Invalid settings.json: timeout must be positive');
          }
        }
      }
    }
  }
  return settings;
}

function mergeHook(settings, root) {
  const next = structuredClone(settings);
  next.hooks ??= {};
  next.hooks.UserPromptSubmit ??= [];
  const script = inside(root, 'hooks/local-habits.mjs');
  const matches = [];
  for (const group of next.hooks.UserPromptSubmit) {
    for (let index = 0; index < group.hooks.length; index++) {
      const hook = group.hooks[index];
      if (hook.type === 'command' && hook.args?.length === 1 && path.isAbsolute(hook.args[0]) && normalize(hook.args[0]) === normalize(script)) {
        matches.push({ group, index });
      }
    }
  }
  if (matches.length > 1) throw new Error('Duplicate kit hook entries; resolve them before installation');
  const desired = { type: 'command', command: process.execPath, args: [script], timeout: 3 };
  if (matches.length) {
    const { group, index } = matches[0];
    group.hooks[index] = { ...group.hooks[index], ...desired };
  } else {
    next.hooks.UserPromptSubmit.push({ hooks: [desired] });
  }
  return next;
}

function mergeRules(before, template, replace) {
  const previous = before ? decode(before.data) : '';
  const newline = previous.includes('\r\n') ? '\r\n' : '\n';
  const block = [BEGIN, decode(template).trim().replace(/\r?\n/g, newline), END].join(newline);
  const starts = previous.split(BEGIN).length - 1;
  const ends = previous.split(END).length - 1;
  if (!starts && !ends) return Buffer.from(`${previous}${previous ? (previous.endsWith('\n') ? newline : newline + newline) : ''}${block}${newline}`);
  const start = previous.indexOf(BEGIN);
  const end = previous.indexOf(END);
  if (starts !== 1 || ends !== 1 || end < start) throw new Error('Ambiguous kit rule markers in CLAUDE.md');
  const finish = end + END.length;
  if (previous.slice(start, finish) === block) return before.data;
  if (!replace) throw new Error('Kit rule block differs; review it before using --replace');
  return Buffer.from(previous.slice(0, start) + block + previous.slice(finish));
}

export function planInstall({ configDir, withRules = false, replace = false, kitRoot = KIT_ROOT } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required');
  const root = path.resolve(configDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
  const sourceRoot = path.resolve(kitRoot);
  const withinPackage = path.relative(sourceRoot, root);
  if (!withinPackage || (!withinPackage.startsWith(`..${path.sep}`) && withinPackage !== '..' && !path.isAbsolute(withinPackage))) {
    throw new Error('Configuration target must be outside the share package');
  }
  assertNoLinks(root);
  if (fs.existsSync(root) && !fs.statSync(root).isDirectory()) throw new Error('Configuration root is not a directory');
  const { files } = validateKit(sourceRoot);
  const entries = [];
  for (const relative of PAYLOAD_FILES) {
    const target = inside(root, relative);
    const before = image(target);
    const data = files.get(`payload/${relative}`).data;
    if (before && !before.data.equals(data) && !replace) throw new Error(`File conflict; no writes performed: ${relative}`);
    entries.push({ relative, target, before, data });
  }
  if (withRules) {
    const target = inside(root, 'CLAUDE.md');
    const before = image(target);
    entries.push({ relative: 'CLAUDE.md', target, before, data: mergeRules(before, files.get('rules/CLAUDE.md').data, replace) });
  }
  const target = inside(root, 'settings.json');
  const before = image(target);
  const settings = settingsFrom(before);
  const next = mergeHook(settings, root);
  const data = before && JSON.stringify(settings) === JSON.stringify(next)
    ? before.data : Buffer.from(JSON.stringify(next, null, 2) + '\n');
  entries.push({ relative: 'settings.json', target, before, data });
  for (const entry of entries) {
    if (entry.data.length > MAX_FILE_BYTES) throw new Error(`Generated file exceeds 8 MiB safety limit: ${entry.relative}`);
  }
  const warnings = [];
  if (settings.disableAllHooks === true) warnings.push('Existing disableAllHooks=true is preserved; the hook will remain disabled');
  if (settings.allowManagedHooksOnly === true) warnings.push('Existing managed-hook policy is preserved; this user hook may not run');
  const changes = entries.filter(entry => !entry.before?.data.equals(entry.data));
  if (changes.some(entry => entry.before)) assertNoLinks(inside(root, 'backups'));
  return { root, entries, changes, warnings };
}

export function describePlan(plan) {
  return {
    configDir: plan.root,
    changes: plan.changes.map(entry => ({ path: entry.relative, action: entry.before ? 'update-with-backup' : 'create' })),
    unchanged: plan.entries.length - plan.changes.length,
    warnings: plan.warnings,
  };
}

function ensureDirectory(directory) {
  assertNoLinks(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertNoLinks(directory);
}

function atomicReplace(entry) {
  const stage = path.join(path.dirname(entry.target), `.cc-workflow-kit-${randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(stage, 'wx', entry.before.mode);
    fs.writeFileSync(fd, entry.data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    assertImage(entry.target, entry.before);
    fs.renameSync(stage, entry.target);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try {
      const staged = image(stage);
      if (staged?.data.equals(entry.data)) fs.unlinkSync(stage);
    } catch {}
  }
}

export function applyInstall(plan) {
  const report = { ...describePlan(plan), applied: false, written: [], backupDir: null, attempted: null };
  try {
    for (const entry of plan.entries) assertImage(entry.target, entry.before);
    if (!plan.changes.length) return { ...report, applied: true };
    const originals = plan.changes.filter(entry => entry.before);
    if (originals.length) {
      report.backupDir = inside(plan.root, `backups/cc-workflow-kit-${Date.now()}-${randomUUID()}`);
      ensureDirectory(report.backupDir);
      for (const entry of originals) {
        assertImage(entry.target, entry.before);
        const backup = inside(report.backupDir, entry.relative);
        ensureDirectory(path.dirname(backup));
        fs.writeFileSync(backup, entry.before.data, { flag: 'wx', mode: 0o600 });
        if (image(backup).sha256 !== entry.before.sha256) throw new Error(`Backup verification failed: ${entry.relative}`);
      }
    }
    for (const entry of plan.changes) {
      report.attempted = entry.relative;
      assertImage(entry.target, entry.before);
      ensureDirectory(path.dirname(entry.target));
      assertImage(entry.target, entry.before);
      if (entry.before) atomicReplace(entry);
      else fs.writeFileSync(entry.target, entry.data, { flag: 'wx', mode: 0o600 });
      report.written.push(entry.relative);
      if (image(entry.target).sha256 !== digest(entry.data)) throw new Error(`Written file verification failed: ${entry.relative}`);
    }
    return { ...report, applied: true, attempted: null };
  } catch (error) {
    error.installReport = report;
    throw error;
  }
}

function main() {
  try {
    const { values } = parseArgs({ options: {
      apply: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      replace: { type: 'boolean', default: false },
      'with-rules': { type: 'boolean', default: false },
      'config-dir': { type: 'string' },
      help: { type: 'boolean', default: false },
    } });
    if (values.help) {
      process.stdout.write('node scripts/install.mjs [--config-dir PATH] [--with-rules] [--replace] [--apply | --dry-run]\nDefault: read-only preview. --replace backs up conflicting files before replacement.\n');
      return;
    }
    if (values.apply && values['dry-run']) throw new Error('Choose --apply or --dry-run, not both');
    if (values['config-dir'] === '') throw new Error('--config-dir must not be empty');
    const plan = planInstall({ configDir: values['config-dir'], withRules: values['with-rules'], replace: values.replace });
    const report = values.apply ? applyInstall(plan) : { ...describePlan(plan), applied: false };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: error.message, code: error.code, ...error.installReport }, null, 2) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
