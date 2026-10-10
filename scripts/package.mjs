import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await mkdir('release', { recursive: true });
execFileSync('/usr/bin/zip', ['-r', '-q', '../release/chatgpt-native-longshot-0.1.0.zip', '.'], { cwd: 'dist' });
console.log('release/chatgpt-native-longshot-0.1.0.zip');
