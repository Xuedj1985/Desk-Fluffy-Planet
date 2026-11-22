// set-meta.js —— 给正式版 exe 写版本信息（rcedit 不吃中文路径，先复制到临时目录）
const rcedit = require('rcedit');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'release', '糖绒星球 1.0.0');
const EXE = path.join(DIR, '糖绒星球.exe');
const ICON = path.join(ROOT, 'planet', 'assets', 'planet.ico');

(async () => {
  const tmpExe = path.join(os.tmpdir(), 'xome_planet_meta.exe');
  const tmpIcon = path.join(os.tmpdir(), 'xome_planet_icon.ico');
  fs.copyFileSync(EXE, tmpExe);
  fs.copyFileSync(ICON, tmpIcon);
  await rcedit(tmpExe, {
    icon: tmpIcon,
    'file-version': '1.0.0',
    'product-version': '1.0.0',
    'version-string': {
      CompanyName: '糖绒星球',
      FileDescription: '糖绒星球 · Windows 桌面层主题',
      ProductName: '糖绒星球',
      LegalCopyright: '© 2026 糖绒星球',
      OriginalFilename: '糖绒星球.exe',
      InternalName: '糖绒星球',
      FileVersion: '1.0.0',
      ProductVersion: '1.0.0',
    },
  });
  fs.copyFileSync(tmpExe, EXE);
  fs.rmSync(tmpExe, { force: true });
  console.log('元数据写入完成');
})().catch(e => { console.error(e); process.exit(1); });
