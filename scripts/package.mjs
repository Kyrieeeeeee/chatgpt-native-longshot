import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await mkdir('release', { recursive: true });
const { version } = JSON.parse(await readFile('manifest.json', 'utf8'));
const filename = `chatgpt-native-longshot-${version}.zip`;
execFileSync('/usr/bin/zip', ['-r', '-q', `../release/${filename}`, '.'], { cwd: 'dist' });
console.log(`release/${filename}`);
