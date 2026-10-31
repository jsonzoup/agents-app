import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
const home = process.env.DRAFT_STUDIO_HOME?.trim() || path.join(homedir(), 'xhs-home');
const venv = path.join(home, 'runtime', 'manimgl');
const python = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
for (const args of [
  ['venv', '--allow-existing', '--python', '3.12', venv],
  ['pip', 'install', '--python', python, 'manimgl==1.7.2', 'setuptools<81'],
]) {
  const result = spawnSync('uv', args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) { console.error('视频环境准备失败。请先安装 uv、FFmpeg 与系统中文字体。'); process.exit(1); }
}
console.log(`ManimGL 环境已安装到 ${venv}。视频仍需系统提供 FFmpeg、OpenGL 和中文字体。`);
