// planet/main.js —— 糖绒星球：桌面层窗口 + 本地文件桥
// 与 room/main.js 同一套桌面层机制；收纳引擎、播放状态机、窗口层级直接复用 room/ 的同一份代码。
const { app, BrowserWindow, screen, ipcMain, shell, Menu, Tray, nativeImage, protocol, net, dialog, clipboard } = require('electron');

// 桌面层窗口永远 focusable:false 且被钉在最底层，Windows 的原生遮挡检测
// （CalculateNativeWinOcclusion）会把它判为「不可见」，从而暂停 GIF 动图与动画。
// 这里关掉遮挡检测与后台节流，保证展柜里的 GIF 始终在动。
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { Store } = require('../room/store');
const { PlayerState, MODES, isAudioPathAllowed } = require('../room/player-state');
const { DISPLAY_PRESETS } = require('./model');
const { pathToFileURL } = require('node:url');

const MODE = (process.env.PLANET_MODE || 'desktop').toLowerCase();
const REASSERT_MS = Number(process.env.PLANET_REASSERT_MS || 800);
const DESKTOP = process.env.XOME_TEST_DESKTOP || path.join(os.homedir(), 'Desktop');
// 书架不再把文件搬进 %APPDATA%，而是放在桌面上的一个真实文件夹里：
// App 退出时整个目录「解散」回桌面原位，启动时再收回来，文件始终留在中国桌面盘上。
const SHELF_FOLDER = '糖绒星球书架';
const SHELF_DIR = path.join(DESKTOP, SHELF_FOLDER);
const DATA_DIR = process.env.XOME_TEST_DATA || path.join(app.getPath('appData'), 'xome-planet');
const LAYOUT_FILE = path.join(DATA_DIR, 'layout.json');
const AUDIO_FILE = path.join(DATA_DIR, 'audio.json');
const FRAMES_FILE = path.join(DATA_DIR, 'frames.json');
const FRAMES_DIR = path.join(DATA_DIR, 'frames');
const FIGURES_FILE = path.join(DATA_DIR, 'showcase.json');
const FIGURES_DIR = path.join(DATA_DIR, 'figures');
const NOTES_ARCHIVE = path.join(DATA_DIR, 'notes-archive.md');
const DISPLAY_FILE = path.join(DATA_DIR, 'display.json');
const PID_FILE = path.join(DATA_DIR, 'app.pid');

/* 正式版单实例：重复双击只唤出已有窗口。
   测试沙箱（XOME_TEST_DATA）不锁，方便并行跑验证。 */
const GOT_LOCK = process.env.XOME_TEST_DATA ? true : app.requestSingleInstanceLock();
if (!GOT_LOCK) app.quit();

let win = null;
let hwnd = 0;
let timer = null;
let watcher = null;
let win32 = null;
let store = null;
let tray = null;
let audioDir = null;

try { win32 = require('../room/win32'); } catch (e) { console.warn('[planet] win32 不可用：' + e.message); }

// 唱片机：本地 MP3 走受控协议。必须在 app ready 之前注册且只注册一次；
// stream:true 是 <audio> 能流式播放和拖动进度的前提。
protocol.registerSchemesAsPrivileged([{
  scheme: 'xome-planet-audio',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

/* 相册与展柜都只认白名单内的图片扩展名，其余一律不算图片。
   这是解码 / 存储能力的代码限制，不是「支持哪些格式」的清单。 */
const ALBUM_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'];
const ALBUM_SET = new Set(ALBUM_EXT);
// 展柜只收透明底的 PNG / GIF：GIF 不转码，动效原样保留（代码限制，单张 ≤ 5MB）
const FIGURE_EXT = new Set(['.png', '.gif']);
const FIGURE_MAX = 5 * 1024 * 1024;
const ALBUM_IDS = ['p1', 'p2', 'p3', 'p4'];   // 代码限制：相册 4 格
const SKIP = new Set(['desktop.ini', 'thumbs.db']);

/* ---------------- 通用读写 ---------------- */

function readJson(file, fallback) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' ? raw : fallback;
  } catch (e) { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/* ---------------- 画面适配档位 ---------------- */

function readDisplay() {
  const d = readJson(DISPLAY_FILE, {});
  return { preset: DISPLAY_PRESETS[d.preset] ? d.preset : 'auto' };
}

function writeDisplay(preset) {
  writeJson(DISPLAY_FILE, { preset });
  return { preset };
}

/** 托盘「画面适配」或渲染进程调用同一条路径：写盘 → 通知窗口 → 重刷菜单勾选 */
function applyDisplayPreset(preset) {
  if (!DISPLAY_PRESETS[preset]) return { ok: false, error: '未知的画面档位' };
  const display = writeDisplay(preset);
  if (win && !win.isDestroyed()) win.webContents.send('planet:display', display);
  if (tray) tray.setContextMenu(buildTrayMenu());
  return { ok: true, display };
}

/* ---------------- 布局：便签、地毯落点 ---------------- */

function defaultLayout() {
  // 首启给几张示例便签，方便一眼看懂「点开能改、做完就撕」；删掉不会再长回来。
  return {
    version: 1,
    todos: [
      { id: 't1', text: '给绿植浇水\n顺便擦擦叶子', rot: -1.4 },
      { id: 't2', text: '挑一张新照片\n挂进拍立得', rot: 1.1 },
      { id: 't3', text: '整理地毯上散乱的资料', rot: -0.8 },
      { id: 't4', text: '给展柜换一套系列灯光', rot: 0.9 },
      { id: 't5', text: '把歌单补齐', rot: 0.6 },
    ],
    filePos: {},
    dock: { cols: 3, items: [] },
  };
}

function readLayout() {
  const l = readJson(LAYOUT_FILE, null);
  if (!l) return defaultLayout();
  if (!Array.isArray(l.todos)) l.todos = [];
  if (!l.filePos || typeof l.filePos !== 'object') l.filePos = {};
  // 应用坞：只接受 2/3 栏与 {key,g,o}；越界值在这里再夹一次
  const dock = l.dock && typeof l.dock === 'object' ? l.dock : {};
  const cols = Number(dock.cols) === 2 ? 2 : 3;
  const items = Array.isArray(dock.items) ? dock.items.slice(0, 300).reduce((out, it) => {
    const key = String((it && it.key) || '');
    if (!key || out.some(x => x.key === key)) return out;
    out.push({
      key,
      g: Math.max(0, Math.min(cols - 1, Math.round(Number(it.g) || 0))),
      o: Math.max(0, Math.round(Number(it.o) || 0)),
    });
    return out;
  }, []) : [];
  l.dock = { cols, items };
  return l;
}

/* ---------------- 桌面扫描 ---------------- */

/** 指向本应用自己的快捷方式：不进应用坞，也不落地毯（从主题里再启动主题没有意义） */
function isSelfShortcut(p) {
  try {
    if (/\.exe$/i.test(p)) {
      return path.resolve(p).toLowerCase() === path.resolve(process.execPath).toLowerCase();
    }
    if (!/\.lnk$/i.test(p)) return false;
    const d = shell.readShortcutLink(p);
    const t = d && d.target;
    return !!t && path.resolve(t).toLowerCase() === path.resolve(process.execPath).toLowerCase();
  } catch (e) { return false; }
}

function listDesktop() {
  let names = [];
  try { names = fs.readdirSync(DESKTOP, { withFileTypes: true }); } catch (e) { return { files: [] }; }
  const files = [];
  for (const d of names) {
    if (SKIP.has(d.name.toLowerCase()) || d.name.startsWith('.')) continue;
    if (d.name === SHELF_FOLDER) continue;   // 虚拟书架目录只给收纳用，不在地毯上重复出现
    const full = path.join(DESKTOP, d.name);
    let st;
    try { st = fs.statSync(full); } catch (e) { continue; }
    files.push({
      name: d.name, path: full, dir: d.isDirectory(),
      ext: path.extname(d.name).toLowerCase(),
      linkDir: /\.(lnk|url)$/i.test(d.name) ? linkTargetIsDir(full) : false,
      self: isSelfShortcut(full),
      size: st.size, mtime: st.mtimeMs,
    });
  }
  files.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return { files };
}

function insideRoot(root, p) {
  if (!root || !p) return false;
  const rel = path.relative(root, path.resolve(String(p)));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const insideDesktop = p => insideRoot(DESKTOP, p);
const insideShelf = p => !!store && insideRoot(store.shelfDir, p);
/** 桌面文件与书架原件都允许被打开 / 定位 / 删除；其它路径一律拒绝 */
const insideKnown = p => insideDesktop(p) || insideShelf(p) ||
  (!!store && store.entries().some(e => e.storedPath &&
    path.resolve(e.storedPath).toLowerCase() === path.resolve(String(p)).toLowerCase()));

/* ---------------- 窗口 ---------------- */

function screenInfo() {
  const d = screen.getPrimaryDisplay();
  return {
    w: d.workArea.width, h: d.workArea.height, scale: d.scaleFactor,
    bounds: d.bounds, workArea: d.workArea,
    monitors: screen.getAllDisplays().length,
    aspect: +(d.workArea.width / d.workArea.height).toFixed(3),
  };
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    x: area.x, y: area.y, width: area.width, height: area.height,
    transparent: true, frame: false, hasShadow: false,
    resizable: true, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, focusable: false, skipTaskbar: true, show: false,
    type: 'toolbar', backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      additionalArguments: process.env.PLANET_SELFTEST === '1' ? ['--planet-selftest'] : [],
    },
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => {
    win.showInactive();
    setTimeout(applyZOrder, 150);
  });
  win.setIgnoreMouseEvents(true, { forward: true });

  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.log(`[renderer:${level}] ${message}  (${source}:${line})`);
  });
  win.webContents.on('preload-error', (_e, p, err) => console.log('[preload-error]', p, err.message));
  win.webContents.on('did-fail-load', (_e, code, desc) => console.log('[did-fail-load]', code, desc));
  win.on('resize', () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('planet:screen', screenInfo());
  });
}

function applyZOrder() {
  if (process.env.XOME_TEST_NO_PIN) return;
  if (!win || win.isDestroyed() || !win32) return;
  try {
    hwnd = win32.hwndOf(win);
    if (MODE === 'top') { win.setAlwaysOnTop(true, 'screen-saver'); return; }
    win32.pinAboveDesktop(hwnd);
  } catch (e) { /* 单次失败忽略，下一次定时重锚 */ }
}

/* ---------------- 初始化 / 桌面 ---------------- */

ipcMain.handle('planet:init', () => ({
  version: app.getVersion(),
  layout: readLayout(),
  desktop: listDesktop(),
  shelf: store.entries(),
  shelfAudit: store.audit(),
  screen: screenInfo(),
  album: albumView(readFrames()),
  albumExts: ALBUM_EXT.slice(),
  showcase: showView(readShow()),
  audio: Object.assign(readAudioState(), { files: listMp3(audioDir) }),
  display: Object.assign(readDisplay(), { presets: DISPLAY_PRESETS }),
  pc: pcStats(),
  place: { desktop: DESKTOP, data: DATA_DIR },
  dataDir: DATA_DIR,
  shelfDir: store.shelfDir,
  journalFile: store.journalFile,
  mode: MODE,
}));

ipcMain.handle('planet:refresh', () => listDesktop());

ipcMain.handle('planet:save-layout', (_e, layout) => {
  try {
    const l = layout && typeof layout === 'object' ? layout : {};
    const dock = l.dock && typeof l.dock === 'object' ? l.dock : {};
    const cols = Number(dock.cols) === 2 ? 2 : 3;
    const items = Array.isArray(dock.items) ? dock.items.slice(0, 300).reduce((out, it) => {
      const key = String((it && it.key) || '');
      if (!key || out.some(x => x.key === key)) return out;
      out.push({
        key,
        g: Math.max(0, Math.min(cols - 1, Math.round(Number(it.g) || 0))),
        o: Math.max(0, Math.round(Number(it.o) || 0)),
      });
      return out;
    }, []) : [];
    writeJson(LAYOUT_FILE, {
      version: 1,
      todos: Array.isArray(l.todos) ? l.todos.slice(0, 200) : [],
      filePos: l.filePos && typeof l.filePos === 'object' ? l.filePos : {},
      dock: { cols, items },
    });
    return { ok: true, file: LAYOUT_FILE };
  } catch (e) { return { ok: false, error: e.message }; }
});

/* ---------------- 文件操作 ---------------- */

ipcMain.handle('planet:open', (_e, p) => {
  if (!insideKnown(p)) return { ok: false, error: '只允许打开桌面或书架里的文件' };
  return shell.openPath(p).then(err => (err ? { ok: false, error: err } : { ok: true }));
});

ipcMain.handle('planet:reveal', (_e, p) => {
  if (!insideKnown(p)) return { ok: false };
  shell.showItemInFolder(p);
  return { ok: true };
});

ipcMain.handle('planet:trash', async (_e, p) => {
  if (!insideKnown(p)) return { ok: false, error: '只允许删除桌面或书架里的文件' };
  try { await shell.trashItem(p); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('planet:rename', (_e, p, nextName) => {
  if (!insideDesktop(p)) return { ok: false, error: '只允许改名桌面上的文件' };
  const clean = String(nextName || '').replace(/[\\/:*?"<>|]/g, '').trim();
  if (!clean) return { ok: false, error: '名字不能为空' };
  const target = path.join(path.dirname(p), clean);
  if (fs.existsSync(target)) return { ok: false, error: '同名文件已存在' };
  try { fs.renameSync(p, target); return { ok: true, path: target }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('planet:copy-path', (_e, p) => {
  if (!insideKnown(p)) return { ok: false, error: '只能复制桌面或书架里的路径' };
  clipboard.writeText(p);
  return { ok: true };
});

ipcMain.handle('planet:open-trash', () => shell.openPath('shell:RecycleBinFolder'));

/** 便签拖进糖果罐：落一份 Markdown 归档，不直接蒸发 */
ipcMain.handle('planet:archive-note', (_e, text) => {
  const t = String(text || '').trim();
  if (!t) return { ok: false, error: '便签是空的' };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const block = `\n## ${new Date().toLocaleString('zh-CN')}\n\n${t}\n`;
    fs.appendFileSync(NOTES_ARCHIVE, block, 'utf8');
    return { ok: true, file: NOTES_ARCHIVE };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('planet:open-notes-archive', () => {
  if (!fs.existsSync(NOTES_ARCHIVE)) return { ok: false, error: '还没有归档的便签' };
  return shell.openPath(NOTES_ARCHIVE).then(err => (err ? { ok: false, error: err } : { ok: true }));
});

/* ---------------- 系统图标 ---------------- */

const iconCache = new Map();

/** 应用数据 / 程序目录：这些目录里的「文件夹快捷方式」其实还是应用入口，进坞而不是书架 */
const APP_DIRS = [process.env.APPDATA, process.env.LOCALAPPDATA, process.env.PROGRAMDATA,
  process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
  .filter(Boolean).map(p => path.resolve(p).toLowerCase());
// 临时目录不是「应用目录」：测试沙箱、解压出来的资料夹都在这里，仍按文件夹快捷方式处理
const TEMP_DIRS = [os.tmpdir(), process.env.TEMP, process.env.TMP]
  .filter(Boolean).map(p => path.resolve(p).toLowerCase());
const under = (low, dirs) => dirs.some(d => low === d || low.startsWith(d + path.sep));
function inAppDirs(p) {
  const low = path.resolve(String(p || '')).toLowerCase();
  return under(low, APP_DIRS) && !under(low, TEMP_DIRS);
}

/** 快捷方式里「显式指定」的图标：文件 + 索引（索引可为负 = 资源 ID）。
    这是应用作者真正指定的图标，优先级最高；旧实现把它拆掉只用 0 号图标，
    当索引不为 0 时就会取到空白/通用图标。 */
function shortcutIconSpec(p) {
  try {
    if (/\.lnk$/i.test(p)) {
      const d = shell.readShortcutLink(p);
      if (d && d.icon && String(d.icon).trim()) {
        const raw = String(d.icon).trim();
        const m = /^(.*?),\s*(-?\d+)\s*$/.exec(raw);
        const file = (m ? m[1] : raw).replace(/^"|"$/g, '').trim();
        return file ? { file, index: m ? Number(m[2]) : 0 } : null;
      }
    } else if (/\.url$/i.test(p)) {
      const body = fs.readFileSync(p, 'utf8');
      const f = /^IconFile\s*=\s*(.+)$/im.exec(body);
      if (f && f[1].trim()) {
        const i = /^IconIndex\s*=\s*(-?\d+)\s*$/im.exec(body);
        return { file: f[1].trim().replace(/^"|"$/g, ''), index: i ? Number(i[1]) : 0 };
      }
    }
  } catch (e) {}
  return null;
}

/** 高分辨率图标来源：优先快捷方式显式图标；否则用 .lnk 目标 exe 的 0 号图标。
    排除 explorer.exe（UWP 应用的目标），否则会拿成资源管理器图标。 */
function psIconSource(p) {
  const spec = shortcutIconSpec(p);
  if (spec) return spec;
  try {
    if (/\.lnk$/i.test(p)) {
      const d = shell.readShortcutLink(p);
      const t = d && d.target;
      if (t && /\.(exe|dll|ico)$/i.test(t) && !/[\\/]explorer\.exe$/i.test(t)) {
        return { file: t, index: 0 };
      }
    }
  } catch (e) {}
  return null;
}

/** 批量调用 PowerShell 的 PrivateExtractIconsW，按索引取 256px 图标（失败逐级降到 16px）。
    返回 { id: 'data:image/png;base64,...' | '' }，空图/失败为 ''。 */
let psIconSeq = 0;
function psExtractIcons(items) {
  return new Promise(resolve => {
    if (!Array.isArray(items) || !items.length) return resolve({});
    const base = path.join(os.tmpdir(), 'planet_icon_' + process.pid + '_' + (++psIconSeq));
    const inFile = base + '_in.json';
    const outFile = base + '_out.json';
    try { fs.writeFileSync(inFile, JSON.stringify(items), 'utf8'); } catch (e) { return resolve({}); }
    const ps1 = path.join(__dirname, 'assets', 'icon-extract.ps1');
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-InFile', inFile, '-OutFile', outFile],
      { windowsHide: true, timeout: 25000 },
      () => {
        const map = {};
        try {
          const raw = fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, '');
          const obj = JSON.parse(raw);
          for (const it of items) {
            const b64 = obj[it.id];
            map[it.id] = (b64 && String(b64).length > 700) ? 'data:image/png;base64,' + b64 : '';
          }
        } catch (e) { for (const it of items) map[it.id] = ''; }
        try { fs.unlinkSync(inFile); } catch (e) {}
        try { fs.unlinkSync(outFile); } catch (e) {}
        resolve(map);
      });
  });
}

/** getFileIcon 候选链：解析 .lnk 目标/嵌套，.url 的 IconFile，最后退回文件本身。
    作为兜底（32px），也负责普通文件的图标。 */
async function iconFallback(p) {
  const candidates = [];
  const stripIndex = v => String(v || '').replace(/^"|"$/g, '').replace(/,\s*-?\d+$/, '');
  try {
    if (/\.lnk$/i.test(p)) {
      let d = null;
      try { d = shell.readShortcutLink(p); } catch (e) {}
      if (d) {
        if (d.icon) candidates.push(stripIndex(d.icon));
        if (d.target) candidates.push(d.target);
        if (d.target && /\.lnk$/i.test(d.target)) {
          try {
            const d2 = shell.readShortcutLink(d.target);
            if (d2 && d2.icon) candidates.push(stripIndex(d2.icon));
            if (d2 && d2.target) candidates.push(d2.target);
          } catch (e) {}
        }
      }
    } else if (/\.url$/i.test(p)) {
      try {
        const m = /^IconFile\s*=\s*(.+)$/im.exec(fs.readFileSync(p, 'utf8'));
        if (m && m[1].trim()) candidates.push(stripIndex(m[1].trim()));
      } catch (e) {}
    }
  } catch (e) {}
  candidates.push(p);
  for (const c of candidates) {
    if (!c) continue;
    try {
      const img = await app.getFileIcon(c, { size: 'large' });
      if (img && !img.isEmpty()) return img.toDataURL();
    } catch (e) { /* 换下一个候选 */ }
  }
  return '';
}

ipcMain.handle('planet:icons', async (_e, paths) => {
  const list = (Array.isArray(paths) ? paths : []).slice(0, 300);
  const out = {};
  const pending = [];
  for (const p of list) {
    if (iconCache.has(p)) { out[p] = iconCache.get(p); continue; }
    pending.push({ p, src: psIconSource(p) });
  }
  // 1) 高分辨率（256px）提取：有显式图标就按索引，否则取目标 exe 的 0 号图标
  const withSrc = pending.filter(x => x.src);
  if (withSrc.length) {
    const items = withSrc.map((x, i) => ({ id: 'i' + i, path: x.src.file, index: x.src.index }));
    const map = await psExtractIcons(items);
    withSrc.forEach((x, i) => {
      const url = map['i' + i];
      if (url) { out[x.p] = url; iconCache.set(x.p, url); }
    });
  }
  // 2) 其余（无可用源或高分辨率提取失败）走 getFileIcon 候选链（32px 兜底）
  for (const x of pending) {
    if (out[x.p]) continue;
    const url = await iconFallback(x.p);
    out[x.p] = url || '';
    if (url) iconCache.set(x.p, url);
  }
  return out;
});

/* ---------------- 书架（复用 room/store.js） ---------------- */

function linkTargetIsDir(p) {
  if (!/\.(lnk|url)$/i.test(p)) return false;
  let target = '';
  try {
    if (/\.lnk$/i.test(p)) {
      const d = shell.readShortcutLink(p);
      target = d && d.target;
    } else {
      const u = /^URL=(.+)$/im.exec(fs.readFileSync(p, 'utf8'));
      if (u) {
        const raw = u[1].trim();
        target = /^file:\/\//i.test(raw)
          ? decodeURIComponent(new URL(raw).pathname.replace(/^\//, ''))
          : raw;
      }
    }
  } catch (e) { return false; }
  if (!target) return false;
  try {
    if (fs.statSync(target).isDirectory()) {
      // 指向 AppData / Program Files 这类应用目录的 .lnk，是应用自己的数据入口，
      // 不是用户整理的「文件夹快捷方式」——放进应用坞，别让它消失在地毯上。
      if (inAppDirs(target)) return false;
      return true;
    }
  } catch (e) {}
  try {
    const norm = path.resolve(target).toLowerCase();
    return store.entries().some(e => e.kind === 'folder' && e.originalPath &&
      path.resolve(e.originalPath).toLowerCase() === norm);
  } catch (e) { return false; }
}

ipcMain.handle('planet:shelve', (_e, p, row) => {
  if (!insideDesktop(p)) return { ok: false, error: '只允许收纳桌面上的文件' };
  return store.shelve(p, row, { linkDir: linkTargetIsDir(p) });
});

ipcMain.handle('planet:move-book', (_e, id, row, order) => store.move(id, row, order));
ipcMain.handle('planet:restore', (_e, id) => store.restore(id));

// 书脊拖进糖果罐：原件进回收站后条目同步消失
ipcMain.handle('planet:discard', (_e, id) => store.discard(id));
ipcMain.handle('planet:restore-all', () => store.restoreAll());
ipcMain.handle('planet:shelf-list', () => ({ entries: store.entries(), audit: store.audit() }));
ipcMain.handle('planet:journal', () => store.journalTail(60));
ipcMain.handle('planet:open-shelf', () => shell.openPath(store.shelfDir));

ipcMain.handle('planet:display-get', () => Object.assign(readDisplay(), { presets: DISPLAY_PRESETS }));
ipcMain.handle('planet:display-set', (_e, preset) => applyDisplayPreset(preset));

/* ---------------- 相册：按格 id 存快照 ---------------- */

const albumIndex = id => ALBUM_IDS.indexOf(String(id));
const validAlbumId = id => albumIndex(id) >= 0;

function readFrames() {
  const raw = readJson(FRAMES_FILE, {});
  return raw && !Array.isArray(raw) ? raw : {};
}

function albumView(all) {
  const out = {};
  for (const id of ALBUM_IDS) {
    const e = all[id];
    if (!e || !e.file) continue;
    if (!fs.existsSync(path.join(DATA_DIR, e.file))) continue;   // 快照被手工删掉就当空格
    out[id] = {
      name: String(e.name || ''), from: String(e.from || ''), at: String(e.at || ''),
      url: pathToFileURL(path.join(DATA_DIR, e.file)).href + '?v=' + (e.stamp || 0),
    };
  }
  return out;
}

function removeAlbumFile(e) {
  if (!e || !e.file) return;
  try { fs.unlinkSync(path.join(DATA_DIR, e.file)); } catch (err) {}
}

function setAlbumImage(id, src) {
  if (!validAlbumId(id)) return { ok: false, error: '不是相册里的格子' };
  const p = path.resolve(String(src || ''));
  const ext = path.extname(p).toLowerCase();
  if (!ALBUM_SET.has(ext)) return { ok: false, error: '相册只放图片' };
  let st;
  try { st = fs.statSync(p); } catch (e) { return { ok: false, error: '图片不存在' }; }
  if (!st.isFile()) return { ok: false, error: '不是文件' };

  let bytes, outExt;
  try {
    const img = nativeImage.createFromPath(p);
    if (/\.(png|jpe?g)$/.test(ext) && !img.isEmpty()) {
      let im = img;
      // 只缩不放：小图不拉大，大图最长边压到 1200
      if (im.getSize().width > 1200) im = im.resize({ width: 1200, quality: 'good' });
      bytes = im.toJPEG(82);
      outExt = '.jpg';
    } else {
      // nativeImage 只保证 PNG/JPEG 解码，gif/webp/avif/bmp 直接存原字节交给 CSS
      bytes = fs.readFileSync(p);
      outExt = ext;
    }
  } catch (e) { return { ok: false, error: '图片读取失败：' + e.message }; }

  const all = readFrames();
  const old = all[id];
  const file = 'frames/' + id + outExt;
  try {
    fs.mkdirSync(FRAMES_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, file), bytes);
  } catch (e) { return { ok: false, error: '快照写入失败：' + e.message }; }
  all[id] = { file, name: path.basename(p), from: p, at: new Date().toISOString(), stamp: Date.now() };
  writeJson(FRAMES_FILE, all);
  if (old && old.file && old.file !== file) removeAlbumFile(old);
  return { ok: true, album: albumView(all) };
}

ipcMain.handle('planet:album-list', () => ({
  ok: true, album: albumView(readFrames()), imageExts: ALBUM_EXT.slice(),
}));

ipcMain.handle('planet:album-pick', async (_e, id) => {
  if (!validAlbumId(id)) return { ok: false, error: '不是相册里的格子' };
  const r = await dialog.showOpenDialog({
    title: '挑一张挂进拍立得',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ALBUM_EXT.map(x => x.slice(1)) }],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  return setAlbumImage(id, r.filePaths[0]);
});

ipcMain.handle('planet:album-set', (_e, id, p) => setAlbumImage(id, p));

ipcMain.handle('planet:album-clear', (_e, id) => {
  if (!validAlbumId(id)) return { ok: false, error: '不是相册里的格子' };
  const all = readFrames();
  removeAlbumFile(all[id]);
  delete all[id];
  writeJson(FRAMES_FILE, all);
  return { ok: true, album: albumView(all) };
});

ipcMain.handle('planet:album-open', (_e, id) => {
  if (!validAlbumId(id)) return { ok: false, error: '不是相册里的格子' };
  const e = readFrames()[id];
  if (!e || !e.file) return { ok: false, error: '这张还是空的' };
  return shell.openPath(path.join(DATA_DIR, e.file)).then(err => (err ? { ok: false, error: err } : { ok: true }));
});

ipcMain.handle('planet:album-reveal', (_e, id) => {
  if (!validAlbumId(id)) return { ok: false, error: '不是相册里的格子' };
  const e = readFrames()[id];
  if (!e || !e.from || !fs.existsSync(e.from)) return { ok: false, error: '原图已不在原位置（相册显示的是快照）' };
  shell.showItemInFolder(e.from);
  return { ok: true };
});

/* ---------------- 展柜：形象按槽位存文件 ---------------- */

/** 展柜摆位：x/y 夹在玻璃柜内，z 是用户滚轮设的手动层级（1–14，可缺省） */
function normPose(p) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  const pose = {
    x: Math.max(5, Math.min(95, p.x)),
    y: Math.max(18, Math.min(98, p.y)),
  };
  if (Number.isFinite(p.z)) pose.z = Math.max(1, Math.min(14, Math.round(p.z)));
  if (Number.isFinite(p.zoom)) pose.zoom = Math.max(0.5, Math.min(2, Number(p.zoom)));
  // 倾斜度：顶部 ‹ › 按钮调整，夹在 ±30°（默认站位若自带基础角度，另加）
  if (Number.isFinite(p.rot)) pose.rot = Math.max(-30, Math.min(30, Math.round(p.rot)));
  return pose;
}

function readShow() {
  const raw = readJson(FIGURES_FILE, null);
  const base = {
    series: 'starman', count: 5,
    files: [null, null, null, null, null, null],
    names: ['', '', '', '', '', ''],
    poses: [null, null, null, null, null, null],
    labels: {},
  };
  if (!raw) return base;
  base.series = typeof raw.series === 'string' && raw.series ? raw.series : base.series;
  base.count = Math.max(1, Math.min(6, Number(raw.count) || 5));
  for (let i = 0; i < 6; i++) {
    base.files[i] = raw.files && typeof raw.files[i] === 'string' ? raw.files[i] : null;
    base.names[i] = raw.names && typeof raw.names[i] === 'string' ? raw.names[i] : '';
    base.poses[i] = normPose(raw.poses && raw.poses[i]);
  }
  if (raw.labels && typeof raw.labels === 'object') {
    for (const [k, v] of Object.entries(raw.labels)) {
      if (typeof v === 'string' && v.trim()) base.labels[k] = v.trim().slice(0, 8);
    }
  }
  return base;
}

function showView(cfg) {
  const slots = [];
  for (let i = 0; i < 6; i++) {
    const f = cfg.files[i];
    if (!f) { slots.push(null); continue; }
    let stamp = 0;
    try { stamp = fs.statSync(path.join(DATA_DIR, f)).mtimeMs; } catch (e) { stamp = 0; }
    if (!stamp) { slots.push(null); continue; }   // 文件被手工删掉就当这一位空着
    slots.push({
      url: pathToFileURL(path.join(DATA_DIR, f)).href + '?v=' + Math.round(stamp),
      name: cfg.names[i] || '',
    });
  }
  return {
    series: cfg.series, count: cfg.count, slots, max: 6, min: 1,
    poses: cfg.poses, labels: cfg.labels,
  };
}

/** 检测「名义上是 .gif、实际是单帧静态 PNG」的文件（没有 acTL 动画块）。
    浏览器能正常显示，但永远不可能动，给用户一个明确提示。 */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function staticImageHint(p, ext) {
  try {
    const sz = fs.statSync(p).size;
    const buf = Buffer.alloc(Math.min(sz, 256 * 1024));
    const fd = fs.openSync(p, 'r');
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    // PNG 签名（APNG 也是 PNG 容器）但没有 acTL → 单帧静态图
    if (buf.slice(0, 8).equals(PNG_SIG) && buf.indexOf('acTL') === -1) {
      return ext === '.gif'
        ? '这个 .gif 实际是静态 PNG（单帧），不会动'
        : '这张是静态图（单帧），不会动';
    }
  } catch (e) {}
  return '';
}

function setFigure(slot, src) {
  const i = Number(slot);
  if (!Number.isInteger(i) || i < 0 || i >= 6) return { ok: false, error: '展柜没有这个位置' };
  const p = path.resolve(String(src || ''));
  const ext = path.extname(p).toLowerCase();
  if (!FIGURE_EXT.has(ext)) return { ok: false, error: '展柜只收 PNG 或 GIF' };
  let st;
  try { st = fs.statSync(p); } catch (e) { return { ok: false, error: '图片不存在' }; }
  if (!st.isFile()) return { ok: false, error: '不是文件' };
  if (st.size > FIGURE_MAX) return { ok: false, error: '图片请小于 5MB' };

  const cfg = readShow();
  const file = 'figures/s' + i + ext;
  try {
    fs.mkdirSync(FIGURES_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, file), fs.readFileSync(p));
  } catch (e) { return { ok: false, error: '图片写入失败：' + e.message }; }

  const old = cfg.files[i];
  cfg.files[i] = file;
  cfg.names[i] = path.basename(p, path.extname(p)).slice(0, 14);
  writeJson(FIGURES_FILE, cfg);
  if (old && old !== file) { try { fs.unlinkSync(path.join(DATA_DIR, old)); } catch (e) {} }
  return { ok: true, showcase: showView(cfg), hint: staticImageHint(p, ext) };
}

ipcMain.handle('planet:figure-set', (_e, slot, p) => setFigure(slot, p));

ipcMain.handle('planet:figure-pick', async (_e, slot) => {
  const i = Number(slot);
  if (!Number.isInteger(i) || i < 0 || i >= 6) return { ok: false, error: '展柜没有这个位置' };
  const r = await dialog.showOpenDialog({
    title: '给展柜挑一张形象（PNG / GIF）',
    properties: ['openFile'],
    filters: [{ name: '透明底图片', extensions: ['png', 'gif'] }],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  return setFigure(i, r.filePaths[0]);
});

ipcMain.handle('planet:figure-clear', (_e, slot) => {
  const i = Number(slot);
  if (!Number.isInteger(i) || i < 0 || i >= 6) return { ok: false, error: '展柜没有这个位置' };
  const cfg = readShow();
  const old = cfg.files[i];
  cfg.files[i] = null;
  cfg.names[i] = '';
  writeJson(FIGURES_FILE, cfg);
  if (old) { try { fs.unlinkSync(path.join(DATA_DIR, old)); } catch (e) {} }
  return { ok: true, showcase: showView(cfg) };
});

/** 交换两个展位：只换文件与名字，不动已经写进磁盘的图片 */
ipcMain.handle('planet:figure-swap', (_e, a, b) => {
  const i = Number(a), j = Number(b);
  if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i >= 6 || j >= 6)
    return { ok: false, error: '展柜没有这个位置' };
  if (i === j) return { ok: true, showcase: showView(readShow()) };
  const cfg = readShow();
  const tf = cfg.files[i], tn = cfg.names[i], tp = cfg.poses[i];
  cfg.files[i] = cfg.files[j]; cfg.names[i] = cfg.names[j]; cfg.poses[i] = cfg.poses[j];
  cfg.files[j] = tf; cfg.names[j] = tn; cfg.poses[j] = tp;
  writeJson(FIGURES_FILE, cfg);
  return { ok: true, showcase: showView(cfg) };
});

/** 只改系列与站位数：已上传的图一律保留，数组不缩短 */
ipcMain.handle('planet:figure-save', (_e, patch) => {
  const cfg = readShow();
  const p = patch && typeof patch === 'object' ? patch : {};
  if (typeof p.series === 'string' && /^[\w-]{1,16}$/.test(p.series)) cfg.series = p.series;
  if (Number.isFinite(Number(p.count))) cfg.count = Math.max(1, Math.min(6, Math.round(Number(p.count))));
  if (Array.isArray(p.poses)) {
    cfg.poses = [null, null, null, null, null, null];
    for (let i = 0; i < 6; i++) {
      cfg.poses[i] = normPose(p.poses[i]);
    }
  }
  if (p.labels && typeof p.labels === 'object' && !Array.isArray(p.labels)) {
    cfg.labels = {};
    for (const [k, v] of Object.entries(p.labels)) {
      if (/^[\w-]{1,16}$/.test(k) && typeof v === 'string' && v.trim()) cfg.labels[k] = v.trim().slice(0, 8);
    }
  }
  writeJson(FIGURES_FILE, cfg);
  return { ok: true, showcase: showView(cfg) };
});

/* ---------------- 唱片机 ---------------- */

function readAudioState() {
  const s = readJson(AUDIO_FILE, {});
  return {
    folder: typeof s.folder === 'string' ? s.folder : '',
    mode: PlayerState.normalize(s.mode),
    index: Number.isFinite(s.index) ? s.index : 0,
    volume: Number.isFinite(s.volume) ? s.volume : 0.8,
  };
}

function writeAudioState(patch) {
  const next = Object.assign(readAudioState(), patch || {});
  writeJson(AUDIO_FILE, next);
  return next;
}

/** 只收顶层 .mp3；是否递归是布尔开关，不是目录清单 */
function listMp3(dir) {
  if (!dir) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isFile() && path.extname(d.name).toLowerCase() === '.mp3')
      .map(d => ({ name: d.name, path: path.join(dir, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  } catch (e) { return []; }
}

ipcMain.handle('planet:audio-pick', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择存放 MP3 的文件夹' });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  audioDir = r.filePaths[0];
  const state = writeAudioState({ folder: audioDir, index: 0 });
  return { ok: true, folder: audioDir, files: listMp3(audioDir), state };
});

ipcMain.handle('planet:audio-state', () => {
  const s = readAudioState();
  audioDir = s.folder || null;
  return Object.assign(s, { files: listMp3(audioDir) });
});

ipcMain.handle('planet:audio-mode', (_e, mode) => {
  if (MODES.indexOf(mode) < 0) return { ok: false, error: '未知播放模式' };
  return { ok: true, state: writeAudioState({ mode }) };
});

ipcMain.handle('planet:audio-save', (_e, patch) => ({ ok: true, state: writeAudioState(patch || {}) }));

/* ---------------- 我的电脑：真实读数与快捷入口 ---------------- */

function pcStats() {
  const sysDrive = (process.env.SystemDrive || 'C:') + '\\';
  let disk = null, diskTotal = 0, diskFree = 0;
  try {
    const s = fs.statfsSync(sysDrive);
    diskTotal = s.blocks * s.bsize;
    diskFree = s.bavail * s.bsize;
    if (diskTotal > 0) disk = Math.round((1 - diskFree / diskTotal) * 100);
  } catch (e) { /* 取不到就返回 null，界面显示占位而不是假数字 */ }
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  return {
    disk, mem: Math.round((1 - memFree / memTotal) * 100),
    diskTotal, diskFree, memTotal, memFree,
    up: Math.round(os.uptime()),
    host: os.hostname(),
  };
}

ipcMain.handle('planet:pc-stats', () => pcStats());

ipcMain.handle('planet:pc-open', (_e, key) => {
  const map = {
    home: app.getPath('home'),
    desktop: DESKTOP,
    documents: app.getPath('documents'),
    downloads: app.getPath('downloads'),
    pictures: app.getPath('pictures'),
    trash: 'shell:RecycleBinFolder',
  };
  const target = map[key];
  if (!target) return { ok: false, error: '没有这个入口' };
  return shell.openPath(target).then(err => (err ? { ok: false, error: err } : { ok: true }));
});

/* ---------------- 自测 / 穿透 / 退出 ---------------- */

ipcMain.handle('planet:debug-make-file', (_e, name) => {
  if (process.env.PLANET_SELFTEST !== '1') return { ok: false, error: '未开启自测' };
  const safe = String(name || 'planet-test.txt').replace(/[\\/:*?"<>|]/g, '_');
  const p = path.join(DESKTOP, safe);
  fs.writeFileSync(p, 'planet selftest\n' + new Date().toISOString(), 'utf8');
  return { ok: true, path: p, name: safe };
});

ipcMain.handle('planet:debug-remove', (_e, p) => {
  if (process.env.PLANET_SELFTEST !== '1') return { ok: false };
  try { fs.unlinkSync(p); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.on('planet:ignore', (_e, ignore) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!!ignore, { forward: true });
});

ipcMain.on('planet:quit', () => app.quit());

// 测试专用：模拟托盘「隐藏 / 显示星球」，并回读窗口真实状态（透明隐藏不能真的 hide）
if (process.env.XOME_TEST_DATA) {
  ipcMain.handle('planet:test-toggle', (_e, hidden) => {
    if (!win || win.isDestroyed()) return { ok: false };
    if (hidden) hidePlanet(); else showPlanet();
    return {
      ok: true,
      hidden: planetHidden,
      visible: win.isVisible(),
      opacity: win.getOpacity(),
    };
  });
}

ipcMain.handle('planet:focus', (_e, on) => {
  if (!win || win.isDestroyed()) return { ok: false };
  try {
    win.setFocusable(!!on);
    if (on) win.focus();
    else win.webContents.send('planet:screen', screenInfo());
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

/* ---------------- 托盘 ---------------- */

/** 开机自启动：读写当前用户的 Windows 登录项。开发态用 electron + main.js，打包态直接用 exe。 */
function autoStartOn() {
  try { return !!app.getLoginItemSettings().openAtLogin; } catch (e) { return false; }
}

function applyAutoStart(on) {
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath });
    } else {
      app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: [path.join(__dirname, 'main.js')] });
    }
    return true;
  } catch (e) {
    console.warn('[autostart] 设置失败', e.message);
    return false;
  }
}

/* 隐藏 / 显示。
   注意：不能用 win.hide() + showInactive()——Windows 上这一来一回会破坏
   setIgnoreMouseEvents(true,{forward:true}) 的鼠标转发（Electron 已知问题），
   显示后渲染进程再也收不到 mousemove，就永远卡在“看得见、点不动”的穿透态。
   改用「透明度 0 + 穿透」模拟隐藏：窗口始终可见，鼠标转发链路不断，状态不会丢。 */
let planetHidden = false;

function hidePlanet() {
  if (!win || win.isDestroyed()) return;
  planetHidden = true;
  win.setIgnoreMouseEvents(true, { forward: true });   // 先放开鼠标，避免透明窗口挡住桌面
  win.setOpacity(0);
}

function showPlanet() {
  if (!win || win.isDestroyed()) return;
  planetHidden = false;
  win.setOpacity(1);
  win.showInactive();
  win.setIgnoreMouseEvents(false);   // 先把 OS 层恢复成可点击，再让渲染进程按指针重算
  // 显示后重发屏信息并强制渲染进程重算一次穿透，确保 ignoring 与 OS 状态对齐
  setTimeout(() => {
    applyZOrder();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('planet:screen', screenInfo());
    win.webContents.send('planet:resync');
  }, 60);
}

function buildTrayMenu() {
  const cur = readDisplay().preset;
  return Menu.buildFromTemplate([
    { label: '显示星球', click: showPlanet },
    { label: '隐藏星球', click: hidePlanet },
    { type: 'separator' },
    {
      label: '画面适配',
      submenu: Object.keys(DISPLAY_PRESETS).map(k => ({
        label: DISPLAY_PRESETS[k].label,
        type: 'radio',
        checked: cur === k,
        click: () => applyDisplayPreset(k),
      })),
    },
    { label: '当前档位：' + DISPLAY_PRESETS[cur].label, enabled: false },
    { type: 'separator' },
    { label: '收纳记录（Ctrl+J）', click: () => sendCmd('journal') },
    { label: '说明（?）', click: () => sendCmd('help') },
    { label: '打开收纳目录', click: () => store && shell.openPath(store.shelfDir) },
    { type: 'separator' },
    {
      label: '开机自启动',
      type: 'checkbox',
      checked: autoStartOn(),
      click: () => {
        const ok = applyAutoStart(!autoStartOn());
        if (tray) tray.setContextMenu(buildTrayMenu());
        console.log('[autostart] 已' + (autoStartOn() ? '开启' : '关闭') + (ok ? '' : '（设置失败）'));
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
}

function createTray() {
  let img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  if (!img.isEmpty()) img = img.resize({ width: 32, height: 32, quality: 'best' });
  tray = new Tray(img);
  tray.setToolTip('糖绒星球');
  tray.setContextMenu(buildTrayMenu());
  console.log('[tray] ready preset=' + readDisplay().preset + ' presets=' + Object.keys(DISPLAY_PRESETS).join(','));
  tray.on('click', () => {
    if (!win || win.isDestroyed()) return;
    if (planetHidden) showPlanet(); else hidePlanet();
  });
}

function sendCmd(name) {
  if (win && !win.isDestroyed()) win.webContents.send('planet:cmd', name);
}

/* ---------------- 启动 ---------------- */

if (GOT_LOCK) {
  app.on('second-instance', () => showPlanet());
}
// 任务栏 / 通知中心里的应用身份（与打包元数据一致）
try { app.setAppUserModelId('com.xome.planet'); } catch (e) {}

app.whenReady().then(() => {
  if (!GOT_LOCK) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // 唱片机：只放行「已选文件夹内的 .mp3」，挡住 ../ 穿越与非音频文件
  protocol.handle('xome-planet-audio', req => {
    try {
      const p = new URL(req.url).searchParams.get('p');
      if (!p) return new Response('bad', { status: 400 });
      const full = path.resolve(p);
      const root = audioDir ? path.resolve(audioDir) : '';
      if (!isAudioPathAllowed(full, root) || !fs.existsSync(full))
        return new Response('bad', { status: 400 });
      return net.fetch(pathToFileURL(full).toString());
    } catch (e) { return new Response('bad', { status: 400 }); }
  });

  try { fs.writeFileSync(PID_FILE, String(process.pid), 'utf8'); } catch (e) {}
  store = new Store({ dataDir: DATA_DIR, desktop: DESKTOP, shelfDir: SHELF_DIR });
  // 上次退出时书架「解散」回了桌面，这次启动把它们收回来
  try {
    const re = store.rehydrate();
    if (re.moved) console.log('[store] 已从桌面收回', re.moved, '个书架条目');
    if (re.missing && re.missing.length) console.log('[store] 找不到原件的条目', re.missing.join('、'));
  } catch (e) { console.warn('[store] 书架恢复失败', e.message); }
  audioDir = readAudioState().folder || null;
  console.log('[store] 收纳目录', store.shelfDir, '条目', store.entries().length);

  createWindow();
  if (!process.env.XOME_TEST_NO_PIN) createTray();

  if (MODE === 'desktop' && win32) {
    setTimeout(() => {
      try {
        const p = win32.probe(hwnd);
        console.log('[layer]', JSON.stringify({
          visible: p.visible, belowCls: p.belowCls, anchored: p.below === p.progman,
          foregroundIsSelf: p.foreground === hwnd,
        }));
      } catch (e) { console.log('[layer] 探测失败', e.message); }
    }, 3000);
  }

  timer = setInterval(applyZOrder, REASSERT_MS);

  screen.on('display-metrics-changed', () => {
    if (!win || win.isDestroyed()) return;
    win.setBounds(screen.getPrimaryDisplay().workArea);
    applyZOrder();
    win.webContents.send('planet:screen', screenInfo());
  });

  try {
    watcher = fs.watch(DESKTOP, { persistent: false }, () => {
      if (!win || win.isDestroyed()) return;
      clearTimeout(watcher._t);
      watcher._t = setTimeout(() => win.webContents.send('planet:desktop', listDesktop()), 400);
    });
  } catch (e) { /* 桌面监听失败不影响主流程 */ }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  // 退出即「解散」虚拟书架：文件全部回到桌面原位，App 不在了也能直接取用
  try {
    if (store) {
      const r = store.dissolveAll();
      if (r && r.failed && r.failed.length) console.warn('[store] 有文件没放回桌面', r.failed);
    }
  } catch (e) { console.warn('[store] 解散书架失败', e.message); }
  try { fs.unlinkSync(PID_FILE); } catch (e) {}
  if (tray) { try { tray.destroy(); } catch (e) {} }
  if (timer) clearInterval(timer);
  if (watcher) try { watcher.close(); } catch (e) {}
});
