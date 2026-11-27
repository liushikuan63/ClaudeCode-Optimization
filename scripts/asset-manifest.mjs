import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_MANIFEST_FILES, buildAssetManifests, digest } from './kit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
if (!['--write', '--check'].includes(mode) || process.argv.length !== 3) {
  process.stderr.write('Usage: node scripts/asset-manifest.mjs --write|--check\n');
  process.exit(2);
}

try {
  const manifests = buildAssetManifests(root);
  const outputs = [manifests.catalog, manifests.skillsManifest];
  for (let index = 0; index < ASSET_MANIFEST_FILES.length; index += 1) {
    const relative = ASSET_MANIFEST_FILES[index];
    const expected = Buffer.from(`${JSON.stringify(outputs[index], null, 2)}\n`, 'utf8');
    const target = path.join(root, relative);
    if (mode === '--write') fs.writeFileSync(target, expected);
    else {
      const actual = fs.readFileSync(target);
      if (!actual.equals(expected)) throw new Error(`Stale asset manifest: ${relative}`);
    }
  }
  const fingerprints = Object.fromEntries(ASSET_MANIFEST_FILES.map(name => [name, digest(fs.readFileSync(path.join(root, name)))]));
  process.stdout.write(`${JSON.stringify({ mode, files: ASSET_MANIFEST_FILES.length, fingerprints }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
  process.exitCode = 1;
}
