import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, validateKit } from './kit.mjs';

export function validate() {
  const { files, summary } = validateKit();
  const content = [...files].map(([name, value]) => `${name}\0${value.sha256}\n`).join('');
  return { ...summary, packageContentSha256: digest(content) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(validate(), null, 2) + '\n'); }
  catch (error) {
    process.stderr.write(JSON.stringify({ error: error.message }) + '\n');
    process.exitCode = 1;
  }
}
