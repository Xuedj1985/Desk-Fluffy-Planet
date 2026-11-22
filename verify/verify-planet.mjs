/**
 * 糖绒星球 · 端到端验证（独立沙箱，绝不碰真实桌面 / 真实 %APPDATA%\xome-planet）
 *
 *   node verify/verify-planet.mjs
 *
 * 用 XOME_TEST_DESKTOP / XOME_TEST_DATA / XOME_TEST_NO_PIN 把主进程指向临时目录，
 * 加载的是 planet/ 下的真实页面，再用 CDP 在渲染进程里跑断言。
 * 断言里会真的把临时文件收进书架、拖出来、上传真 PNG / GIF、切系列、删便签撤销。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const MAIN = path.join(ROOT, 'planet', 'main.js');
const LOG_DIR = path.join(ROOT, 'verify', 'logs');
const SHOT = path.join(ROOT, 'docs', 'planet-theme.png');

const PORT = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const p = probe.address().port;
    probe.close(() => resolve(p));
  });
});

/** 生成真正可被解码的 RGB PNG（不依赖第三方包） */
function makePng(w, h, rgb) {
  const tbl = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    tbl[n] = c >>> 0;
  }
  const crc = buf => {
    let c = 0xffffffff;
    for (const b of buf) c = tbl[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const off = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3] = rgb[0];
      raw[off + 2 + x * 3] = rgb[1];
      raw[off + 3 + x * 3] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(LOG_DIR, { recursive: true });
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'planet #s-'));
const desk = path.join(sandbox, 'desktop');
const data = path.join(sandbox, 'data');
fs.mkdirSync(desk, { recursive: true });
fs.mkdirSync(data, { recursive: true });

const docs = ['日报.txt', '需求.docx', '预算.xlsx', '汇报.pptx', '备忘.md', '报告.pdf'];
for (const n of docs) fs.writeFileSync(path.join(desk, n), 'planet verify\n');
const PNG = path.join(desk, '海边 #1.png');
fs.writeFileSync(PNG, makePng(64, 64, [242, 135, 176]));
const JPG = path.join(desk, '普通照片.jpg');
fs.writeFileSync(JPG, makePng(32, 32, [180, 200, 240]));
const folder = path.join(desk, '海边照片收藏');   // 名字故意超过四个字，用来验书脊短名截断
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(folder, 'in.txt'), 'x');
fs.writeFileSync(path.join(desk, '资料快捷.url'),
  '[InternetShortcut]\r\nURL=' + pathToFileURL(folder).href + '\r\n', 'utf8');

// 三个「应用」快捷方式：https 的 .url 不会被判成文件夹，走应用坞；真实桌面上的 .lnk 同理
for (const [name, url] of [
  ['浏览器.url', 'https://example.com'],
  ['音乐台.url', 'https://example.com/music'],
  ['商店.url', 'https://example.com/store'],
  ['邮箱.url', 'https://example.com/mail'],
  ['地图.url', 'https://example.com/maps'],
  ['相机.url', 'https://example.com/camera'],
]) {
  fs.writeFileSync(path.join(desk, name), '[InternetShortcut]\r\nURL=' + url + '\r\n', 'utf8');
}

const FIG_PNG = path.join(LOG_DIR, 'planet-figure.png');
const FIG_GIF = path.join(LOG_DIR, 'planet-figure.gif');
fs.writeFileSync(FIG_PNG, makePng(72, 120, [245, 143, 180]));
fs.writeFileSync(FIG_GIF, Buffer.from('R0lGODlhGAAYAIEAAPKHsAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQIFAAAACwAAAAAGAAYAAAIKQABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDPgwIACH5BAgUAAAALAAAAAAYABgAgaiL2AAAAAAAAAAAAAgpAAEIHEiwoMGDCBMqXMiwocOHECNKnEixosWLGDNq3Mixo8ePIEM+DAgAOw==', 'base64'));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.XOME_TEST_DESKTOP = desk;
env.XOME_TEST_DATA = data;
env.XOME_TEST_NO_PIN = '1';
env.PLANET_SELFTEST = '0';

const stage = s => console.log('[stage] ' + s);
stage('沙箱素材：' + fs.readdirSync(desk).join(' | '));
const child = spawn(ELECTRON, [MAIN, '--remote-debugging-port=' + PORT, '--remote-allow-origins=*'], {
  cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
});
const mainLog = [];
child.stdout.on('data', d => mainLog.push(String(d).trim()));
child.stderr.on('data', d => mainLog.push(String(d).trim()));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const hardStop = setTimeout(() => {
  console.error('[stage] 全局超时 100s');
  try {
    fs.writeFileSync(path.join(LOG_DIR, 'planet-验证结果.json'), JSON.stringify({
      at: new Date().toISOString(), total: 1, pass: 0, fail: 1,
      results: [{ name: '验证流程未完成', pass: false, extra: '100s 超时' }],
    }, null, 2), 'utf8');
  } catch (e) {}
  try { child.kill(); } catch (e) {}
  process.exit(2);
}, 100000);
hardStop.unref();

let ws, msgId = 0;
const pending = new Map();
const pageErrors = [];
const checks = [];

function send(method, params = {}) {
  const i = ++msgId;
  const p = new Promise(resolve => {
    pending.set(i, resolve);
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); resolve({ error: 'timeout' }); } }, 9000);
  });
  ws.send(JSON.stringify({ id: i, method, params }));
  return p;
}

async function ev(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    return { __error: (d.exception && d.exception.description) || d.text };
  }
  return r.result && r.result.result && r.result.result.value;
}

function ok(name, cond, extra) {
  checks.push({ name, pass: !!cond, extra: extra == null ? '' : String(extra) });
}

async function mouse(type, x, y, buttons) {
  await send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons: buttons === undefined ? 1 : buttons, clickCount: 1,
  });
}

async function rectOf(sel) {
  const raw = await ev(`JSON.stringify((()=>{const n=document.querySelector(${JSON.stringify(sel)});if(!n)return null;const r=n.getBoundingClientRect();return {l:r.left,t:r.top,w:r.width,h:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2};})())`);
  return raw ? JSON.parse(raw) : null;
}

async function clickSel(sel) {
  const r = await rectOf(sel);
  if (!r) return false;
  await mouse('mousePressed', r.cx, r.cy, 1);
  await mouse('mouseReleased', r.cx, r.cy, 0);
  await sleep(120);
  return true;
}

async function wheelAt(x, y, deltaY) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x, y, deltaX: 0, deltaY, modifiers: 0,
  });
  await sleep(45);
}

async function dragTo(from, to, steps = 14) {
  await mouse('mousePressed', from.cx, from.cy, 1);
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', from.cx + (to.cx - from.cx) * i / steps, from.cy + (to.cy - from.cy) * i / steps, 1);
    await sleep(16);
  }
  await mouse('mouseReleased', to.cx, to.cy, 0);
  await sleep(700);
}

try {
  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      const t = list.find(x => x.type === 'page' && /planet[\\/]index\.html/.test(x.url));
      if (t) { target = t; break; }
    } catch (e) {}
    await sleep(300);
  }
  if (!target) throw new Error('页面未出现');

  ws = new WebSocket(String(target.webSocketDebuggerUrl).replace('localhost', '127.0.0.1'));
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
    setTimeout(() => rej(new Error('ws 超时')), 8000);
  });
  ws.addEventListener('message', evt => {
    const m = JSON.parse(String(evt.data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      pageErrors.push('exception: ' + ((d.exception && d.exception.description) || d.text) + ' @' + (d.lineNumber + 1));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') pageErrors.push('log: ' + m.params.entry.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      pageErrors.push('console: ' + m.params.args.map(a => a.value || a.description).join(' '));
    }
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(2200);

  /* ---------- 静态结构与首屏 ---------- */
  const dom = JSON.parse(await ev(`JSON.stringify({
    brand: document.querySelector('.brand__txt b').textContent,
    scale: getComputedStyle(document.querySelector('#app')).transform,
    iw: innerWidth, ih: innerHeight,
    cw: document.documentElement.clientWidth, ch: document.documentElement.clientHeight,
    appW: document.querySelector('#app').getBoundingClientRect().width,
    appH: document.querySelector('#app').getBoundingClientRect().height,
    appBottomGap: innerHeight - document.querySelector('#app').getBoundingClientRect().bottom,
    caseW: document.querySelector('.case').offsetWidth,
    caseAlphaA: getComputedStyle(document.documentElement).getPropertyValue('--case').trim(),
    caseAlphaB: getComputedStyle(document.documentElement).getPropertyValue('--case-2').trim(),
    topBg: getComputedStyle(document.querySelector('#topbar')).backgroundColor,
    bodyBg: getComputedStyle(document.body).backgroundImage,
    showLabel: (document.querySelector('#zoneShow .zone__label') || {}).textContent || '',
    showBorder: parseFloat(getComputedStyle(document.querySelector('#zoneShow')).borderTopWidth),
    showBg: getComputedStyle(document.querySelector('#zoneShow')).backgroundImage,
    todoBorder: parseFloat(getComputedStyle(document.querySelector('#zoneTodo')).borderTopWidth),
    todoBg: getComputedStyle(document.querySelector('#zoneTodo')).backgroundImage,
    pcHint: !!document.querySelector('.pc__hint'),
    shelfHead: !!document.querySelector('.shelf__head') || !!document.querySelector('#shelfHint'),
    todoHead: !!document.querySelector('.todo__head') || !!document.querySelector('#todoCount') || !!document.querySelector('.todo__hint'),
    stageW: S.stageW,
    midW: document.querySelector('#zoneShow').offsetWidth,
    zones: document.querySelectorAll('.zone').length,
    rows: document.querySelectorAll('.shelf__row').length,
    polas: document.querySelectorAll('.polaroid').length,
    emptyPolas: document.querySelectorAll('.polaroid.empty').length,
    files: document.querySelectorAll('.file').length,
    fileIcons: document.querySelectorAll('.file .file__icon img').length,
    rots: Array.from(document.querySelectorAll('.file')).map(n=>parseFloat(n.style.getPropertyValue('--rot'))),
    figures: document.querySelectorAll('.figure').length,
    shadows: document.querySelectorAll('.figure__shadow').length,
    stands: document.querySelectorAll('.figure__stand').length,
    floors: document.querySelectorAll('.stage__floor').length,
    lamps: document.querySelectorAll('.stage__lamp').length,
    scales: Array.from(document.querySelectorAll('.figure')).map(n=>n.style.getPropertyValue('--s')),
    zs: Array.from(document.querySelectorAll('.figure')).map(n=>n.style.getPropertyValue('--z')),
    plaqueExists: !!document.querySelector('#showPlaque'),
    pcW: document.querySelector('.pc__screen').offsetWidth,
    pcH: document.querySelector('.pc__screen').offsetHeight,
    disk: document.querySelector('#pcDisk').textContent,
    mem: document.querySelector('#pcMem').textContent,
    clock: document.querySelector('#clockTime').textContent,
    todos: document.querySelectorAll('.todo:not(.add)').length,
    chks: document.querySelectorAll('.todo .chk').length,
    mode: document.querySelector('#btnMode').textContent.trim(),
    modeTitle: document.querySelector('#btnMode').title,
  })`));

  ok('品牌名为「糖绒星球」', dom.brand === '糖绒星球', dom.brand);
  const scaleNum = Number((/([\d.]+), 0, 0, ([\d.]+)/.exec(dom.scale) || [0, 0])[1]);
  ok('画布等比缩放且完整落在视口内',
    scaleNum > 0.5 &&
    Math.abs(dom.appW - dom.stageW * scaleNum) < 2 &&
    Math.abs(dom.appH - 940 * scaleNum) < 2 &&
    dom.appW <= dom.iw + 2 && dom.appH <= dom.ih + 2,
    dom.scale + ' / stage ' + dom.stageW + ' / app ' + Math.round(dom.appW) + '×' + Math.round(dom.appH) + ' / vp ' + dom.iw + '×' + dom.ih + ' / client ' + dom.cw + '×' + dom.ch);
  ok('柜体随画布横向展开、高度 820', dom.caseW === dom.stageW - 52 && dom.midW === dom.stageW - 962,
    'stage=' + dom.stageW + ' case=' + dom.caseW + ' mid=' + dom.midW);

  // 真实壁纸的亮月/暗空会从半透明柜体里透出来，看起来像「没有背景」。
  // 柜体是产品里最大的一块面，底色必须 ≥ 90% 不透明；顶栏同理。
  const alphaOf = v => {
    const m = /rgba?\([^)]*,\s*([\d.]+)\s*\)/.exec(v);
    return m ? Number(m[1]) : 1;
  };
  ok('柜体与顶栏足够不透明（壁纸不会透成背景）',
    alphaOf(dom.caseAlphaA) >= 0.9 && alphaOf(dom.caseAlphaB) >= 0.9 && alphaOf(dom.topBg) >= 0.9,
    [dom.caseAlphaA, dom.caseAlphaB, dom.topBg].join(' | '));

  // 概念稿的 body 有三色渐变打底；产品版漏了它，桌面壁纸就会从柜体外面露出来
  ok('最底层整屏渐变存在（桌面壁纸不会露出来）',
    dom.bodyBg !== 'none' && (dom.bodyBg.match(/gradient/g) || []).length >= 3,
    (dom.bodyBg.match(/gradient/g) || []).length + ' 层 / ' + String(dom.bodyBg).slice(0, 60));
  ok('底部给 Windows 任务栏留出安全间距（≥24px）', dom.appBottomGap >= 24, Math.round(dom.appBottomGap) + 'px');
  ok('七个功能区都在', dom.zones === 7, dom.zones);
  ok('书架五层', dom.rows === 5, dom.rows);

  const dock0 = JSON.parse(await ev(`JSON.stringify({
    apps:S.apps.map(a=>a.name), items:S.layout.dock.items.length,
    dom:document.querySelectorAll('.dock__item').length,
    groups:document.querySelectorAll('.dock__group').length,
    cols:S.layout.dock.cols, carpet:document.querySelectorAll('.file').length
  })`));
  ok('桌面应用快捷方式进应用坞、不占地毯',
    dock0.apps.length === 6 && dock0.items === 6 && dock0.dom === 6 && dock0.carpet === docs.length + 4,
    JSON.stringify(dock0));
  ok('应用坞默认 3 栏', dock0.groups === 3 && dock0.cols === 3, dock0.groups + ' 栏 / cols=' + dock0.cols);
  const dockNames = JSON.parse(await ev(`JSON.stringify((()=>{
    const g=document.querySelector('#dockGroups');
    return { labels:document.querySelectorAll('.dock__label').length,
             banned:['工作','工具','娱乐','常用','其他'].filter(w=>g.textContent.includes(w)),
             text:g.textContent.trim().slice(0,80) };
  })())`));
  ok('应用坞不显示分栏名称（分组只是自由摆位槽）',
    dockNames.labels === 0 && dockNames.banned.length === 0,
    'label 节点 ' + dockNames.labels + ' / 命中分类词 ' + JSON.stringify(dockNames.banned) +
    ' / 文本 ' + dockNames.text);
  ok('相册四格且首屏全空（不塞示例图）', dom.polas === 4 && dom.emptyPolas === 4, dom.polas + '/' + dom.emptyPolas);
  ok('地毯资料卡数量等于桌面文件数', dom.files === docs.length + 4, dom.files + '/' + (docs.length + 4));
  ok('资料卡都用系统真实图标', dom.fileIcons >= dom.files - 1, dom.fileIcons + '/' + dom.files);
  ok('资料卡歪斜在 ±8° 内', dom.rots.every(r => Number.isFinite(r) && Math.abs(r) <= 8), dom.rots.join(','));
  ok('展柜 5 只 + 阴影 / 展台 / 地台 / 射灯齐全',
    dom.figures === 5 && dom.shadows === 5 && dom.stands === 5 && dom.floors === 1 && dom.lamps === 1,
    JSON.stringify([dom.figures, dom.shadows, dom.stands, dom.floors, dom.lamps]));
  ok('玩偶前后高低错位（缩放与层级均不同）',
    new Set(dom.scales).size >= 4 && new Set(dom.zs).size >= 4, dom.scales.join(','));
  ok('展柜右下角不再有铭牌文字', dom.plaqueExists === false, 'plaqueExists=' + dom.plaqueExists);
  ok('电脑是正方形屏 140×140', dom.pcW === 140 && dom.pcH === 140, dom.pcW + '×' + dom.pcH);
  ok('磁盘 / 内存是真实读数（不是写死的 68/42）',
    /^(\d{1,3}%|—)$/.test(dom.disk) && /^(\d{1,3}%|—)$/.test(dom.mem), dom.disk + ' / ' + dom.mem);
  ok('顶栏时钟在走', /^\d{2}:\d{2}$/.test(dom.clock), dom.clock);
  ok('首屏 5 条示例便签、无勾选框', dom.todos === 5 && dom.chks === 0, dom.todos + ' / chk=' + dom.chks);

  /* ---------- 第十九轮：UI 协调性统一（一套配色 / 一套标题 / 少小字 / 补概念稿） ---------- */
  const uiCohesion = JSON.parse(await ev(`JSON.stringify((()=>{
    const labels=[...document.querySelectorAll('.zone__label')];
    const labelStyle=labels.map(n=>{const c=getComputedStyle(n);return c.fontSize+'/'+c.fontWeight+'/'+c.borderRadius;});
    const files=[...document.querySelectorAll('.file')].map(n=>({
      fc:n.style.getPropertyValue('--fc').trim(),
      light:n.style.getPropertyValue('--fc-light').trim(),
      bg:getComputedStyle(n).backgroundImage,
      edge:getComputedStyle(n).boxShadow,
    }));
    const arm=document.querySelector('.music__arm');
    return {
      labels:labels.length,
      dockLabel:!!document.querySelector('#zoneDock .zone__label'),
      labelUniq:[...new Set(labelStyle)].length,
      files:files.length,
      fcOk:files.every(f=>f.fc && f.light && f.fc.toUpperCase()!==f.light.toUpperCase()
        && /gradient/.test(f.bg) && /inset/.test(f.edge)),
      lightSample:files.slice(0,3).map(f=>f.fc+'→'+f.light),
      hints:document.querySelectorAll('.shelf__hint,.dock__empty').length,
      emptyCaps:[...document.querySelectorAll('.polaroid.empty .polaroid__cap')].length,
      musicNow:document.querySelector('#musicNow').textContent.trim(),
      arm:!!arm, armHit:arm?getComputedStyle(arm).pointerEvents:'',
      pcCard:/inset/.test(getComputedStyle(document.querySelector('#zonePC')).boxShadow),
      albumCard:/inset/.test(getComputedStyle(document.querySelector('#zoneAlbum')).boxShadow),
    };
  })())`));
  ok('六个胶囊标题同款，应用坞不再用裸小字',
    uiCohesion.labels === 6 && uiCohesion.dockLabel && uiCohesion.labelUniq === 1,
    uiCohesion.labels + ' 个 / 样式 ' + uiCohesion.labelUniq + ' 种');
  ok('地毯资料卡按格式配色（浅彩底 + 原色立边 / 角标）',
    uiCohesion.files > 0 && uiCohesion.fcOk, uiCohesion.lightSample.join(' | '));
  ok('非功能性小字清零（空层 / 空栏 / 空相册 / 未选目录）',
    uiCohesion.hints === 0 && uiCohesion.emptyCaps === 0 && uiCohesion.musicNow === '',
    JSON.stringify({hints:uiCohesion.hints,caps:uiCohesion.emptyCaps,now:uiCohesion.musicNow}));
  ok('唱片机补回概念稿的唱臂且不抢点击',
    uiCohesion.arm && uiCohesion.armHit === 'none', uiCohesion.armHit);
  ok('我的电脑 / 甜甜相册也补上板块卡片底',
    uiCohesion.pcCard && uiCohesion.albumCard,
    'pc=' + uiCohesion.pcCard + ' album=' + uiCohesion.albumCard);
  ok('展柜右下角铭牌已取消（不再挂系列 / 数量小字）',
    (await ev(`!document.querySelector('#showPlaque')`)) === true, 'showPlaque 不存在');

  // 概念稿的区块是有卡片底的：产品落地时漏了展柜标题、展柜外框、待办卡片三段
  ok('展柜标题与外层卡片框都在',
    dom.showLabel === '潮玩展柜' && dom.showBorder >= 2 && /gradient/.test(dom.showBg),
    dom.showLabel + ' / border ' + dom.showBorder + 'px');
  const todoFit = JSON.parse(await ev(`JSON.stringify((()=>{
    const z=document.querySelector('#zoneTodo').getBoundingClientRect();
    const l=document.querySelector('#todoList').getBoundingClientRect();
    const n=document.querySelector('.todo:not(.add)').getBoundingClientRect();
    return {zoneBottom:z.bottom,listBottom:l.bottom,noteBottom:n.bottom,pad:z.bottom-l.bottom};
  })())`));
  ok('电脑下面不再挂常驻操作提示', dom.pcHint === false, 'pc__hint=' + dom.pcHint);
  ok('书架头部不再显示说明与统计小字', dom.shelfHead === false, 'shelf head=' + dom.shelfHead);
  ok('待办头部不再显示条数与操作提示', dom.todoHead === false, 'todo head=' + dom.todoHead);
  ok('待办有卡片外框，便签与列表不越界',
    dom.todoBorder >= 1.5 && /gradient/.test(dom.todoBg) &&
    todoFit.listBottom <= todoFit.zoneBottom - 6 && todoFit.noteBottom <= todoFit.zoneBottom,
    'border ' + dom.todoBorder + 'px / 底部余量 ' + Math.round(todoFit.pad) + 'px');
  ok('模式按钮是短标签 + 状态在 tooltip', dom.mode === '模式' && /列表循环/.test(dom.modeTitle), dom.mode + ' / ' + dom.modeTitle);

  // 便签高度随文字行数自适应：一行矮、多行高，列表行高为 min-content
  const todoAdapt = JSON.parse(await ev(`JSON.stringify((()=>{
    const card=document.querySelector('.todo:not(.add)');
    const txt=card.querySelector('.todo__text');
    const orig=txt.textContent;
    const h1=card.offsetHeight;
    txt.textContent='这是一段很长的愿望文字'.repeat(8);
    const h2=card.offsetHeight;
    txt.textContent=orig;
    return { h1, h2, rows:getComputedStyle(document.querySelector('#todoList')).gridAutoRows };
  })())`));
  ok('便签高度随文字行数自适应（多行更高、行高 min-content）',
    todoAdapt.h2 > todoAdapt.h1 && todoAdapt.h1 >= 28 && /min-content/.test(todoAdapt.rows),
    JSON.stringify(todoAdapt));
  // 用 offsetTop/offsetHeight（布局坐标）而不是 getBoundingClientRect：
  // .music 现在整体旋转 -1.6deg，外接矩形会被放大而失真。
  const musicFit = JSON.parse(await ev(`JSON.stringify((()=>{
    const music=document.querySelector('.music');
    const title=document.querySelector('.music__title');
    const row=document.querySelector('.music__row');
    const foot=document.querySelector('.music__foot');
    return {sub:!!document.querySelector('.music__sub'),justify:getComputedStyle(document.querySelector('.music__body')).justifyContent,
      top:title.offsetTop,gap:foot.offsetTop-(row.offsetTop+row.offsetHeight),
      bottom:music.clientHeight-(foot.offsetTop+foot.offsetHeight),
      tilt:(getComputedStyle(music).transform||'none')};
  })())`));
  ok('唱片机去掉副标题，按钮与状态拉开、整列撑满',
    musicFit.sub === false && musicFit.justify === 'space-between' &&
    musicFit.top <= 26 && musicFit.gap >= 14 && musicFit.bottom <= 24,
    JSON.stringify(musicFit));

  // 虚线槽应在应用坞内上下居中（此前整体偏高）
  const dockAlign = JSON.parse(await ev(`JSON.stringify((()=>{
    const d=document.querySelector('#zoneDock'), g=document.querySelector('#dockGroups');
    return {zoneH:d.clientHeight, top:g.offsetTop, h:g.offsetHeight};
  })())`));
  ok('应用坞虚线槽在坞内垂直居中',
    Math.abs(dockAlign.top - (dockAlign.zoneH - dockAlign.top - dockAlign.h)) <= 3,
    '顶 ' + dockAlign.top + ' / 底 ' + (dockAlign.zoneH - dockAlign.top - dockAlign.h) + ' / 区高 ' + dockAlign.zoneH);

  // 回归：托盘「隐藏 / 显示星球」后必须仍可点击。
  // 旧实现用 win.hide()/showInactive() 会破坏 setIgnoreMouseEvents 的鼠标转发，
  // 显示后收不到 mousemove，永远卡在穿透态；现改为透明度隐藏（窗口始终可见）。
  const toggle = JSON.parse(await ev(`(async()=>{
    const a = await window.planet.testToggle(true);
    const b = await window.planet.testToggle(false);
    await new Promise(r=>setTimeout(r,220));
    const fig = document.querySelector('.figure[data-i="0"]');
    const r = fig.getBoundingClientRect();
    // 直接把指针放到玩偶中心并同步重算一次穿透（不依赖 rAF 时序）
    lastPointer = { x: r.left + r.width/2, y: r.top + r.height/2 };
    syncIgnoreAtPointer();
    return JSON.stringify({ a, b, ignoring });
  })()`, true));
  ok('隐藏/显示星球后仍可见且可点击（不卡穿透）',
    toggle.a.hidden === true && toggle.a.visible === true && toggle.a.opacity === 0 &&
    toggle.b.hidden === false && toggle.b.visible === true && toggle.b.opacity === 1 &&
    toggle.ignoring === false,
    JSON.stringify(toggle));

  /* ---------- 底部应用坞加入后的整屏布局（舞台坐标，不随缩放档位变化） ---------- */
  const layout = JSON.parse(await ev(`JSON.stringify((()=>{
    const R = s => { const n=document.querySelector(s); if(!n) return null; const r=n.getBoundingClientRect();
      return {t:r.top,b:r.bottom,l:r.left,r:r.right,w:r.width,h:r.height}; };
    const app=document.querySelector('#app').getBoundingClientRect();
    const k=app.width/(S.stageW||1440);
    const px=v=>Math.round(v/k);
    const cs=getComputedStyle(document.querySelector('#zoneShelf'));
    const card=document.querySelector('.case').getBoundingClientRect();
    const dock=R('#zoneDock'), show=R('#zoneShow'), floor=R('#zoneFloor'),
          todo=R('#zoneTodo'), shelf=R('#zoneShelf'), music=R('#zoneMusic'), carpet=R('.carpet');
    const files=Array.from(document.querySelectorAll('.file')).map(n=>n.getBoundingClientRect().bottom);
    const row=R('.shelf__row');
    return {
      gaps:{floor:px(dock.t-floor.b),todo:px(dock.t-todo.b),music:px(dock.t-music.b),
            shelf:px(dock.t-shelf.b),carpet:px(dock.t-carpet.b),
            file:px(dock.t-Math.max.apply(null,files.concat([0])))},
      floorTop:px(floor.t-card.top), showH:px(show.h), showW:px(show.w), floorW:px(floor.w),
      musicTop:px(music.t-card.top), todoTop:px(todo.t-card.top), shelfMusic:px(music.t-shelf.b),
      frame:{border:parseFloat(cs.borderTopWidth),radius:parseFloat(cs.borderTopLeftRadius),
             grad:/gradient/.test(cs.backgroundImage),pad:parseFloat(cs.paddingLeft),
             inset:px(row.l-shelf.l)}
    };
  })())`));
  ok('四列内容都停在应用坞上方，地毯与资料卡不再被压住',
    layout.gaps.floor >= 18 && layout.gaps.todo >= 18 && layout.gaps.music >= 18 &&
    layout.gaps.shelf >= 18 && layout.gaps.carpet >= 18 && layout.gaps.file >= 8,
    JSON.stringify(layout.gaps));
  ok('展柜变矮、宽度不变，地毯整体上移',
    layout.showH >= 290 && layout.showH <= 330 && Math.abs(layout.showW - layout.floorW) <= 2 &&
    layout.floorTop >= 355 && layout.floorTop <= 395,
    '展柜 ' + layout.showH + 'px / 宽 ' + layout.showW + ' / 地毯顶 ' + layout.floorTop);
  ok('唱片机上移且与书架保持间距',
    layout.musicTop >= 505 && layout.musicTop <= 530 && layout.shelfMusic >= 16,
    '唱片机顶 ' + layout.musicTop + ' / 与书架 ' + layout.shelfMusic + 'px');
  ok('今日小愿望也上移', layout.todoTop >= 445 && layout.todoTop <= 470, layout.todoTop + 'px');
  ok('书架补回整圈圆角外框',
    layout.frame.border >= 2.5 && layout.frame.radius >= 20 && layout.frame.grad &&
    layout.frame.pad >= 12 && layout.frame.inset >= 12,
    JSON.stringify(layout.frame));

  /* ---------- 我的电脑：电脑垂直居中，绿植取消、糖果罐占据原绿植位置 ---------- */
  const pcAlign = JSON.parse(await ev(`JSON.stringify((()=>{
    const s=document.querySelector('.pc__screen'), t=document.querySelector('.pc__tower');
    const b=document.querySelector('#bin'), z=document.querySelector('#zonePC');
    return {
      screenTop:s.offsetTop, screenBase:s.offsetTop+s.offsetHeight,
      towerBase:t.offsetTop+t.offsetHeight,
      binTop:b.offsetTop, binLeft:b.offsetLeft, binW:b.offsetWidth, binH:b.offsetHeight,
      zoneH:z.clientHeight, zoneW:z.clientWidth, towerRight:t.offsetLeft+t.offsetWidth,
      plantExists:!!document.querySelector('.pc__plant')
    };
  })())`));
  ok('显示器与主机箱底边在同一水平线',
    Math.abs(pcAlign.screenBase - pcAlign.towerBase) <= 1,
    pcAlign.screenBase + ' / ' + pcAlign.towerBase);
  ok('电脑整体下移后上下留白接近（不再整体偏高）',
    Math.abs(pcAlign.screenTop - (pcAlign.zoneH - pcAlign.screenBase)) <= 4,
    '顶 ' + pcAlign.screenTop + ' / 底 ' + (pcAlign.zoneH - pcAlign.screenBase) + ' / 区高 ' + pcAlign.zoneH);
  ok('绿植已取消', pcAlign.plantExists === false, 'plant=' + pcAlign.plantExists);
  ok('糖果罐搬进我的电脑区域、占据原绿植位置（右侧、竖向居中）',
    pcAlign.binLeft >= pcAlign.towerRight - 2 && pcAlign.binTop >= 0 &&
    pcAlign.binTop + pcAlign.binH <= pcAlign.zoneH &&
    Math.abs((pcAlign.binTop + pcAlign.binH / 2) - pcAlign.zoneH / 2) <= 8,
    JSON.stringify(pcAlign));

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'));
    stage('截图 ' + SHOT);
  }
  // 电脑区 3× 特写：一眼能核对花盆底边与屏幕 / 机箱底边
  const pcShotRect = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.querySelector('#zonePC').getBoundingClientRect();
    return {x:r.x,y:r.y,w:r.width,h:r.height};})())`));
  const pcShot = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: Math.max(0, pcShotRect.x - 10), y: Math.max(0, pcShotRect.y - 24),
            width: pcShotRect.w + 20, height: pcShotRect.h + 36, scale: 3 },
  });
  if (pcShot.result && pcShot.result.data) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'planet-pc-screen.png'),
      Buffer.from(pcShot.result.data, 'base64'));
    stage('电脑区特写 docs/planet-pc-screen.png');
  }
  // 应用坞特写：核对分栏只有虚线槽位、没有任何栏名
  const dockShotRect = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.querySelector('#zoneDock').getBoundingClientRect();
    return {x:r.x,y:r.y,w:r.width,h:r.height};})())`));
  const dockShot = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    // 坞标题是 top:-15px 的胶囊，clip 只上扩 6px 会把它切掉半截；上扩 22px 才完整
    clip: { x: Math.max(0, dockShotRect.x - 6), y: Math.max(0, dockShotRect.y - 22),
            width: dockShotRect.w + 12, height: dockShotRect.h + 28, scale: 2 },
  });
  if (dockShot.result && dockShot.result.data) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'planet-dock.png'),
      Buffer.from(dockShot.result.data, 'base64'));
    stage('应用坞特写 docs/planet-dock.png');
  }

  /* ---------- 展柜：上传 / 拒收 / 增减位 / 切系列 / 换位 ---------- */
  const figSet = await ev(`(async()=>{
    const r = await window.planet.figureSet(0, ${JSON.stringify(FIG_PNG)});
    if (r.ok) { S.show = r.showcase; renderShow(); }
    return JSON.stringify({ok:r.ok, err:r.error||'', src:(document.querySelector('.figure[data-i="0"] img')||{}).src||''});
  })()`, true);
  const f1 = JSON.parse(figSet);
  ok('PNG 上传后真的出现 <img>', f1.ok && /\/figures\/starman\/s0\.png/.test(f1.src), f1.src);

  const gifSet = await ev(`(async()=>{
    const r = await window.planet.figureSet(1, ${JSON.stringify(FIG_GIF)});
    if (r.ok) { S.show = r.showcase; renderShow(); }
    return JSON.stringify({ok:r.ok, src:(document.querySelector('.figure[data-i="1"] img')||{}).src||''});
  })()`, true);
  const f2 = JSON.parse(gifSet);
  ok('GIF 不转码原样保留', f2.ok && /\/figures\/starman\/s1\.gif/.test(f2.src), f2.src);
  await sleep(350);
  const gifDecoded = JSON.parse(await ev(`JSON.stringify((()=>{
    const im=document.querySelector('.figure[data-i="1"] img');
    return im ? {complete:im.complete, w:im.naturalWidth, h:im.naturalHeight} : null;
  })())`));
  ok('GIF 能被浏览器解码并渲染（动图原样显示）',
    !!gifDecoded && gifDecoded.complete && gifDecoded.w > 0 && gifDecoded.h > 0,
    JSON.stringify(gifDecoded));
  const srcBytes = fs.readFileSync(FIG_GIF);
  const dstBytes = fs.readFileSync(path.join(data, 'figures', 'starman', 's1.gif'));
  ok('GIF 字节与源文件完全一致（未转码 / 未丢帧）',
    srcBytes.length === dstBytes.length && srcBytes.equals(dstBytes),
    srcBytes.length + ' vs ' + dstBytes.length);

  const badSet = await ev(`(async()=>{
    const r = await window.planet.figureSet(2, ${JSON.stringify(JPG)});
    return JSON.stringify({ok:r.ok, err:r.error||''});
  })()`, true);
  const f3 = JSON.parse(badSet);
  ok('JPG 被展柜拒绝（只收 PNG / GIF）', !f3.ok && /PNG/.test(f3.err), f3.err);

  await clickSel('#slotPlus');
  ok('加一位到 6 只', (await ev(`document.querySelectorAll('.figure').length`)) === 6);
  await clickSel('#slotPlus');
  ok('到 6 只后不再增加', (await ev(`document.querySelectorAll('.figure').length`)) === 6);
  await clickSel('#slotMinus');
  await clickSel('#slotMinus');
  const afterMinus = JSON.parse(await ev(`JSON.stringify({n:document.querySelectorAll('.figure').length,c:S.show.count})`));
  ok('减两位回到 4 只', afterMinus.n === 4 && afterMinus.c === 4, JSON.stringify(afterMinus));

  await clickSel('#seriesTabs button[data-k="caramel"]');
  await sleep(300);
  const car = JSON.parse(await ev(`JSON.stringify({s:S.show.series,c:S.show.count,n:document.querySelectorAll('.figure').length,kept:S.show.slots.filter(Boolean).length})`));
  // 每系列独立：焦糖是全新系列，默认 3 位、不带星星人的图
  ok('切到焦糖：独立系列，默认 3 位且不带星星人的图',
    car.s === 'caramel' && car.c === 3 && car.n === 3 && car.kept === 0, JSON.stringify(car));

  // 回归：系列各自独立——切到 big37 是它自己的空展柜，切回星星人仍保留原来的 2 张
  const seriesKeep = JSON.parse(await ev(`(async()=>{
    const carKept = S.show.slots.filter(Boolean).length;
    switchSeries('big37');
    await new Promise(r=>setTimeout(r,300));
    const big = { c:S.show.count, kept:S.show.slots.filter(Boolean).length, n:document.querySelectorAll('.figure').length };
    switchSeries('starman');
    await new Promise(r=>setTimeout(r,300));
    const star = { c:S.show.count, kept:S.show.slots.filter(Boolean).length, n:document.querySelectorAll('.figure').length };
    return JSON.stringify({ carKept, big, star });
  })()`, true));
  ok('系列各自独立：big37 自己空展柜、切回星星人仍保留原 2 张',
    seriesKeep.carKept === 0 &&
    seriesKeep.big.c === 1 && seriesKeep.big.kept === 0 && seriesKeep.big.n === 1 &&
    seriesKeep.star.c === 4 && seriesKeep.star.kept === 2 && seriesKeep.star.n === 4,
    JSON.stringify(seriesKeep));

  const beforeSwap = JSON.parse(await ev(`JSON.stringify(S.show.slots.map(x=>x&&x.name))`));
  const swapped = await ev(`(async()=>{ await swapFigures(0,1); return JSON.stringify(S.show.slots.map(x=>x&&x.name)); })()`, true);
  const afterSwap = JSON.parse(swapped);
  ok('拖拽换位真的交换（swapFigures 保留）', beforeSwap[0] === afterSwap[1] && beforeSwap[1] === afterSwap[0],
    JSON.stringify(afterSwap));

  // 顶部 ‹ › 改为调整倾斜度：连点两次右倾斜，--rot 递增且写进 poses[i].rot
  const rotAfter = JSON.parse(await ev(`(async()=>{
    const r0 = rotOf(0);
    const btns = [...document.querySelectorAll('.figure[data-i="0"] .figure__move button')];
    btns[1].dispatchEvent(new MouseEvent('click', { bubbles:true }));
    btns[1].dispatchEvent(new MouseEvent('click', { bubbles:true }));
    await new Promise(r=>setTimeout(r,420));
    const fig=document.querySelector('.figure[data-i="0"]');
    return JSON.stringify({ r0, r1:rotOf(0), dom:parseFloat(fig.style.getPropertyValue('--rot')),
      saved:S.show.poses && S.show.poses[0] && S.show.poses[0].rot, titles:btns.map(b=>b.title) });
  })()`, true));
  ok('顶部 ‹ › 改为调倾斜度（每次 +5°，写进 poses.rot）',
    Math.abs(rotAfter.r1 - (rotAfter.r0 + 10)) <= 0.001 && Math.abs(rotAfter.dom - rotAfter.r1) <= 0.001 &&
    Math.abs(rotAfter.saved - rotAfter.r1) <= 0.001 &&
    rotAfter.titles[0] === '向左倾斜' && rotAfter.titles[1] === '向右倾斜',
    JSON.stringify(rotAfter));

  // 回归：按倾斜按钮不能进入拖拽态（旧实现 pointerdown 冒泡到 figure，抬手就弹添加图片窗）
  const btnGuard = JSON.parse(await ev(`(()=>{
    const b=document.querySelector('.figure[data-i="0"] .figure__move button');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, button:0, clientX:5, clientY:5 }));
    const d = dragging ? dragging.kind : null;
    if (dragging) window.dispatchEvent(new PointerEvent('pointercancel', { bubbles:true }));
    return JSON.stringify({ d });
  })()`));
  ok('点倾斜按钮不进入拖拽（不误弹添加图片窗）', btnGuard.d === null, JSON.stringify(btnGuard));

  // 真拖拽自由摆位：把第 1 位拖到玻璃柜左下，松手写盘；再点「重排」回到默认
  const pose0 = JSON.parse(await ev(`JSON.stringify({
    x: document.querySelector('.figure[data-i="0"]').style.getPropertyValue('--x'),
    y: document.querySelector('.figure[data-i="0"]').style.getPropertyValue('--y'),
    s: parseFloat(document.querySelector('.figure[data-i="0"]').style.getPropertyValue('--s')),
    z: Number(document.querySelector('.figure[data-i="0"]').style.getPropertyValue('--z')),
    saved: S.show.poses[0]
  })`));
  const figA = await rectOf('.figure[data-i="0"]');
  const gridRect = await rectOf('#showGrid');
  const grip = r => ({ cx: r.l + r.w / 2, cy: r.t + r.h * 0.42 });
  const poseTarget = { cx: gridRect.l + gridRect.w * 0.26, cy: gridRect.t + gridRect.h * 0.92 };
  await dragTo(grip(figA), poseTarget, 14);
  const posed = JSON.parse(await ev(`JSON.stringify({
    saved: S.show.poses[0],
    x: document.querySelector('.figure[data-i="0"]').style.getPropertyValue('--x'),
    y: document.querySelector('.figure[data-i="0"]').style.getPropertyValue('--y'),
    s: parseFloat(document.querySelector('.figure[data-i="0"]').style.getPropertyValue('--s')),
    z: Number(document.querySelector('.figure[data-i="0"]').style.getPropertyValue('--z'))
  })`));
  ok('玩偶可以自由拖动并记住位置',
    !!posed.saved && Math.abs(posed.saved.x - 26) < 6 && posed.saved.y > 80 &&
    posed.x !== pose0.x && posed.y !== pose0.y,
    JSON.stringify({ from: [pose0.x, pose0.y], to: [posed.x, posed.y] }));
  ok('拖到前排会按景深变大、压到上层',
    posed.s > pose0.s && posed.z > pose0.z,
    's ' + pose0.s + '→' + posed.s + ' / z ' + pose0.z + '→' + posed.z);

  const showPoseDisk = JSON.parse(fs.readFileSync(path.join(data, 'showcase.json'), 'utf8'));
  const starPoses = showPoseDisk.seriesData && showPoseDisk.seriesData.starman && showPoseDisk.seriesData.starman.poses;
  ok('自由摆位写进 showcase.json（seriesData.starman.poses）', !!(starPoses && starPoses[0]),
    JSON.stringify(starPoses && starPoses[0]));

  await clickSel('#poseReset');
  await sleep(600);
  const reset = JSON.parse(await ev(`JSON.stringify({
    saved: S.show.poses[0],
    x: document.querySelector('.figure[data-i="0"]').style.getPropertyValue('--x'),
    allNull: S.show.poses.every(p => !p)
  })`));
  ok('「重排」把玩偶放回默认站位', reset.saved === null && reset.allNull && reset.x === pose0.x,
    JSON.stringify(reset));

  /* ---------- 滚轮 = 放大 / 缩小（不再调前后层级） ---------- */
  const fig0Rect = await rectOf('.figure[data-i="0"]');
  const wheelGrip = { x: fig0Rect.l + fig0Rect.w / 2, y: fig0Rect.t + fig0Rect.h * 0.6 };
  await mouse('mouseMoved', wheelGrip.x, wheelGrip.y, 0);
  await sleep(140);
  const zoomBefore = JSON.parse(await ev(`JSON.stringify({
    zoom:zoomOf(0),
    dom:Number(document.querySelector('.figure[data-i="0"]').style.getPropertyValue('--zoom')),
    z:Number(document.querySelector('.figure[data-i="0"]').style.getPropertyValue('--z'))
  })`));
  ok('默认缩放为 1（原始大小）', zoomBefore.zoom === 1 && zoomBefore.dom === 1, JSON.stringify(zoomBefore));

  await wheelAt(wheelGrip.x, wheelGrip.y, -120);
  await sleep(200);
  const zoomIn = JSON.parse(await ev(`JSON.stringify((()=>{
    const f=document.querySelector('.figure[data-i="0"]');
    return { zoom:zoomOf(0), dom:Number(f.style.getPropertyValue('--zoom')),
      z:Number(f.style.getPropertyValue('--z')),
      tag:f.querySelector('.figure__tag').textContent,
      tip:document.querySelector('#tip').textContent };
  })())`));
  ok('上滚放大 10%，层叠顺序不变',
    Math.abs(zoomIn.zoom - 1.1) < 0.001 && Math.abs(zoomIn.dom - 1.1) < 0.001 && zoomIn.z === zoomBefore.z,
    JSON.stringify(zoomIn));
  ok('放大时标签显示百分比（110%）', /110%/.test(zoomIn.tag), zoomIn.tag);

  await sleep(500);
  const zoomDisk = JSON.parse(fs.readFileSync(path.join(data, 'showcase.json'), 'utf8'));
  const zoomPoses = zoomDisk.seriesData && zoomDisk.seriesData.starman && zoomDisk.seriesData.starman.poses;
  ok('缩放写进 showcase.json 的 poses[0].zoom',
    !!(zoomPoses && zoomPoses[0] && Math.abs(zoomPoses[0].zoom - 1.1) < 0.001),
    JSON.stringify(zoomPoses && zoomPoses[0]));

  await wheelAt(wheelGrip.x, wheelGrip.y, 120);
  await sleep(160);
  const zoomOut = JSON.parse(await ev(`JSON.stringify({ zoom:zoomOf(0),
    dom:Number(document.querySelector('.figure[data-i="0"]').style.getPropertyValue('--zoom')) })`));
  ok('下滚缩回原始大小',
    Math.abs(zoomOut.zoom - 1) < 0.001 && Math.abs(zoomOut.dom - 1) < 0.001, JSON.stringify(zoomOut));

  for (let i = 0; i < 12; i++) await wheelAt(wheelGrip.x, wheelGrip.y, 120);
  await sleep(200);
  const zoomMin = JSON.parse(await ev(`JSON.stringify({ zoom:zoomOf(0),
    tip:document.querySelector('#tip').textContent })`));
  ok('缩到 50% 就停住，不会越界', Math.abs(zoomMin.zoom - 0.5) < 0.001 && /最小/.test(zoomMin.tip), JSON.stringify(zoomMin));

  for (let i = 0; i < 20; i++) await wheelAt(wheelGrip.x, wheelGrip.y, -120);
  await sleep(220);
  const zoomMax = JSON.parse(await ev(`JSON.stringify({ zoom:zoomOf(0),
    tip:document.querySelector('#tip').textContent })`));
  ok('放到 200% 就停住，不会越界', Math.abs(zoomMax.zoom - 2) < 0.001 && /最大/.test(zoomMax.tip), JSON.stringify(zoomMax));

  // 右键仍能调前后层级（只是不再占用滚轮）
  await ev(`(()=>{const f=document.querySelector('.figure[data-i="0"]');
    const r=f.getBoundingClientRect();
    f.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));
    return 1;})()`);
  await sleep(200);
  const menuLabels = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#ctx .ctx-item')].map(n=>n.textContent))`));
  ok('右键菜单有层级操作（不再写「滚轮」）',
    ['往前一层','往后一层','置于最前','置于最后'].every(x => menuLabels.indexOf(x) >= 0),
    menuLabels.join(' | '));

  await ev(`(()=>{const it=[...document.querySelectorAll('#ctx .ctx-item')].find(n=>n.textContent==='置于最后');
    if(it) it.click(); return 1;})()`);
  await sleep(900);
  const zLast = JSON.parse(await ev(`JSON.stringify((()=>{
    const f=document.querySelector('.figure[data-i="0"]');
    return {z:Number(f.style.getPropertyValue('--z')), saved:S.show.poses[0]&&S.show.poses[0].z,
      rank:PM.depthRanks(effectiveZs())[0], b:Number(f.style.getPropertyValue('--b')),
      blur:parseFloat(f.style.getPropertyValue('--blur'))};
  })())`));
  ok('右键「置于最后」生效并变成第 1 层，且不变暗不模糊',
    zLast.rank === 1 && Math.abs(zLast.b - 1) < 0.001 && zLast.blur === 0,
    JSON.stringify(zLast));

  // 手动层级 + 缩放要能扛住一次拖拽
  const fig0Now = await rectOf('.figure[data-i="0"]');
  await dragTo({ cx: fig0Now.l + fig0Now.w / 2, cy: fig0Now.t + fig0Now.h * 0.5 },
    { cx: fig0Now.l + fig0Now.w / 2 + 22, cy: fig0Now.t + fig0Now.h * 0.5 }, 8);
  await sleep(550);
  const afterDragDepth = JSON.parse(await ev(`JSON.stringify({
    z:S.show.poses[0]&&S.show.poses[0].z,
    zoom:S.show.poses[0]&&S.show.poses[0].zoom,
    dom:Number(document.querySelector('.figure[data-i="0"]').style.getPropertyValue('--z'))
  })`));
  ok('拖动摆位不会丢掉缩放（层级仍按脚底线取默认值）',
    afterDragDepth.dom === zLast.z && Math.abs(afterDragDepth.zoom - 2) < 0.001,
    JSON.stringify(afterDragDepth) + ' / z=' + zLast.z);

  await ev(`resetPoses(null)`, true);
  await sleep(450);

  const showJson = JSON.parse(fs.readFileSync(path.join(data, 'showcase.json'), 'utf8'));
  // 新格式：seriesData[系列] 各自一套 files/names/poses，counts[系列] 各自一个站位数
  ok('展柜配置落盘（seriesData / counts 每系列独立）',
    showJson.series === 'starman' &&
    showJson.seriesData && showJson.seriesData.starman &&
    showJson.seriesData.starman.files.filter(Boolean).length === 2 &&
    showJson.counts && showJson.counts.starman === 4,
    JSON.stringify({ s: showJson.series, counts: showJson.counts }));
  ok('形象文件落在 figures/<系列>/ 且没有二进制塞进 JSON',
    fs.existsSync(path.join(data, 'figures', 'starman', 's0.png')) &&
    fs.existsSync(path.join(data, 'figures', 'starman', 's1.gif')));

  await clickSel('#seriesTabs button[data-k="starman"]');
  await sleep(260);
  await ev(`(async()=>{ S.show.count = 5; await persistShow(); renderShow(); return 1; })()`, true);
  await sleep(300);

  /* ---------- 相册：快照 + 上架后不碎 ---------- */
  const album = await ev(`(async()=>{
    const r = await window.planet.albumSet('p1', ${JSON.stringify(PNG)});
    if (r.ok) { S.album = r.album; renderAlbum(0); }
    return JSON.stringify({ok:r.ok, filled:document.querySelectorAll('.polaroid:not(.empty)').length,
      bg:(document.querySelector('.polaroid[data-pi="0"] img')||{}).src||''});
  })()`, true);
  const al = JSON.parse(album);
  ok('相册放进一张图后不再空白', al.ok && al.filled === 1, JSON.stringify(al));
  ok('相册显示的是快照（frames/ 副本）', /\/frames\/p1\.jpg/.test(al.bg), al.bg);

  await ev(`(async()=>{ const r = await window.planet.shelve(${JSON.stringify(PNG)}, 0); await refreshAll(); return r.ok; })()`, true);
  await sleep(500);
  const stillThere = JSON.parse(await ev(`JSON.stringify({
    filled:document.querySelectorAll('.polaroid:not(.empty)').length,
    onDesk:S.desktop.files.some(f=>f.name==='海边 #1.png'),
    books:document.querySelectorAll('.book').length
  })`));
  ok('原图收进书架后相册仍然显示（快照方案的分水岭）',
    stillThere.filled === 1 && !stillThere.onDesk && stillThere.books === 1, JSON.stringify(stillThere));

  const spine = JSON.parse(await ev(`JSON.stringify({
    name:(document.querySelector('.book .spine-name')||{}).textContent||'',
    len:Array.from((document.querySelector('.book .spine-name')||{}).textContent||'').length,
    full:(document.querySelector('.book')||{}).dataset.name||'',
    h:document.querySelector('.book').offsetHeight
  })`));
  ok('书脊上有竖排文件名（按整字数截断，全名留在提示里）',
    spine.full === '海边 #1.png' && spine.name === Array.from('海边 #1.png').slice(0, spine.len).join('') &&
    spine.len >= 4 && spine.len <= 6,
    JSON.stringify(spine));
  ok('资料书脊加高到至少 54px', spine.h >= 54, spine.h + 'px');

  // 书脊文字是 vertical-rl：用 Range 取第四个字的外框，和书脊文字框比较，
  // 比「看起来没被裁」可靠。另做一个 54px 的离屏探针，守住最矮的书也能放下四个字。
  const spineProbe = JSON.parse(await ev(`JSON.stringify((()=>{
    const b=document.createElement('div');
    b.className='book doc';
    b.style.cssText='position:fixed;left:-240px;top:0;width:22px;height:54px';
    const s=document.createElement('span'); s.className='spine-name'; s.textContent='四个字测';
    b.appendChild(s); document.body.appendChild(b);
    const sr=s.getBoundingClientRect();
    const t=s.firstChild; const r=document.createRange();
    r.setStart(t,3); r.setEnd(t,4);
    const cr=r.getBoundingClientRect();
    b.remove();
    return {h:Math.round(sr.height),ch4Bottom:Math.round(cr.bottom),
      spanBottom:Math.round(sr.bottom),inside:cr.bottom<=sr.bottom-1&&cr.top>=sr.top-1};
  })())`));
  ok('最矮 54px 的书脊也能完整放下第四个字',
    spineProbe.inside && spineProbe.ch4Bottom < spineProbe.spanBottom,
    JSON.stringify(spineProbe));

  const docGlyph = JSON.parse(await ev(`JSON.stringify((()=>{
    const el=document.querySelector('.book.doc .spine-name');
    const sr=el.getBoundingClientRect();
    const t=el.firstChild; const r=document.createRange();
    r.setStart(t,3); r.setEnd(t,4);
    const cr=r.getBoundingClientRect();
    return {ch4:Array.from(el.textContent)[3],inside:cr.bottom<=sr.bottom-1&&cr.top>=sr.top-1,
      ch4Bottom:Math.round(cr.bottom),spanBottom:Math.round(sr.bottom)};
  })())`));
  ok('实际书脊上前四个字都完整可见', docGlyph.inside,
    '第4字「' + docGlyph.ch4 + '」 ' + JSON.stringify(docGlyph));

  /* ---------- 书架：换层 / 拖出还原 / 打开不再被路径白名单挡住 ---------- */
  const bookId = await ev(`(async()=>{ const l=await window.planet.shelfList(); return (l.entries[0]||{}).id||''; })()`, true);
  const moved = await ev(`(async()=>{ const r=await window.planet.moveBook(${JSON.stringify(bookId)},3,0); await refreshAll(); return JSON.stringify(r); })()`, true);
  const mv = JSON.parse(moved);
  const rowNow = await ev(`(async()=>{ const l=await window.planet.shelfList(); return (l.entries.find(e=>e.id===${JSON.stringify(bookId)})||{}).row; })()`, true);
  ok('书脊换层只改元数据且落盘', mv.ok && rowNow === 3, 'row=' + rowNow);

  const openShelfFile = await ev(`(async()=>{ const l=await window.planet.shelfList(); const e=l.entries[0]; return JSON.stringify(await window.planet.copyPath(e.storedPath)); })()`, true);
  ok('书架原件的路径可被白名单接受（复制路径成功）', JSON.parse(openShelfFile).ok === true, openShelfFile);

  const restored = await ev(`(async()=>{ const r=await window.planet.restore(${JSON.stringify(bookId)}); await refreshAll(); return JSON.stringify({ok:r.ok, back:S.desktop.files.some(f=>f.name==='海边 #1.png'), books:document.querySelectorAll('.book').length}); })()`, true);
  const rs = JSON.parse(restored);
  ok('书脊还原回地毯', rs.ok && rs.back && rs.books === 0, JSON.stringify(rs));

  /* ---------- 普通文件夹：与资料同款竖排书脊（四字、无正面标签、无数量角标） ---------- */
  await ev(`(async()=>{ const r=await window.planet.shelve(${JSON.stringify(folder)},1); await refreshAll(); return r.ok; })()`, true);
  await sleep(450);
  const folderSpine = JSON.parse(await ev(`JSON.stringify((()=>{
    const box=document.querySelector('.book.box:not(.link)');
    if(!box) return {missing:true};
    const el=box.querySelector('.spine-name');
    const sr=el?el.getBoundingClientRect():null;
    let inside=false,ch4='';
    if(el&&el.firstChild){
      const t=el.firstChild; const r=document.createRange();
      const n=Math.min(3,t.length-1);
      ch4=Array.from(el.textContent)[3]||'';
      r.setStart(t,n); r.setEnd(t,n+1);
      const cr=r.getBoundingClientRect();
      inside=cr.bottom<=sr.bottom-1&&cr.top>=sr.top-1;
    }
    return {text:el?el.textContent:'',len:el?Array.from(el.textContent).length:0,
      wm:el?getComputedStyle(el).writingMode:'',inside,ch4,
      count:box.querySelector('.box-count')?1:0,label:box.querySelector('.box-label')?1:0,
      w:box.offsetWidth,h:box.offsetHeight,bg:getComputedStyle(box).backgroundImage};
  })())`));
  ok('文件夹改成资料同款竖排四字书脊、不再有正面标签与数量角标',
    folderSpine.text === '海边照片' && folderSpine.len === 4 && folderSpine.wm.indexOf('vertical') >= 0 &&
    folderSpine.count === 0 && folderSpine.label === 0,
    JSON.stringify(folderSpine));
  ok('文件夹书脊上的第四个字完整可见', folderSpine.inside,
    '第4字「' + folderSpine.ch4 + '」 ' + JSON.stringify(folderSpine));
  ok('文件夹书脊与资料同为窄高比例', folderSpine.w >= 23 && folderSpine.w <= 26 && folderSpine.h >= 56,
    folderSpine.w + '×' + folderSpine.h);

  /* ---------- 文件夹快捷方式：蓝灰书脊 + 竖排四个字，不显示数量 ---------- */
  await ev(`(async()=>{ const r=await window.planet.shelve(${JSON.stringify(path.join(desk, '资料快捷.url'))},2); await refreshAll(); return r.ok; })()`, true);
  await sleep(450);
  const linkSpine = JSON.parse(await ev(`JSON.stringify((()=>{
    const box=document.querySelector('.book.box.link');
    if(!box) return {missing:true};
    const el=box.querySelector('.spine-name');
    const sr=el?el.getBoundingClientRect():null;
    let inside=false,ch4='';
    if(el&&el.firstChild){
      const t=el.firstChild; const r=document.createRange();
      const n=Math.min(3, t.length-1);
      ch4=Array.from(el.textContent)[3]||'';
      r.setStart(t,n); r.setEnd(t,n+1);
      const cr=r.getBoundingClientRect();
      inside=cr.bottom<=sr.bottom-1&&cr.top>=sr.top-1;
    }
    return {text:el?el.textContent:'',len:el?Array.from(el.textContent).length:0,
      wm:el?getComputedStyle(el).writingMode:'',inside,ch4,
      count:box.querySelector('.box-count')?1:0,label:box.querySelector('.box-label')?1:0,
      w:box.offsetWidth,h:box.offsetHeight,bg:getComputedStyle(box).backgroundImage};
  })())`));
  ok('快捷方式改成竖排名字前四个字、不再显示数量',
    linkSpine.text === '资料快捷' && linkSpine.len === 4 && linkSpine.wm.indexOf('vertical') >= 0 &&
    linkSpine.count === 0 && linkSpine.label === 0,
    JSON.stringify(linkSpine));
  ok('快捷方式书脊上的四个字完整可见', linkSpine.inside,
    '第4字「' + linkSpine.ch4 + '」 ' + JSON.stringify(linkSpine));
  ok('快捷方式与文件夹同为窄高书脊', linkSpine.w >= 23 && linkSpine.w <= 26 && linkSpine.h >= 56,
    linkSpine.w + '×' + linkSpine.h);
  ok('文件夹与快捷方式仍是两种颜色（只靠配色区分类型）',
    !!folderSpine.bg && folderSpine.bg !== linkSpine.bg,
    folderSpine.bg.slice(0, 36) + ' vs ' + linkSpine.bg.slice(0, 36));
  const spineWeights = JSON.parse(await ev(`JSON.stringify((()=>{
    // 这一阶段书架上可能只剩文件夹/快捷方式：用离屏探针保证资料规则也能量到，
    // 测的是 CSS 规则本身，不依赖当时架上恰好有什么文件。
    const probe=document.createElement('div');
    probe.className='book doc';
    probe.style.cssText='position:absolute;left:-9999px;top:0;width:22px;height:66px';
    probe.innerHTML='<span class="spine-name">探</span>';
    document.body.appendChild(probe);
    const out=['.book.doc .spine-name',
      '.book.box:not(.link) .spine-name','.book.box.link .spine-name'].map(sel=>{
        const n=document.querySelector(sel); if(!n) return null;
        const cs=getComputedStyle(n); return {sel,fw:parseFloat(cs.fontWeight),color:cs.color};
      });
    probe.remove();
    return out;
  })())`));
  const darkInk = c => {
    const m = (String(c).match(/[\d.]+/g) || []).map(Number);
    return m.length >= 3 && (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 < 0.35;
  };
  ok('三类书脊统一深墨粗字（资料 / 文件夹 / 快捷方式）',
    spineWeights.length === 3 && spineWeights.every(x => x && x.fw >= 700 && darkInk(x.color)),
    JSON.stringify(spineWeights));

  await ev(`(async()=>{ const l=await window.planet.shelfList(); for(const e of l.entries) await window.planet.restore(e.id); await refreshAll(); return 1; })()`, true);
  await sleep(350);

  /* ---------- 点选模式：点一下选中，批量上架 ---------- */
  await ev(`localStorage.setItem('planet.shelfWarned','1'); 1`);
  await clickSel('#btnSelect');
  const selMode = JSON.parse(await ev(`JSON.stringify({on:document.body.classList.contains('selecting'),bar:getComputedStyle(document.querySelector('#selectbar')).opacity})`));
  ok('点选模式打开且批量条出现', selMode.on && Number(selMode.bar) > 0.5, JSON.stringify(selMode));

  const firstFile = await rectOf('.file');
  await mouse('mousePressed', firstFile.cx, firstFile.cy, 1);
  await mouse('mouseReleased', firstFile.cx, firstFile.cy, 0);
  await sleep(200);
  const selOne = JSON.parse(await ev(`JSON.stringify({sel:document.querySelectorAll('.file.sel').length,n:S.selected.size,count:document.querySelector('#selCount').textContent})`));
  ok('点一下选中一张', selOne.sel === 1 && selOne.n === 1 && selOne.count === '1', JSON.stringify(selOne));

  await clickSel('#btnShelveAll');
  await sleep(900);
  const batch = JSON.parse(await ev(`JSON.stringify({books:document.querySelectorAll('.book').length,files:document.querySelectorAll('.file').length,sel:S.selected.size})`));
  ok('批量上架后书架 +1、地毯 -1、选择清空', batch.books === 1 && batch.files === 9 && batch.sel === 0, JSON.stringify(batch));

  /* ---------- 真实拖拽：资料 → 书架第 5 层 ---------- */
  const dragFrom = await rectOf('.file');
  const row5 = await rectOf('.shelf__row[data-row="4"]');
  const beforeDrag = JSON.parse(await ev(`JSON.stringify({f:document.querySelectorAll('.file').length,b:document.querySelectorAll('.book').length})`));
  await dragTo(dragFrom, row5);
  const afterDrag = JSON.parse(await ev(`JSON.stringify({f:document.querySelectorAll('.file').length,b:document.querySelectorAll('.book').length,row:(()=>{const l=[...document.querySelectorAll('.book')].pop();return l?l.dataset.row:-1})()})`));
  ok('拖到第 5 层真的收纳（真移动 + 写盘）',
    afterDrag.f === beforeDrag.f - 1 && afterDrag.b === beforeDrag.b + 1, JSON.stringify(beforeDrag) + '→' + JSON.stringify(afterDrag));
  ok('落点层级正确（第 5 层）', Number(afterDrag.row) === 4, afterDrag.row);

  /* ---------- 拖书出书架 = 还原 ---------- */
  const bookRect = await rectOf('.book');
  const outside = { cx: 780, cy: 640 };
  const beforeRestore = JSON.parse(await ev(`JSON.stringify({f:document.querySelectorAll('.file').length,b:document.querySelectorAll('.book').length})`));
  await dragTo(bookRect, outside, 12);
  const afterRestore = JSON.parse(await ev(`JSON.stringify({f:document.querySelectorAll('.file').length,b:document.querySelectorAll('.book').length})`));
  ok('书脊拖出书架后还原到地毯',
    afterRestore.f === beforeRestore.f + 1 && afterRestore.b === beforeRestore.b - 1,
    JSON.stringify(beforeRestore) + '→' + JSON.stringify(afterRestore));

  /* ---------- 便签：删除 + 撤销 + 新增 ---------- */
  const del = await ev(`(async()=>{
    const b=document.querySelector('.todo:not(.add) .todo__del'); b.click();
    await new Promise(r=>setTimeout(r,150));
    return JSON.stringify({n:S.layout.todos.length,undo:!!document.querySelector('.toast__act')});
  })()`, true);
  const d1 = JSON.parse(del);
  ok('撕掉便签后条数减一且有撤销', d1.n === 4 && d1.undo, JSON.stringify(d1));

  await ev(`document.querySelector('.toast__act').click(); 1`);
  await sleep(200);
  const undone = JSON.parse(await ev(`JSON.stringify({n:S.layout.todos.length,text:document.querySelector('.todo__text').textContent})`));
  ok('撤销把便签插回原位', undone.n === 5, JSON.stringify(undone.n));

  const add = await ev(`(async()=>{
    document.querySelector('.todo.add').click();
    await new Promise(r=>setTimeout(r,220));
    const ta=document.querySelector('#todoText');
    ta.value='验证用的第三行\\n第二行';
    document.querySelector('#todoSave').click();
    await new Promise(r=>setTimeout(r,220));
    return JSON.stringify({n:S.layout.todos.length,txt:S.layout.todos[0].text});
  })()`, true);
  const ad = JSON.parse(add);
  ok('新增便签支持多行并写进 layout', ad.n === 6 && /\n/.test(ad.txt), JSON.stringify(ad).slice(0, 80));

  await sleep(700);
  const layoutDisk = JSON.parse(fs.readFileSync(path.join(data, 'layout.json'), 'utf8'));
  ok('便签与落点落盘（layout.json）', layoutDisk.todos.length === 6 && Object.keys(layoutDisk.filePos).length > 0,
    'todos=' + layoutDisk.todos.length + ' pos=' + Object.keys(layoutDisk.filePos).length);

  // 真拖拽归档：便签拖进糖果罐 → 确认 → 写 notes-archive.md → 删除
  const beforeArchive = Number(await ev(`S.layout.todos.length`));
  const todoRect = await rectOf('.todo:not(.add)');
  const binRect = await rectOf('#bin');
  await dragTo(todoRect, binRect, 14);
  await sleep(260);
  const askOpen = (await ev(`!document.querySelector('#modal').hidden`)) === true;
  if (askOpen) await ev(`document.querySelector('#askYes').click(); 1`);
  await sleep(700);
  const afterArchive = JSON.parse(await ev(`JSON.stringify({n:S.layout.todos.length,modal:!document.querySelector('#modal').hidden})`));
  ok('便签拖进糖果罐：确认后归档并删除',
    askOpen && afterArchive.n === beforeArchive - 1 && afterArchive.modal === false,
    beforeArchive + '→' + afterArchive.n + ' ask=' + askOpen);

  /* ---------- 唱片机三态 + 演示旋律 ---------- */
  const m1 = await ev(`(async()=>{ document.querySelector('#btnMode').click(); await new Promise(r=>setTimeout(r,120)); return document.querySelector('#btnMode').title; })()`, true);
  const m2 = await ev(`(async()=>{ document.querySelector('#btnMode').click(); await new Promise(r=>setTimeout(r,120)); return document.querySelector('#btnMode').title; })()`, true);
  const m3 = await ev(`(async()=>{ document.querySelector('#btnMode').click(); await new Promise(r=>setTimeout(r,120)); return document.querySelector('#btnMode').title; })()`, true);
  ok('模式按钮循环 播完即停 → 单曲循环 → 列表循环',
    /播完即停/.test(m1) && /单曲循环/.test(m2) && /列表循环/.test(m3), [m1, m2, m3].join(' | '));
  const audioDisk = JSON.parse(fs.readFileSync(path.join(data, 'audio.json'), 'utf8'));
  ok('模式写进 audio.json', audioDisk.mode === 'all', audioDisk.mode);

  const play = await ev(`(async()=>{
    document.querySelector('#btnPlay').click();
    await new Promise(r=>setTimeout(r,320));
    const a={spin:document.querySelector('#disc').classList.contains('spin'),label:document.querySelector('#btnPlay').textContent};
    document.querySelector('#btnPlay').click();
    await new Promise(r=>setTimeout(r,220));
    a.after=document.querySelector('#btnPlay').textContent;
    a.spinAfter=document.querySelector('#disc').classList.contains('spin');
    return JSON.stringify(a);
  })()`, true);
  const pl = JSON.parse(play);
  ok('没选 MP3 时点播放会跑演示旋律（唱片转起来）',
    pl.spin === true && pl.label === '暂停' && pl.after === '播放' && pl.spinAfter === false, JSON.stringify(pl));

  /* ---------- 我的电脑：快捷入口 / 屏保 ---------- */
  const pcRect = await rectOf('#pcGlass');
  await mouse('mousePressed', pcRect.cx, pcRect.cy, 1);
  await mouse('mouseReleased', pcRect.cx, pcRect.cy, 0);
  await sleep(420);
  const quick = JSON.parse(await ev(`JSON.stringify({open:!document.querySelector('#modal').hidden,n:document.querySelectorAll('#modal .quick').length})`));
  ok('点电脑弹出 6 个真实快捷入口', quick.open && quick.n === 6, JSON.stringify(quick));
  await ev(`document.querySelector('#qClose').click(); 1`);

  await ev(`document.querySelector('#zonePC').dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); 1`);
  const saver = JSON.parse(await ev(`JSON.stringify({saver:document.querySelector('#zonePC').classList.contains('saver'),msg:getComputedStyle(document.querySelector('#pcMsg')).display})`));
  ok('双击进入屏保（状态信息换成时间）', saver.saver && saver.msg !== 'none', JSON.stringify(saver));
  await ev(`document.querySelector('#zonePC').dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); 1`);

  /* ---------- 收纳记录 / 说明抽屉 ---------- */
  await clickSel('#btnJournal');
  ok('收纳记录能打开并列出条目', (await ev(`document.querySelectorAll('#modal .journal__row').length`)) > 0);

  await ev(`closeModal(); 1`);
  await sleep(220);
  await clickSel('#btnHelp');
  ok('说明抽屉能打开', (await ev(`document.querySelector('#drawer').classList.contains('on')`)) === true);
  await ev(`document.querySelector('#drawerClose').click(); 1`);

  /* ---------- 命中穿透：看得见的地方必须点得动 ---------- */
  await mouse('mouseMoved', 700, 50, 0);
  await sleep(160);
  const igEmpty = await ev('ignoring');
  const pillRect = await rectOf('#btnSelect');
  await mouse('mouseMoved', pillRect.cx, pillRect.cy, 0);
  await sleep(160);
  const igPill = await ev('ignoring');
  ok('顶栏空白处穿透、按钮处接管', igEmpty === true && igPill === false, '空=' + igEmpty + ' 按钮=' + igPill);

  const plusRect = await rectOf('#slotPlus');
  await mouse('mouseMoved', plusRect.cx, plusRect.cy, 0);
  await sleep(160);
  ok('展柜系列标签 / 加减位在命中区', (await ev('ignoring')) === false);

  await ev(`toast('命中测试',{label:'撤销',fn:()=>{}}); 1`);
  await sleep(180);
  const actRect = await rectOf('.toast__act');
  if (actRect) await mouse('mouseMoved', actRect.cx, actRect.cy, 0);
  await sleep(160);
  ok('toast 的撤销按钮在命中区', !!actRect && (await ev('ignoring')) === false);
  const toastPe = JSON.parse(await ev(`JSON.stringify({
    toast:getComputedStyle(document.querySelector('#toast')).pointerEvents,
    act:getComputedStyle(document.querySelector('.toast__act')).pointerEvents,
    under: (()=>{const b=document.querySelector('#btnShelveAll');const r=b.getBoundingClientRect();
      const e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return e?e.id||e.className:'';})()
  })`));
  ok('提示条本身不吃点击（不会压住批量条）',
    toastPe.toast === 'none' && toastPe.act === 'auto', JSON.stringify(toastPe));
  await ev('hideToast(); 1');

  await ev(`(()=>{const f=document.querySelector('.file');const r=f.getBoundingClientRect();
    f.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.left+8,clientY:r.top+8}));return 1;})()`);
  await sleep(180);
  const ctxRect = await rectOf('#ctx .ctx-item');
  if (ctxRect) await mouse('mouseMoved', ctxRect.cx, ctxRect.cy, 0);
  await sleep(160);
  ok('右键菜单本身在命中区', !!ctxRect && (await ev('ignoring')) === false);
  await ev('closeMenu(); 1');

  /* ---------- 系列名称可编辑 ---------- */
  await ev(`document.querySelector('#seriesTabs button[data-k="starman"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); 1`);
  await sleep(500);
  const renameOpen = (await ev(`!document.querySelector('#modal').hidden`)) === true;
  if (renameOpen) {
    await ev(`(()=>{const i=document.querySelector('#askInput'); i.value='我的星球';
      document.querySelector('#askYes').click(); return 1;})()`);
  }
  await sleep(700);
  const renamed = JSON.parse(await ev(`JSON.stringify({
    tab: document.querySelector('#seriesTabs button[data-k="starman"]').textContent,
    label: S.show.labels.starman || ''
  })`));
  const showLabelDisk = JSON.parse(fs.readFileSync(path.join(data, 'showcase.json'), 'utf8'));
  ok('双击系列标签可以改名并落盘',
    renameOpen && renamed.tab === '我的星球' && renamed.label === '我的星球' &&
    showLabelDisk.labels && showLabelDisk.labels.starman === '我的星球',
    JSON.stringify({ renameOpen, ...renamed }));

  await ev(`saveSeriesLabel('starman', null); 1`);
  await sleep(500);
  const nameBack = await ev(`document.querySelector('#seriesTabs button[data-k="starman"]').textContent`);
  ok('系列名可以恢复默认', nameBack === '星星人', nameBack);

  /* ---------- 底部应用坞：分栏收进右键菜单 + 拖动换栏 + 落盘 ---------- */
  ok('应用坞顶部不再有 2/3 栏按钮', (await ev(`!document.querySelector('#dockCols')`)) === true, 'dockCols 已移除');
  await ev(`(()=>{const n=document.querySelector('.dock__item');
    n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:120,clientY:120}));return 1;})()`);
  await sleep(120);
  await ev(`(()=>{const it=[...document.querySelectorAll('#ctx .ctx-item')].find(n=>n.textContent==='改为 2 栏');
    if(it) it.click(); return 1;})()`);
  await sleep(500);
  const two = JSON.parse(await ev(`JSON.stringify({
    cols:S.layout.dock.cols, groups:document.querySelectorAll('.dock__group').length,
    items:document.querySelectorAll('.dock__item').length,
    g:S.layout.dock.items.map(i=>i.g)
  })`));
  const disk2 = JSON.parse(fs.readFileSync(path.join(data, 'layout.json'), 'utf8'));
  ok('应用坞切到 2 栏、图标不丢、写入 layout.json',
    two.cols === 2 && two.groups === 2 && two.items === 6 &&
    two.g.every(g => g <= 1) && disk2.dock && disk2.dock.cols === 2,
    JSON.stringify(two) + ' / disk=' + (disk2.dock && disk2.dock.cols));

  const dockKey = await ev(`document.querySelector('.dock__item').dataset.key`);
  const dockSrc = await rectOf('.dock__item');
  const dockG1 = await rectOf('.dock__group[data-g="1"]');
  await dragTo(dockSrc, { cx: dockG1.l + 24, cy: dockG1.t + 34 }, 12);
  const dockMoved = JSON.parse(await ev(`JSON.stringify({
    g:(S.layout.dock.items.find(i=>i.key===${JSON.stringify(dockKey)})||{}).g,
    dom:document.querySelectorAll('.dock__item').length
  })`));
  const disk3 = JSON.parse(fs.readFileSync(path.join(data, 'layout.json'), 'utf8'));
  ok('拖动应用图标换栏并落盘',
    dockMoved.g === 1 && dockMoved.dom === 6 &&
    disk3.dock.items.some(i => i.key === dockKey && i.g === 1),
    'g=' + dockMoved.g + ' / dom=' + dockMoved.dom);

  await ev(`(()=>{const n=document.querySelector('.dock__item');
    n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:120,clientY:120}));return 1;})()`);
  await sleep(120);
  await ev(`(()=>{const it=[...document.querySelectorAll('#ctx .ctx-item')].find(n=>n.textContent==='改为 3 栏');
    if(it) it.click(); return 1;})()`);
  await sleep(500);
  const three = JSON.parse(await ev(`JSON.stringify({
    cols:S.layout.dock.cols, groups:document.querySelectorAll('.dock__group').length,
    items:document.querySelectorAll('.dock__item').length,
    menuHasCols:true
  })`));
  ok('应用坞切回 3 栏', three.cols === 3 && three.groups === 3 && three.items === 6, JSON.stringify(three));

  // 移栏菜单同样不带分类暗示：只报「第 N 栏」，用户自行决定每栏放什么
  await ev(`(()=>{const n=document.querySelector('.dock__item');
    n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:120,clientY:120}));return 1;})()`);
  const dockMenuLabels = JSON.parse(await ev(`JSON.stringify(
    [...document.querySelectorAll('#ctx .ctx-item')].map(n=>n.textContent))`));
  ok('右键移栏只用中性栏号、不带分类名',
    dockMenuLabels.filter(x => /^移到第 \d 栏$/.test(x)).length === dock0.cols &&
    !dockMenuLabels.some(x => /工作|工具|娱乐|常用|其他/.test(x)),
    dockMenuLabels.join(' | '));
  await ev(`closeMenu(); refreshIgnore(); 1`);

  /* ---------- 16:9 画布横向展开 ---------- */
  // 截图前收干净：关掉点选模式、隐藏临时提示、把测试用的纯色图移出展柜
  await ev(`(async()=>{
    hideToast(); hideTip();
    if (S.selectMode) toggleSelectMode(false);
    for (const i of [0, 1]) {
      const r = await window.planet.figureClear(i);
      if (r.ok) S.show = r.showcase;
    }
    renderShow();
    // 应用坞恢复成三栏均分，避免测试过程的换栏状态带进成品截图
    S.layout.dock.items = PM.reconcileDock([], S.apps.map(a => a.path), 3);
    S.layout.dock.cols = 3;
    renderDock();
    saveLayout();
    return 1;
  })()`, true);
  await sleep(400);
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  const wide = JSON.parse(await ev(`JSON.stringify((()=>{
    const r=document.querySelector('#app').getBoundingClientRect();
    return {stageW:S.stageW, midW:document.querySelector('#zoneShow').offsetWidth,
      caseW:document.querySelector('.case').offsetWidth, w:r.width, gap:innerHeight-r.bottom,
      iw:innerWidth};
  })())`));
  ok('1920×1080 下画布展开到 1671、中间展柜 709、几乎铺满宽度',
    wide.stageW === 1671 && wide.midW === 709 && wide.caseW === 1619 &&
    wide.w > 1855 && wide.gap >= 24,
    JSON.stringify(wide));
  const shot1920 = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (shot1920.result && shot1920.result.data) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'planet-theme-1920.png'), Buffer.from(shot1920.result.data, 'base64'));
    stage('16:9 截图 docs/planet-theme-1920.png');
  }

  /* ---------- 分辨率档位（模拟 2560×1440 屏） ---------- */
  await send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await ev(`window.planet.setDisplay('fhd')`, true);
  await sleep(500);
  const dFhd = JSON.parse(await ev(`JSON.stringify((()=>{
    const r=document.querySelector('#app').getBoundingClientRect();
    const m=getComputedStyle(document.querySelector('#app')).transform;
    return {preset:S.display.preset, scale:parseFloat(m.split(',')[0].replace('matrix(','')),
      w:r.width,h:r.height,gap:innerHeight-r.bottom,iw:innerWidth,ih:innerHeight};
  })())`));
  ok('托盘 1080p 档在 2K 屏上给出 1920×1080 的画面块',
    dFhd.preset === 'fhd' && Math.abs(dFhd.scale - 1080 / 940) < 0.01 &&
    Math.abs(dFhd.h - 1080) < 2 && Math.abs(dFhd.w - 1920) < 4,
    JSON.stringify(dFhd));
  const displayDisk = JSON.parse(fs.readFileSync(path.join(data, 'display.json'), 'utf8'));
  ok('画面档位写进 display.json', displayDisk.preset === 'fhd', displayDisk.preset);

  await ev(`window.planet.setDisplay('auto')`, true);
  await sleep(500);
  const dAuto = JSON.parse(await ev(`JSON.stringify((()=>{
    const r=document.querySelector('#app').getBoundingClientRect();
    const m=getComputedStyle(document.querySelector('#app')).transform;
    return {preset:S.display.preset, scale:parseFloat(m.split(',')[0].replace('matrix(','')),
      h:r.height,gap:innerHeight-r.bottom};
  })())`));
  ok('自动档铺满可用高度并保留底部安全间距',
    dAuto.preset === 'auto' && dAuto.gap >= 40 && Math.abs(dAuto.scale - (1440 - dAuto.gap) / 940) < 0.01,
    JSON.stringify(dAuto));

  /* ---------- 3120×2080 上限 ---------- */
  await send('Emulation.setDeviceMetricsOverride', { width: 3120, height: 2080, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const maxFit = JSON.parse(await ev(`JSON.stringify((()=>{
    const r=document.querySelector('#app').getBoundingClientRect();
    return {stageW:S.stageW, w:r.width, h:r.height, gap:innerHeight-r.bottom, iw:innerWidth, ih:innerHeight};
  })())`));
  ok('3120×2080 下柜体不溢出、仍保留底部安全间距',
    maxFit.stageW === 1440 && maxFit.w <= maxFit.iw && maxFit.h <= maxFit.ih &&
    maxFit.gap >= 50 && maxFit.w > 3050,
    JSON.stringify(maxFit));

  /* ---------- 不同格式资料：统一高度、统一文字起笔 ----------
     以效果图里「春夏秋冬备忘」那本（66px / 六字）为基准；特别覆盖数字混排的
     「2026年度计划.xlsx」——mixed 排版下数字横躺会把整段文字压短，起笔最容易跑偏。 */
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);
  await ev(`window.planet.setDisplay('auto')`, true);
  await sleep(300);
  await ev(`window.planet.restoreAll()`, true);
  const fmtExtra = ['春夏秋冬备忘.md', '2026年度计划.xlsx'];
  for (const n of fmtExtra) fs.writeFileSync(path.join(desk, n), 'spine verify\n');
  const fmtNames = ['日报.txt', '需求.docx', '预算.xlsx', '汇报.pptx', '备忘.md', '报告.pdf', ...fmtExtra];
  const fmtPaths = fmtNames.map(n => path.join(desk, n));
  await ev(`(async()=>{ const ps=${JSON.stringify(fmtPaths)};
    for (let i=0;i<ps.length;i++) await window.planet.shelve(ps[i], i%5);
    await refreshAll(); return 'ok'; })()`, true);
  await sleep(400);
  const fmtSpines = JSON.parse(await ev(`JSON.stringify((()=>{
    const lumHex=h=>{const v=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255)
      .map(c=>c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4));
      return .2126*v[0]+.7152*v[1]+.0722*v[2];};
    const lumRgb=s=>{const v=(s.match(/[\\d.]+/g)||[]).map(Number).slice(0,3).map(c=>c/255)
      .map(c=>c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4));
      return .2126*v[0]+.7152*v[1]+.0722*v[2];};
    const contrastOf=(a,b)=>{const v=[a,b].sort((x,y)=>y-x);
      return +((v[0]+.05)/(v[1]+.05)).toFixed(2);};
    return [...document.querySelectorAll('.book.doc')].map(b=>{
      const s=b.querySelector('.spine-name'); if(!s||!s.firstChild) return null;
      const br=b.getBoundingClientRect();
      const r=document.createRange(); r.setStart(s.firstChild,0); r.setEnd(s.firstChild,1);
      const cr=r.getBoundingClientRect();
      const cs=getComputedStyle(s);
      const light=(b.style.getPropertyValue('--ink-light')||'#EDE3F2').trim();
      const ink=(b.style.getPropertyValue('--ink')||'').trim();
      const tl=lumRgb(cs.color);
      return {name:b.dataset.name, row:Number(b.dataset.row), text:s.textContent,
        h:Math.round(b.offsetHeight), top:+br.top.toFixed(2), gap:+(cr.top-br.top).toFixed(2),
        orient:cs.textOrientation, light, ink, fg:cs.color, fw:parseFloat(cs.fontWeight),
        textLum:+tl.toFixed(3), contrast:contrastOf(lumHex(light),tl),
        overflow:s.scrollHeight-s.clientHeight, chars:Array.from(s.textContent).length};
    }).filter(Boolean);
  })())`));
  const fmtBrief = fmtSpines.map(x => x.name + ':' + x.h + 'px/起笔' + x.gap).join(' | ');
  ok('不同格式资料的书脊统一为 66px（春夏秋冬备忘那本的高度）',
    fmtSpines.length >= 8 && fmtSpines.every(x => x.h === 66), fmtBrief);
  const gapSpread = fmtSpines.length ? Math.max(...fmtSpines.map(x => x.gap)) - Math.min(...fmtSpines.map(x => x.gap)) : 999;
  ok('不同格式资料的第一个字起笔高度一致（含数字混排 2026）',
    gapSpread <= 1.5, '最大差 ' + gapSpread.toFixed(2) + 'px / ' + fmtBrief);
  const rowTops = {};
  for (const x of fmtSpines) (rowTops[x.row] = rowTops[x.row] || []).push(x.top);
  const topSpread = Math.max(...Object.values(rowTops).map(ts => Math.max(...ts) - Math.min(...ts)), 0);
  ok('同层书脊顶边齐平', topSpread <= 1, '最大差 ' + topSpread.toFixed(2) + 'px');
  ok('数字/英文 upright 整字排列，六字书脊不裁字',
    fmtSpines.every(x => x.orient === 'upright' && x.overflow <= 0 && x.chars <= 6),
    fmtSpines.map(x => x.text + ':' + x.orient + '/' + x.overflow).join(' | '));
  ok('资料书脊改成深墨粗字（不再是白细字）',
    fmtSpines.length >= 8 && fmtSpines.every(x => x.fw >= 700 && x.textLum < 0.12),
    fmtSpines.map(x => x.fg + '/' + x.fw).join(' | '));
  ok('浅彩底与深墨字对比度 ≥4.5（所有格式）',
    fmtSpines.every(x => x.contrast >= 4.5),
    fmtSpines.map(x => x.light + ':' + x.contrast).join(' | '));
  ok('底色浅化后仍按格式配色，两侧立边保留原色',
    new Set(fmtSpines.map(x => x.light)).size >= 5 &&
    fmtSpines.every(x => x.ink && x.light && x.ink.toUpperCase() !== x.light.toUpperCase()),
    [...new Set(fmtSpines.map(x => x.light))].join(',') + ' / 原色 ' +
    [...new Set(fmtSpines.map(x => x.ink))].join(','));

  /* ---------- 零报错与结果 ---------- */
  ok('页面零报错', pageErrors.length === 0, pageErrors.join(' | ') || 'none');

  const noteFile = path.join(data, 'notes-archive.md');
let noteText = '';
try { noteText = fs.readFileSync(noteFile, 'utf8'); } catch (e) {}
ok('便签归档写进 notes-archive.md', fs.existsSync(noteFile) && noteText.indexOf('验证用的第三行') >= 0,
  noteText.length + ' chars');

const pass = checks.filter(c => c.pass).length;
  console.log('PASS ' + pass + ' / FAIL ' + (checks.length - pass) + '  (共 ' + checks.length + ')');
  for (const c of checks) console.log((c.pass ? 'OK   ' : 'FAIL ') + c.name + (c.extra ? ' :: ' + c.extra : ''));
  fs.writeFileSync(path.join(LOG_DIR, 'planet-验证结果.json'), JSON.stringify({
    at: new Date().toISOString(), total: checks.length, pass, fail: checks.length - pass,
    pageErrors, checks,
  }, null, 2), 'utf8');
  if (checks.length - pass > 0) console.log('[MAINLOG] ' + mainLog.join('').slice(-1500));
} catch (e) {
  console.error('[FAIL]', (e && e.stack) || String(e));
  console.log('[MAINLOG]', mainLog.join('').slice(-2500));
} finally {
  try { ws && ws.close(); } catch (e) {}
  setTimeout(() => { try { child.kill(); } catch (e) {} }, 400);
  setTimeout(() => {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (e) {}
    process.exit(0);
  }, 1100);
}
