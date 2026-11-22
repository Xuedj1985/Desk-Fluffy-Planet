// pack-source.mjs —— 生成可公开发布的开源源码包（只含糖绒星球相关文件）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'release');
const NAME = '糖绒星球-1.0.0-源码';
const DIR = path.join(OUT, NAME);
const ZIP = path.join(OUT, NAME + '.zip');

function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }
function cp(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, filter: s => !/[/\\](logs?|node_modules|release|build)$/.test(s) });
}
function copyFile(rel, dst = rel) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) return;
  const to = path.join(DIR, dst);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(src, to);
}

rm(DIR);
rm(ZIP);
fs.mkdirSync(DIR, { recursive: true });

for (const f of ['README.md', 'LICENSE', '.gitignore', 'package.json', 'package-lock.json',
  '启动糖绒星球.bat', '打包糖绒星球.bat', '退出糖绒星球.bat']) copyFile(f);

cp(path.join(ROOT, 'planet'), path.join(DIR, 'planet'));

for (const f of ['store.js', 'player-state.js', 'win32.js', 'test-store.js', 'test-player-state.js']) {
  copyFile(path.join('room', f), path.join('room', f));
}
for (const f of ['pack-planet.mjs', 'gen-planet-icon.mjs', '使用说明-糖绒星球.txt',
  '创建桌面快捷方式.bat', '创建桌面快捷方式.ps1']) {
  copyFile(path.join('tools', f), path.join('tools', f));
}
for (const f of ['verify-planet.mjs', 'smoke-planet-packaged.mjs', 'test-shelf-virtual.js']) {
  copyFile(path.join('verify', f), path.join('verify', f));
}
// 只带糖绒星球的界面截图
for (const f of fs.readdirSync(path.join(ROOT, 'docs'))) {
  if (/^planet-.*\.png$/i.test(f)) copyFile(path.join('docs', f), path.join('docs', f));
}

try {
  const ps = 'Compress-Archive -LiteralPath ' + JSON.stringify(DIR) +
    ' -DestinationPath ' + JSON.stringify(ZIP) + ' -CompressionLevel Optimal -Force';
  execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
  console.log('源码包：' + ZIP);
} catch (e) {
  console.warn('压缩失败（文件夹版可用）：' + e.message);
}
console.log('源码目录：' + DIR);
