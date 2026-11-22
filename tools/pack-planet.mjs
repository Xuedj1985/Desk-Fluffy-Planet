// pack-planet.mjs —— 把糖绒星球打成「复制即用」的正式软件包
//
// 产物：
//   release/糖绒星球 <版本>/                绿色免安装文件夹（双击 糖绒星球.exe）
//   release/糖绒星球-<版本>-win64.zip        可直接发给用户的压缩包
//
// 为什么不再用 electron-packager：
//   本机 packager 在 Node 24 下会卡在 unsettled top-level await（退出码 13），
//   而它的工作本质上就是「复制 electron/dist + 放入 resources/app + 改 exe 名」。
//   这里直接做这三步，完全离线、结果可复现，也顺便去掉 default_app.asar 与多余语言包。
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const rcedit = require('rcedit');

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'release');
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version || '1.0.0';
const FINAL_NAME = '糖绒星球';
const FINAL_DIR_NAME = `${FINAL_NAME} ${VERSION}`;
const COPYRIGHT = '© 2026 糖绒星球';

function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }

function cp(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const robocopy = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'Robocopy.exe');
  try {
    // robocopy 输出是 GBK，吞掉避免解码报错
    execFileSync(robocopy, [from, to, '/E', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/NP'],
      { stdio: 'ignore' });
  } catch (e) {
    if (typeof e.status === 'number' && e.status >= 8) {
      throw new Error(`robocopy 失败 ${from} → ${to} (code ${e.status})`);
    }
  }
}

function dirSize(dir) {
  let total = 0;
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { total += fs.statSync(p).size; } catch (err) {} }
    }
  };
  walk(dir);
  return total;
}
const fmtSize = n => n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(2) + ' GB'
  : n >= 1024 ** 2 ? (n / 1024 ** 2).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';

async function main() {
  if (!fs.existsSync(path.join(ELECTRON_DIST, 'electron.exe'))) {
    throw new Error('找不到 node_modules/electron/dist，请先 npm install');
  }

  const finalDir = path.join(OUT, FINAL_DIR_NAME);
  const exe = path.join(finalDir, `${FINAL_NAME}.exe`);
  const zip = path.join(OUT, `${FINAL_NAME}-${VERSION}-win64.zip`);

  console.log('1/6 清理');
  rm(finalDir);
  rm(zip);

  console.log('2/6 复制 Electron 运行时');
  cp(ELECTRON_DIST, finalDir);
  rm(path.join(finalDir, 'debug.log'));
  fs.renameSync(path.join(finalDir, 'electron.exe'), exe);

  console.log('3/6 裁语言包');
  const loc = path.join(finalDir, 'locales');
  rm(loc);
  fs.mkdirSync(loc, { recursive: true });
  const zh = path.join(ELECTRON_DIST, 'locales', 'zh-CN.pak');
  if (fs.existsSync(zh)) fs.copyFileSync(zh, path.join(loc, 'zh-CN.pak'));

  console.log('4/6 放入应用代码');
  const appDir = path.join(finalDir, 'resources', 'app');
  rm(path.join(finalDir, 'resources', 'default_app.asar'));
  fs.mkdirSync(appDir, { recursive: true });
  cp(path.join(ROOT, 'planet'), path.join(appDir, 'planet'));
  for (const junk of ['logs', 'test-model.js']) rm(path.join(appDir, 'planet', junk));
  fs.mkdirSync(path.join(appDir, 'room'), { recursive: true });
  for (const f of ['store.js', 'player-state.js', 'win32.js']) {
    fs.copyFileSync(path.join(ROOT, 'room', f), path.join(appDir, 'room', f));
  }
  fs.mkdirSync(path.join(appDir, 'node_modules', '@koromix'), { recursive: true });
  cp(path.join(ROOT, 'node_modules', 'koffi'), path.join(appDir, 'node_modules', 'koffi'));
  cp(path.join(ROOT, 'node_modules', '@koromix', 'koffi-win32-x64'),
    path.join(appDir, 'node_modules', '@koromix', 'koffi-win32-x64'));

  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
    name: 'xome-planet',
    version: VERSION,
    private: true,
    description: '糖绒星球 · Windows 桌面层主题',
    author: '糖绒星球',
    license: 'UNLICENSED',
    main: 'planet/main.js',
    productName: FINAL_NAME,
    dependencies: { koffi: pkg.dependencies.koffi },
  }, null, 2), 'utf8');

  console.log('5/6 写 exe 版本信息');
  // rcedit 不吃中文路径：先复制到 %TEMP% 改完再拷回
  const tmpExe = path.join(os.tmpdir(), 'xome_planet_meta.exe');
  const tmpIcon = path.join(os.tmpdir(), 'xome_planet_icon.ico');
  fs.copyFileSync(exe, tmpExe);
  fs.copyFileSync(path.join(ROOT, 'planet', 'assets', 'planet.ico'), tmpIcon);
  await rcedit(tmpExe, {
    icon: tmpIcon,
    'file-version': VERSION,
    'product-version': VERSION,
    'version-string': {
      CompanyName: FINAL_NAME,
      FileDescription: '糖绒星球 · Windows 桌面层主题',
      ProductName: FINAL_NAME,
      LegalCopyright: COPYRIGHT,
      OriginalFilename: `${FINAL_NAME}.exe`,
      InternalName: FINAL_NAME,
      FileVersion: VERSION,
      ProductVersion: VERSION,
    },
  });
  fs.copyFileSync(tmpExe, exe);
  rm(tmpExe);

  console.log('6/6 放入交付物并压缩');
  for (const [src, dst] of [
    [path.join(ROOT, 'tools', '使用说明-糖绒星球.txt'), '使用说明.txt'],
    [path.join(ROOT, '退出糖绒星球.bat'), '退出.bat'],
    [path.join(ROOT, 'tools', '创建桌面快捷方式.bat'), '创建桌面快捷方式.bat'],
    [path.join(ROOT, 'tools', '创建桌面快捷方式.ps1'), '创建桌面快捷方式.ps1'],
  ]) {
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(finalDir, dst));
  }
  fs.writeFileSync(path.join(finalDir, '版本信息.txt'),
    `${FINAL_NAME} ${VERSION}\n` +
    `构建时间：${new Date().toLocaleString('zh-CN')}\n` +
    `平台：Windows 10 / 11 x64（免安装绿色版）\n` +
    `入口：${FINAL_NAME}.exe\n` +
    `数据目录：%APPDATA%\\xome-planet\\（每台电脑各自独立）\n` +
    `桌面书架：桌面\\糖绒星球书架\\（退出 App 自动解散回桌面）\n` +
    '第三方组件：Electron / Chromium / koffi（MIT），完整许可见 LICENSE 与 LICENSES.chromium.html\n',
    'utf8');

  try {
    const ps = 'Compress-Archive -LiteralPath ' + JSON.stringify(finalDir) +
      ' -DestinationPath ' + JSON.stringify(zip) + ' -CompressionLevel Optimal -Force';
    execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
  } catch (e) {
    console.warn('压缩失败（文件夹版仍可用）：' + e.message);
  }

  console.log(`\n完成：${finalDir}  (${fmtSize(dirSize(finalDir))})`);
  console.log(`exe：${exe}`);
  if (fs.existsSync(zip)) console.log(`压缩包：${zip}  (${fmtSize(fs.statSync(zip).size)})`);
}

main().catch(e => { console.error(e); process.exit(1); });
