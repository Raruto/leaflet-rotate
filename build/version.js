import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const newVersion = process.env.npm_new_version;
if (!newVersion) {
  throw new Error('npm_new_version is not set; run this script through npm version');
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error('npm_execpath is not set; run this script through npm version');
}

function npm(command) {
  const result = spawnSync(process.execPath, [npmCli, command], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`npm ${command} terminated by ${result.signal}`);
  return result.status;
}

if (npm('whoami') !== 0) {
  if (npm('login') !== 0) throw new Error('npm login failed');
  if (npm('whoami') !== 0) throw new Error('npm authentication check failed after login');
}

const { name } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const root = fileURLToPath(new URL('../', import.meta.url));
const packageReference = new RegExp(`${name}@[0-9][0-9A-Za-z.+-]*`, 'g');
const grepPattern = `${name}@[0-9][0-9A-Za-z.+-]*`;
const search = spawnSync('git', ['grep', '-IlzE', grepPattern], { cwd: root, encoding: 'utf8' });

if (search.error) throw search.error;
if (search.status === 1) throw new Error(`No versioned ${name} references found`);
if (search.status !== 0) throw new Error(`git grep failed: ${search.stderr.trim()}`);

const changedFiles = [];
for (const path of search.stdout.split('\0').filter(Boolean)) {
  const filePath = resolve(root, path);
  const contents = await readFile(filePath, 'utf8');
  const updated = contents.replace(packageReference, `${name}@${newVersion}`);
  if (updated !== contents) {
    await writeFile(filePath, updated);
    changedFiles.push(path);
  }
}

if (changedFiles.length) {
  const stage = spawnSync('git', ['add', '--', ...changedFiles], { cwd: root, stdio: 'inherit' });
  if (stage.error) throw stage.error;
  if (stage.status !== 0) throw new Error('Could not stage version reference updates');
}
