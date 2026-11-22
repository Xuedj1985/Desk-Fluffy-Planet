/**
 * 打包版冒烟：确认 release/糖绒星球/糖绒星球.exe 能起来、页面能加载、共用模块路径没断。
 * 用沙箱桌面与沙箱数据目录启动，跑完自己退出。
 *
 *   node verify/smoke-planet-packaged.mjs          # 不钉桌面层、不建托盘
 *   node verify/smoke-planet-packaged.mjs --tray   # 真钉桌面层 + 建托盘，检查菜单能构建
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const ROOT = path.resolve(import.meta.dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const EXE = process.env.PLANET_EXE ||
  path.join(ROOT, 'release', `糖绒星球 ${PKG.version || '1.0.0'}`, '糖绒星球.exe');
if (!fs.existsSync(EXE)) {
  console.error('[smoke] 找不到打包版，先跑 node tools/pack-planet.mjs');
  process.exit(2);
}

const PORT = await new Promise((resolve, reject) => {
  const p = net.createServer();
  p.on('error', reject);
  p.listen(0, '127.0.0.1', () => { const n = p.address().port; p.close(() => resolve(n)); });
});
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'planet-smoke-'));
const desk = path.join(sandbox, 'desktop');
const data = path.join(sandbox, 'data');
fs.mkdirSync(desk, { recursive: true });
for (const n of ['冒烟.txt', '冒烟.png']) fs.writeFileSync(path.join(desk, n), 'x');

const WITH_TRAY = process.argv.includes('--tray');
const env = { ...process.env, XOME_TEST_DESKTOP: desk, XOME_TEST_DATA: data };
if (!WITH_TRAY) env.XOME_TEST_NO_PIN = '1';
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(EXE, ['--remote-debugging-port=' + PORT, '--remote-allow-origins=*', '--user-data-dir=' + path.join(sandbox, 'userdata')], {
  env, stdio: ['ignore', 'pipe', 'pipe'],
});
const logs = [];
child.stdout.on('data', d => logs.push(String(d).trim()));
child.stderr.on('data', d => logs.push(String(d).trim()));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let ws;
try {
  let target = null;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      target = list.find(x => x.type === 'page' && /index\.html/.test(x.url));
      if (target) break;
    } catch (e) {}
    await sleep(300);
  }
  if (!target) throw new Error('打包版页面未出现');

  ws = new WebSocket(String(target.webSocketDebuggerUrl).replace('localhost', '127.0.0.1'));
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
    setTimeout(() => rej(new Error('ws 超时')), 8000);
  });
  let id = 0;
  const call = (method, params = {}) => new Promise(resolve => {
    const i = ++id;
    const h = ev => {
      const m = JSON.parse(String(ev.data));
      if (m.id === i) { ws.removeEventListener('message', h); resolve(m); }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await sleep(2200);
  const r = await call('Runtime.evaluate', {
    expression: `JSON.stringify({
      title: document.title,
      figures: document.querySelectorAll('.figure').length,
      rows: document.querySelectorAll('.shelf__row').length,
      files: document.querySelectorAll('.file').length,
      hasBridge: typeof window.planet === 'object',
      version: (document.querySelector('#brandVer') || {}).textContent || '',
      fontAllo: document.fonts ? document.fonts.check('12px Allo') : false
    })`,
    returnByValue: true,
  });
  const v = JSON.parse((r.result && r.result.result && r.result.result.value) || '{}');
  let ok = v.title === '糖绒星球' && v.figures === 5 && v.rows === 5 && v.files === 2 && v.hasBridge &&
    v.version === 'v1.0.0' && v.fontAllo === true;
  console.log((ok ? 'OK   ' : 'FAIL ') + '打包版启动并渲染 :: ' + JSON.stringify(v));

  if (WITH_TRAY) {
    await sleep(2400);                     // 等主进程 3 秒的层级探测落日志
    const joined = logs.join('\n');
    const trayOk = /\[tray\] ready preset=auto presets=auto,fhd,qhd,wqhd,uhd/.test(joined);
    const coreOk = !/win32 不可用/.test(joined);
    const layer = (joined.match(/\[layer\] .*/) || [''])[0];
    const layerOk = /"anchored":true/.test(layer);
    ok = ok && trayOk && coreOk && layerOk;
    console.log((trayOk && coreOk && layerOk ? 'OK   ' : 'FAIL ') + '托盘菜单 / 桌面层锚定 :: ' +
      (layer || 'no layer log') + ' | presets=' + trayOk);
  }
  await call('Runtime.evaluate', { expression: 'window.planet.quit(); 1' });
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error('[smoke][FAIL]', e.message);
  console.log(logs.join('\n').slice(-1200));
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch (e) {}
  await sleep(700);
  try { child.kill(); } catch (e) {}
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (e) {}
}
