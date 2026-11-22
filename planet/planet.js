/* planet.js —— 糖绒星球：渲染 + 收纳交互
 * 基准画布 1440×940；等比缩放居中。
 * 文件层：拖到书架＝真移动，拖出＝还原；相册存快照，展柜存形象文件。
 */
'use strict';

const PM = window.PlanetModel;
const { BASE_W, BASE_H, SERIES, SERIES_KEYS, ALBUM_SIZE } = PM;

const app = document.getElementById('app');
const stageTip = document.getElementById('tip');
const toastEl = document.getElementById('toast');
const ctxEl = document.getElementById('ctx');
const modalEl = document.getElementById('modal');
const veilEl = document.getElementById('veil');
const drawerEl = document.getElementById('drawer');
const floorHolder = document.getElementById('floorFiles');

const CARD_W = 96;
const CARD_H = 78;
const ROW_COLORS = ['#F7A8C8', '#F8CE8C', '#A6DFC6', '#BCA9EE', '#F3B4CE'];
const ALBUM_IDS = ['p1', 'p2', 'p3', 'p4'];

let SCALE = 1;
let OX = 0, OY = 0;

const S = {
  layout: { todos: [], filePos: {}, dock: { cols: 3, items: [] } },
  desktop: { files: [] },
  apps: [],
  shelf: [],
  album: {},
  albumExts: new Set(),
  show: {
    series: 'starman', count: 5,
    slots: [null, null, null, null, null, null],
    poses: [null, null, null, null, null, null],
    labels: {},
  },
  display: { preset: 'auto', presets: {} },
  stageW: 1440,
  pc: { disk: null, mem: null },
  screen: {},
  icons: {},
  selectMode: false,
  selected: new Set(),
  saver: false,
};

let saveTimer = null;
let toastTimer = null;
let tipTimer = null;
let prevNames = null;

/* ---------------- 小工具 ---------------- */

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

function el(tag, cls, text) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text != null) d.textContent = text;
  return d;
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** 书本按格式配色：查表命中就用对应色，查不到走 DEFAULT_INK，新格式不改代码也能显示 */
const DEFAULT_INK = ['#C0A0B2', '#9A7A8C'];
const DOC_INK = {
  doc: ['#7F9FD2', '#5B7BAE'], docx: ['#7F9FD2', '#5B7BAE'], wps: ['#7F9FD2', '#5B7BAE'],
  xls: ['#7FC9A6', '#559B7B'], xlsx: ['#7FC9A6', '#559B7B'], csv: ['#7FC9A6', '#559B7B'], et: ['#7FC9A6', '#559B7B'],
  ppt: ['#E79A7D', '#C1735A'], pptx: ['#E79A7D', '#C1735A'], dps: ['#E79A7D', '#C1735A'],
  pdf: ['#E58AA0', '#BF6379'],
  txt: ['#9BB3D6', '#748FBA'], md: ['#9BB3D6', '#748FBA'], markdown: ['#9BB3D6', '#748FBA'],
  png: ['#B49BE0', '#8E76BD'], jpg: ['#B49BE0', '#8E76BD'], jpeg: ['#B49BE0', '#8E76BD'],
  gif: ['#B49BE0', '#8E76BD'], webp: ['#B49BE0', '#8E76BD'], bmp: ['#B49BE0', '#8E76BD'],
  zip: ['#D2B27A', '#AC8C56'], rar: ['#D2B27A', '#AC8C56'], '7z': ['#D2B27A', '#AC8C56'],
};

const TYPE_TAG = {
  doc: ['#7F9FD2', 'DOC'], docx: ['#7F9FD2', 'DOC'], wps: ['#7F9FD2', 'DOC'],
  xls: ['#7FC9A6', 'XLS'], xlsx: ['#7FC9A6', 'XLS'], csv: ['#7FC9A6', 'CSV'], et: ['#7FC9A6', 'XLS'],
  ppt: ['#E79A7D', 'PPT'], pptx: ['#E79A7D', 'PPT'], dps: ['#E79A7D', 'PPT'],
  pdf: ['#E58AA0', 'PDF'],
  txt: ['#9BB3D6', 'TXT'], md: ['#9BB3D6', 'MD'], markdown: ['#9BB3D6', 'MD'],
  png: ['#B49BE0', 'IMG'], jpg: ['#B49BE0', 'IMG'], jpeg: ['#B49BE0', 'IMG'],
  gif: ['#B49BE0', 'IMG'], webp: ['#B49BE0', 'IMG'], bmp: ['#B49BE0', 'IMG'], avif: ['#B49BE0', 'IMG'],
  zip: ['#D2B27A', 'ZIP'], rar: ['#D2B27A', 'ZIP'], '7z': ['#D2B27A', 'ZIP'],
};
const DEFAULT_TAG = ['#C9B7D8', 'FILE'];

function inkOf(f) {
  const name = String(f.name || '');
  const ext = String(f.ext || '').replace(/^\./, '').toLowerCase()
    || (name.indexOf('.') >= 0 ? name.split('.').pop().toLowerCase() : '');
  return DOC_INK[ext] || DEFAULT_INK;
}

function tagOf(f) {
  if (f.dir) return ['#F0C288', 'BOX'];
  if (/\.(lnk|url)$/i.test(f.name || '')) return ['#A9C4EC', 'LNK'];
  const ext = String(f.ext || '').replace(/^\./, '').toLowerCase();
  const t = TYPE_TAG[ext];
  if (t) return t;
  return [DEFAULT_TAG[0], (ext || 'file').slice(0, 3).toUpperCase()];
}

const bookLook = e => (e.linkDir ? 'box link' : (e.kind === 'folder' ? 'box' : 'doc'));

/** 桌面上的应用快捷方式：.lnk/.url 指向应用（不是文件夹）、或直接的 .exe。
    文件夹快捷方式仍留在地毯/档案盒，不进应用坞。 */
const APP_EXTS = new Set(['.lnk', '.url', '.exe']);
const isAppShortcut = f => !!f && !f.dir && APP_EXTS.has(String(f.ext || '').toLowerCase()) && !f.linkDir;
const clampRow = r => Math.max(0, Math.min(4, Number.isFinite(r) ? r : 0));

/* ---------------- 原创矢量：糖绒小精灵 / 蝴蝶结 / 糖果罐 / 多肉 ---------------- */

function sprite(body, ear, blush, opts) {
  const o = opts || {};
  const wave = o.wave ? '<g class="wave"><path d="M92 70 q16 -16 24 -4" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/></g>' : '';
  const headphones = o.headphones
    ? '<g><path d="M18 48 Q50 8 82 48" stroke="currentColor" stroke-width="4" fill="none"/>' +
      '<rect x="10" y="44" width="13" height="20" rx="6" fill="' + blush + '" stroke="currentColor" stroke-width="2.5"/>' +
      '<rect x="77" y="44" width="13" height="20" rx="6" fill="' + blush + '" stroke="currentColor" stroke-width="2.5"/></g>'
    : '';
  const camera = o.camera
    ? '<g><rect x="30" y="76" width="40" height="27" rx="6" fill="#FFF6E8" stroke="currentColor" stroke-width="2.5"/>' +
      '<circle cx="50" cy="89" r="8" fill="' + blush + '" stroke="currentColor" stroke-width="2"/>' +
      '<rect x="43" y="72" width="14" height="6" rx="2" fill="' + blush + '" stroke="currentColor" stroke-width="2"/></g>'
    : '';
  const crown = o.crown
    ? '<path d="M38 12 l7 -12 7 10 7 -12 7 12" fill="' + blush + '" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>'
    : '';
  return '<svg viewBox="0 0 100 116" width="100%" height="100%" style="overflow:visible">' +
    '<path d="M22 40 Q6 8 12 2 Q26 -2 34 26" fill="' + ear + '" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M78 40 Q94 8 88 2 Q74 -2 66 26" fill="' + ear + '" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M50 16 C20 16 12 40 12 62 C12 88 26 108 50 108 C74 108 88 88 88 62 C88 40 80 16 50 16 Z" fill="' + body + '" stroke="currentColor" stroke-width="3.2"/>' +
    '<path d="M14 56 l-5 5 6 3 -6 5 6 2 -5 6 7 2 M86 56 l5 5 -6 3 6 5 -6 2 5 6 -7 2" fill="' + body + '" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>' +
    crown + headphones +
    '<g class="eye"><ellipse cx="35" cy="55" rx="9" ry="11" fill="#FFF9F2" stroke="currentColor" stroke-width="2.4"/>' +
    '<ellipse cx="65" cy="55" rx="9" ry="11" fill="#FFF9F2" stroke="currentColor" stroke-width="2.4"/>' +
    '<circle cx="37" cy="57" r="5" fill="currentColor"/><circle cx="67" cy="57" r="5" fill="currentColor"/>' +
    '<circle cx="35" cy="53" r="2" fill="#fff"/><circle cx="65" cy="53" r="2" fill="#fff"/></g>' +
    '<ellipse cx="23" cy="72" rx="7" ry="4.5" fill="' + blush + '" opacity=".85"/>' +
    '<ellipse cx="77" cy="72" rx="7" ry="4.5" fill="' + blush + '" opacity=".85"/>' +
    '<path d="M37 76 Q50 88 63 76 L60 84 L56 78 L52 85 L48 78 L44 84 L40 77 Z" fill="#FFF6F0" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>' +
    camera + wave +
    '<ellipse cx="32" cy="106" rx="10" ry="6" fill="' + ear + '" stroke="currentColor" stroke-width="2.5"/>' +
    '<ellipse cx="68" cy="106" rx="10" ry="6" fill="' + ear + '" stroke="currentColor" stroke-width="2.5"/>' +
    '</svg>';
}

const PH_COLORS = [
  ['#FFC2D8', '#FFE1EC', '#F58FB4'], ['#C9EEDC', '#E4F8EE', '#7FCBAE'],
  ['#DEC9F7', '#EFE5FF', '#A88BD8'], ['#FFE2B8', '#FFD6A0', '#E8A86B'],
  ['#CFE6FA', '#E6F2FF', '#8FB6DE'], ['#FFD1E6', '#FFE8F3', '#EF8FB8'],
];
const PH_OPTS = [{ crown: true }, { headphones: true }, { camera: true }, { wave: true }, {}, { crown: true }];

function placeholder(i) {
  const c = PH_COLORS[i % PH_COLORS.length];
  return sprite(c[0], c[1], c[2], PH_OPTS[i % PH_OPTS.length]);
}

const BOW_SVG = '<svg viewBox="0 0 104 52" width="104" height="52" aria-hidden="true">' +
  '<path d="M52 26 C30 2 4 8 6 26 C4 44 30 50 52 26 Z" fill="#F58FB4" stroke="#7A5552" stroke-width="3"/>' +
  '<path d="M52 26 C74 2 100 8 98 26 C100 44 74 50 52 26 Z" fill="#F58FB4" stroke="#7A5552" stroke-width="3"/>' +
  '<circle cx="52" cy="26" r="11" fill="#FFEBAE" stroke="#7A5552" stroke-width="3"/>' +
  '<path d="M46 34 l-8 18 M58 34 l8 18" stroke="#7A5552" stroke-width="3" stroke-linecap="round"/></svg>';

// viewBox 顶部外扩 4px：盖子上的圆钮 cy=4 r=7 原本顶到 y=-3 被容器裁掉一个角，
// 把可视区改成 y=-4..100，圆钮完整显示。
const BIN_SVG = '<svg viewBox="0 -4 88 104" width="88" height="104" aria-hidden="true">' +
  '<g class="lid"><rect x="8" y="8" width="72" height="16" rx="8" fill="#FFE1EC" stroke="#7A5552" stroke-width="3"/>' +
  '<circle cx="44" cy="4" r="7" fill="#F58FB4" stroke="#7A5552" stroke-width="2.5"/></g>' +
  '<path d="M14 26 h60 l-5 62 a8 8 0 0 1 -8 7 H27 a8 8 0 0 1 -8 -7 Z" fill="#F3D3E4" stroke="#7A5552" stroke-width="3"/>' +
  '<path d="M14 44 h60" stroke="#7A5552" stroke-width="2.5" opacity=".5"/>' +
  '<rect x="28" y="52" width="32" height="22" rx="6" fill="#FFF7EA" stroke="#7A5552" stroke-width="2.5"/>' +
  '<path d="M36 62 h16 M36 68 h10" stroke="#C79AA8" stroke-width="2.5" stroke-linecap="round"/></svg>';

/* ---------------- 适配 ---------------- */

function safeBottomFor(vh) {
  // 底部安全间距：Windows 任务栏（含自动隐藏）可能压住窗口最底部，
  // 按窗口高度取 24–56px，柜体与提示条不会贴着任务栏。
  return Math.round(Math.min(56, Math.max(24, vh * 0.03)));
}

function fit() {
  // 用文档元素的可视尺寸而不是 window.inner*：页面缩放 / 设备像素比变化时，
  // 后者可能比真实布局视口大一点，会让柜体上下溢出。
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const safe = safeBottomFor(vh);
  // 画布宽度跟着窗口宽高比横向展开：16:9 时中间展柜变宽，柜体不再只占中间一小块
  const stageW = PM.stageWidth(vw, vh);
  S.stageW = stageW;
  app.style.width = stageW + 'px';
  app.style.setProperty('--stage-w', stageW + 'px');
  app.style.setProperty('--mid-w', (stageW - 962) + 'px');
  const f = PM.fitFor(vw, vh, (S.display && S.display.preset) || 'auto', safe, stageW);
  SCALE = f.scale;
  OX = f.ox;
  OY = f.oy;
  app.style.transform = 'translate(' + OX + 'px,' + OY + 'px) scale(' + SCALE + ')';
}

/* ---------------- 静态场景 ---------------- */

function buildScene() {
  $('#brandMark').innerHTML = sprite('#FFD9E8', '#FFF0F6', '#F2A0C4', {});
  $('#bow').innerHTML = BOW_SVG;
  $('#bin').innerHTML = BIN_SVG;
  buildAmbient();
  buildShelfRows();
  renderSeriesTabs();
}

function buildAmbient() {
  const box = $('#ambient');
  const cloud = (x, y, w, delay) => '<div class="cloud" style="left:' + x + 'px;top:' + y + 'px;animation-delay:' + delay + 's">' +
    '<svg viewBox="0 0 160 70" width="' + w + '"><path d="M28 58 Q4 58 8 40 Q10 26 28 26 Q34 6 58 10 Q72 -2 92 12 Q118 6 126 28 Q150 26 150 44 Q152 58 130 58 Z" fill="#fff" opacity=".55"/></svg></div>';
  let html = '<div class="orb" style="left:300px;top:-40px;width:300px;height:300px;background:rgba(255,220,238,.5)"></div>' +
    '<div class="orb" style="left:880px;top:360px;width:320px;height:320px;background:rgba(200,240,225,.4);animation-delay:-3s"></div>' +
    cloud(430, 120, 150, 0) + cloud(760, 260, 110, -8) + cloud(120, 470, 88, -15);
  const stars = [];
  for (let i = 0; i < 16; i++) {
    const x = 4 + (hash('sx' + i) % 92);
    const y = 90 + Math.round(hash('sy' + i) % 700);
    const sz = 7 + (hash('ss' + i) % 9);
    stars.push('<div class="star" style="left:' + x + '%;top:' + y + 'px;animation-delay:-' + (i * 0.37).toFixed(1) + 's">' +
      '<svg viewBox="0 0 20 20" width="' + sz + '" height="' + sz + '"><path d="M10 0l2.2 6.2L19 8.5l-6 3.3L10 19l-3-7.2-6-3.3 6.8-2.3z" fill="#fff"/></svg></div>');
  }
  box.innerHTML = html + stars.join('');
}

function buildShelfRows() {
  const grid = $('#shelfGrid');
  grid.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const row = el('div', 'shelf__row');
    row.dataset.row = String(i);
    row.style.setProperty('--rowcolor', ROW_COLORS[i]);
    grid.appendChild(row);
  }
}

let seriesClickTimer = null;

function seriesLabel(key) {
  const custom = S.show.labels && S.show.labels[key];
  return custom || (SERIES[key] ? SERIES[key].label : key);
}

/** 系列标签每次重绘：改名后文字要立刻变，监听器也要重新绑，避免重复绑定 */
function renderSeriesTabs() {
  const tabs = $('#seriesTabs');
  tabs.innerHTML = SERIES_KEYS.map(k =>
    '<button data-k="' + k + '" class="' + (k === S.show.series ? 'on' : '') + '" ' +
    'title="' + esc(SERIES[k].sub) + ' · 双击改名">' + esc(seriesLabel(k)) + '</button>').join('');
  $$('#seriesTabs button').forEach(b => {
    // 单击切系列、双击改名：先等 180ms，双击时取消切换，避免第一次点击把按钮重绘掉
    b.addEventListener('click', () => {
      clearTimeout(seriesClickTimer);
      const key = b.dataset.k;
      seriesClickTimer = setTimeout(() => switchSeries(key), 180);
    });
    b.addEventListener('dblclick', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      clearTimeout(seriesClickTimer);
      renameSeries(b.dataset.k);
    });
    b.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      seriesMenu(ev, b.dataset.k);
    });
  });
}

function seriesMenu(e, key) {
  const custom = !!(S.show.labels && S.show.labels[key]);
  showMenu(e.clientX, e.clientY, [
    { label: '重命名这个系列', run: () => renameSeries(key) },
    ...(custom ? [{ label: '恢复默认名称', danger: true, run: () => saveSeriesLabel(key, null) }] : []),
  ]);
}

async function renameSeries(key) {
  const cur = seriesLabel(key);
  const name = await askText('给这个系列起个名字（最多 8 个字）', cur);
  if (name == null) return;
  const clean = String(name).trim().slice(0, 8);
  if (!clean) { toast('名字不能为空'); return; }
  await saveSeriesLabel(key, clean === SERIES[key].label ? null : clean);
}

async function saveSeriesLabel(key, label) {
  const labels = Object.assign({}, S.show.labels || {});
  if (label) labels[key] = label; else delete labels[key];
  const r = await window.planet.figureSave({ labels });
  if (!r.ok) { toast(r.error || '没改成'); return; }
  S.show = r.showcase;
  renderShow();
  toast(label ? '系列名改好啦' : '已恢复默认名称');
}

/* ---------------- 持久化 ---------------- */

function saveLayout() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const r = await window.planet.saveLayout(S.layout);
    if (!r.ok) console.warn('保存失败', r.error);
  }, 320);
}

/* ---------------- 提示 / toast / 菜单 / 弹层 ---------------- */

function showTip(x, y, text, ms) {
  stageTip.textContent = text;
  stageTip.style.left = Math.min(window.innerWidth - 20, x + 14) + 'px';
  stageTip.style.top = Math.min(window.innerHeight - 28, y + 16) + 'px';
  stageTip.classList.add('on');
  clearTimeout(tipTimer);
  if (ms) tipTimer = setTimeout(hideTip, ms);
}
function hideTip() { stageTip.classList.remove('on'); }

function toast(msg, action) {
  toastEl.innerHTML = '';
  toastEl.appendChild(el('span', 'toast__msg', msg));
  if (action) {
    const b = el('button', 'toast__act', action.label);
    b.addEventListener('click', () => { hideToast(); action.fn(); });
    toastEl.appendChild(b);
  }
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 6200 : 2800);
}
function hideToast() { toastEl.classList.remove('on'); }

function closeMenu() { ctxEl.classList.remove('on'); ctxEl.innerHTML = ''; }

function showMenu(x, y, items) {
  ctxEl.innerHTML = '';
  items.forEach(it => {
    if (it.sep) { ctxEl.appendChild(el('div', 'ctx-sep')); return; }
    const b = el('div', 'ctx-item' + (it.danger ? ' danger' : ''), it.label);
    b.addEventListener('click', async ev => { ev.stopPropagation(); closeMenu(); await it.run(); });
    ctxEl.appendChild(b);
  });
  ctxEl.classList.add('on');
  ctxEl.style.left = Math.max(8, Math.min(x, window.innerWidth - 170)) + 'px';
  ctxEl.style.top = Math.max(8, Math.min(y, window.innerHeight - 8 - items.length * 30)) + 'px';
  setIgnore(false);
}

function openModal(html) {
  modalEl.innerHTML = html;
  modalEl.hidden = false;
  veilEl.classList.add('on');
  setIgnore(false);
}

function closeModal() {
  modalEl.hidden = true;
  modalEl.innerHTML = '';
  veilEl.classList.remove('on');
  window.planet.focus(false);
  refreshIgnore();
}

function askConfirm(html) {
  return new Promise(resolve => {
    openModal('<div style="font-size:11.5px;line-height:1.8">' + html + '</div>' +
      '<div class="modal__actions"><button class="btn" id="askNo">取消</button>' +
      '<button class="btn primary" id="askYes">确定</button></div>');
    $('#askNo').addEventListener('click', () => { closeModal(); resolve(false); });
    $('#askYes').addEventListener('click', () => { closeModal(); resolve(true); });
  });
}

async function askText(title, value) {
  await window.planet.focus(true);
  return new Promise(resolve => {
    openModal('<h3>' + esc(title) + '</h3>' +
      '<input class="editor" id="askInput" style="height:auto;padding:8px 10px" />' +
      '<div class="modal__actions"><button class="btn" id="askNo">取消</button>' +
      '<button class="btn primary" id="askYes">确定</button></div>');
    const inp = $('#askInput');
    inp.value = value || '';
    inp.focus();
    inp.select();
    const done = v => { closeModal(); resolve(v); };
    $('#askYes').addEventListener('click', () => done(inp.value));
    $('#askNo').addEventListener('click', () => resolve(null));
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') done(inp.value);
      if (e.key === 'Escape') { closeModal(); resolve(null); }
    });
  });
}

veilEl.addEventListener('click', () => { if (!modalEl.hidden) closeModal(); });
document.addEventListener('pointerdown', e => {
  if (ctxEl.classList.contains('on') && !e.target.closest('#ctx')) closeMenu();
  if (drawerEl.classList.contains('on') && !e.target.closest('#drawer') && !e.target.closest('#btnHelp')) closeDrawer();
}, true);

/* ---------------- 拖动公共 ---------------- */

let dragging = null;
let ghostEl = null;
let marqueeEl = null;

/** 兜底：拖拽收尾任何一步抛错都会把 dragging 留在非空，整层于是永远接管鼠标，
    桌面看起来「卡住、点不动」。全局 pointerup 后校验一次，异步收尾结束还没清就强制复位。 */
function forceResetDrag() {
  if (!dragging) return;
  dragging = null;
  $$('.dragging').forEach(n => n.classList.remove('dragging'));
  $$('.dock__group.drop').forEach(n => n.classList.remove('drop'));
  if (marqueeEl) { try { marqueeEl.remove(); } catch (e) {} marqueeEl = null; }
  endGhost();
  clearHighlight();
  refreshIgnore();
}
window.addEventListener('pointerup', () => setTimeout(forceResetDrag, 700));
window.addEventListener('pointercancel', () => setTimeout(forceResetDrag, 700));

function beginGhost(label, x, y) {
  ghostEl = el('div', 'ghost', label);
  ghostEl.style.left = x + 'px';
  ghostEl.style.top = y + 'px';
  document.body.appendChild(ghostEl);
}
function moveGhost(x, y, over) {
  if (!ghostEl) return;
  ghostEl.style.left = x + 'px';
  ghostEl.style.top = y + 'px';
  ghostEl.classList.toggle('over', !!over);
}
function endGhost() {
  if (ghostEl) { ghostEl.remove(); ghostEl = null; }
}

function nearRect(r, x, y) { return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }

/** 屏幕坐标 → 落点：糖果罐 / 书架层 / 展位 / 拍立得（全部按真实 DOM 矩形判定） */
function targetsAt(x, y) {
  const out = { bin: false, row: -1, figure: -1, polaroid: -1 };
  const bin = $('#bin');
  if (bin && nearRect(bin.getBoundingClientRect(), x, y)) out.bin = true;
  $$('.shelf__row').forEach((row, i) => {
    if (nearRect(row.getBoundingClientRect(), x, y)) out.row = i;
  });
  $$('#showGrid .figure').forEach(n => {
    if (nearRect(n.getBoundingClientRect(), x, y)) out.figure = Number(n.dataset.i);
  });
  $$('#polaroids .polaroid').forEach(n => {
    if (nearRect(n.getBoundingClientRect(), x, y)) out.polaroid = Number(n.dataset.pi);
  });
  return out;
}

function highlightTargets(t) {
  $$('.shelf__row').forEach((row, i) => row.classList.toggle('hot', i === t.row));
  $('#bin').classList.toggle('hot', !!t.bin);
}

function clearHighlight() {
  $$('.shelf__row.hot').forEach(n => n.classList.remove('hot'));
  $('#bin').classList.remove('hot');
}

/* ---------------- 地毯：资料卡 ---------------- */

function poses() {
  S.layout.filePos = S.layout.filePos || {};
  return S.layout.filePos;
}

function rotFor(name) { return (hash(name) % 17) - 8; }

function floorSize() {
  return {
    w: floorHolder.clientWidth || 478,
    h: floorHolder.clientHeight || 300,
  };
}

function freshPose(name) {
  const z = floorSize();
  const slots = PM.gridPositions(Math.max(S.desktop.files.length, 1), CARD_W, CARD_H, z.w, z.h,
    { pad: 24, gapX: 4, gapY: 2 });
  const taken = Object.values(poses());
  const start = hash(name) % slots.length;
  for (let k = 0; k < slots.length; k++) {
    const s = slots[(start + k) % slots.length];
    if (!taken.some(p => Math.abs(p.x - s.x) < 34 && Math.abs(p.y - s.y) < 30)) {
      return { x: s.x, y: s.y, rot: rotFor(name) };
    }
  }
  const s = slots[start];
  return { x: s.x, y: s.y, rot: rotFor(name) };
}

function poseOf(name) {
  const ps = poses();
  if (!ps[name]) { ps[name] = freshPose(name); saveLayout(); }
  return ps[name];
}

function prunePoses() {
  const ps = poses();
  const alive = new Set(S.desktop.files.map(f => f.name));
  let dirty = false;
  for (const k of Object.keys(ps)) if (!alive.has(k)) { delete ps[k]; dirty = true; }
  if (dirty) saveLayout();
}

async function loadIcons(files) {
  try {
    const map = await window.planet.icons(files.map(f => f.path));
    Object.assign(S.icons, map || {});
  } catch (e) { console.warn('图标读取失败', e); }
}

function renderFloor(newOnes) {
  prunePoses();
  const list = S.desktop.files.slice().sort((a, b) => poseOf(a.name).y - poseOf(b.name).y);
  floorHolder.innerHTML = '';
  for (const f of list) {
    const pose = poseOf(f.name);
    const tag = tagOf(f);
    const d = el('div', 'file' + (S.selected.has(f.path) ? ' sel' : '') + (newOnes && newOnes.has(f.name) ? ' drop' : ''));
    d.style.left = pose.x + 'px';
    d.style.top = pose.y + 'px';
    d.style.setProperty('--rot', pose.rot + 'deg');
    d.style.setProperty('--fc', tag[0]);
    // 与书脊同一套配色语言：原格式色作角标与左侧立边，浅化色作卡面底。
    // 概念稿里散乱资料本来就是按格式着色的彩色卡，产品版此前只剩白卡。
    d.style.setProperty('--fc-light', PM.lightenInk(tag[0], 0.78));
    d.dataset.path = f.path;
    d.dataset.name = f.name;
    d.dataset.ext = f.ext || '';

    const ic = el('div', 'file__icon');
    const src = S.icons[f.path];
    if (src) {
      const img = el('img');
      img.src = src;
      img.alt = '';
      img.draggable = false;
      ic.appendChild(img);
    } else {
      ic.classList.add('fallback');
      ic.textContent = f.dir ? '夹' : (String(f.ext || '').replace('.', '').slice(0, 3).toUpperCase() || '·');
    }
    d.append(el('span', 'file__tag', tag[1]), ic, el('div', 'file__name', f.name));

    d.addEventListener('pointerdown', e => onFileDown(e, f));
    d.addEventListener('dblclick', e => { e.stopPropagation(); window.planet.open(f.path); });
    d.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); fileMenu(e, f); });
    d.addEventListener('mouseenter', e => showTip(e.clientX, e.clientY, f.name));
    d.addEventListener('mouseleave', hideTip);
    floorHolder.appendChild(d);
  }
}

/* ---------------- 底部应用坞 ---------------- */

/** 拆桌面：应用快捷方式进坞，其余文件留在地毯/书架 */
function applyDesktop(d) {
  const all = d && Array.isArray(d.files) ? d.files : [];
  // self 仍算「应用快捷方式」以便从地毯过滤掉，但不渲染进坞
  S.apps = all.filter(isAppShortcut).filter(f => !f.self);
  S.desktop = Object.assign({}, d || {}, { files: all.filter(f => !isAppShortcut(f)) });
  return S.desktop;
}

function dockData() {
  if (!S.layout.dock || typeof S.layout.dock !== 'object') {
    S.layout.dock = { cols: 3, items: [] };
  }
  S.layout.dock.cols = PM.clampDockCols(S.layout.dock.cols);
  if (!Array.isArray(S.layout.dock.items)) S.layout.dock.items = [];
  return S.layout.dock;
}

/** 每次桌面变化后对齐：保留旧摆位，新应用落到最空的一组 */
function ensureDock() {
  const d = dockData();
  const before = JSON.stringify({ cols: d.cols, items: d.items });
  d.items = PM.reconcileDock(d.items, S.apps.map(a => a.path), d.cols);
  if (before !== JSON.stringify({ cols: d.cols, items: d.items })) saveLayout();
}

/** 分栏只是「自由摆位的槽」，不带分类名称：用户想把哪个应用放哪一栏都行。
    曾经的「工作 / 工具 / 娱乐」「常用 / 其他」会暗示按类归放，已全部移除。 */

function dockItemNode(app) {
  const b = el('button', 'dock__item');
  b.type = 'button';
  b.dataset.key = app.path;
  b.title = app.name;
  const icon = el('span', 'dock__icon');
  const src = S.icons[app.path];
  if (src) {
    const img = el('img');
    img.src = src;
    img.alt = '';
    img.draggable = false;
    icon.appendChild(img);
  } else {
    icon.appendChild(el('span', 'dock__fallback', PM.shortName(app.name, 1) || '·'));
  }
  b.append(icon, el('span', 'dock__name', PM.shortName(app.name, 4)));
  b.addEventListener('pointerdown', e => { if (e.button === 0) onDockDown(e, app); });
  b.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); dockMenu(e, app); });
  b.addEventListener('mouseenter', e => showTip(e.clientX, e.clientY, app.name));
  b.addEventListener('mouseleave', hideTip);
  b.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.planet.open(app.path); }
  });
  return b;
}

function renderDock() {
  const d = dockData();
  const box = $('#dockGroups');
  box.innerHTML = '';

  if (!S.apps.length) {
    box.appendChild(el('div', 'dock__none', '桌面上还没有应用快捷方式'));
    return;
  }

  const byKey = new Map(S.apps.map(a => [a.path, a]));
  for (let g = 0; g < d.cols; g++) {
    const group = el('div', 'dock__group');
    group.dataset.g = String(g);
    // 不渲染分栏名称：每组只是一条空槽，任何应用都能拖进任意栏
    const list = el('div', 'dock__items');
    list.dataset.g = String(g);
    const items = d.items.filter(i => i.g === g).sort((a, b) => a.o - b.o);
    for (const it of items) {
      const app = byKey.get(it.key);
      if (app) list.appendChild(dockItemNode(app));
    }
    // 空栏不再写「拖到这里」：虚线槽 + 拖入高亮已经说明可放，小字能省则省
    group.appendChild(list);
    box.appendChild(group);
  }
}

function setDockCols(n) {
  const d = dockData();
  const cols = PM.clampDockCols(n);
  if (d.cols === cols) return;
  d.cols = cols;
  d.items = PM.setDockCols(d.items, cols);
  renderDock();
  saveLayout();
  toast(cols === 2 ? '已切到 2 栏' : '已切到 3 栏');
}

/** 指针落在哪一栏、插入第几位（按目标组里除自己之外的图标中心算） */
function dockTargetAt(x) {
  const groups = $$('.dock__group');
  if (!groups.length) return null;
  let target = groups[0], best = Infinity;
  for (const g of groups) {
    const r = g.getBoundingClientRect();
    const dist = x < r.left ? r.left - x : (x > r.right ? x - r.right : 0);
    if (dist < best) { best = dist; target = g; }
  }
  const g = Number(target.dataset.g);
  const items = Array.from(target.querySelectorAll('.dock__item'))
    .filter(n => !n.classList.contains('dragging'));
  let index = items.length;
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect();
    if (x < r.left + r.width / 2) { index = i; break; }
  }
  return { g, index, group: target };
}

function onDockDown(ev, app) {
  const node = ev.currentTarget;
  const startX = ev.clientX, startY = ev.clientY;
  let moved = false, ghost = null, last = null;

  dragging = { kind: 'dock' };
  setIgnore(false);
  hideTip();
  ev.stopPropagation();
  ev.preventDefault();

  const move = e => {
    if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
    if (!moved) {
      moved = true;
      node.classList.add('dragging');
      ghost = node.cloneNode(true);
      ghost.classList.add('dock-ghost');
      document.body.appendChild(ghost);
    }
    ghost.style.left = e.clientX + 'px';
    ghost.style.top = e.clientY + 'px';
    last = dockTargetAt(e.clientX);
    $$('.dock__group').forEach(g => g.classList.toggle('drop', !!last && g === last.group));
  };

  const finish = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
    node.classList.remove('dragging');
    $$('.dock__group').forEach(g => g.classList.remove('drop'));
    if (ghost) ghost.remove();
    if (dragging && dragging.kind === 'dock') dragging = null;
    refreshIgnore();
  };
  const cancel = () => finish();

  const up = e => {
    const wasMoved = moved;
    finish();
    if (!wasMoved) { window.planet.open(app.path); return; }
    const t = last || dockTargetAt(e.clientX);
    if (!t) return;
    const d = dockData();
    d.items = PM.moveDockItem(d.items, app.path, t.g, t.index, d.cols);
    renderDock();
    saveLayout();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
}

function dockMenu(e, app) {
  const d = dockData();
  const items = [
    { label: '打开', run: () => window.planet.open(app.path) },
    { label: '在资源管理器中显示', run: () => window.planet.reveal(app.path) },
    { sep: true },
  ];
  for (let g = 0; g < d.cols; g++) {
    items.push({
      // 只报栏号，不预设「这栏该放什么」；2 栏 / 3 栏都适用
      label: '移到第 ' + (g + 1) + ' 栏',
      run: () => {
        const dd = dockData();
        const n = dd.items.filter(i => i.g === g && i.key !== app.path).length;
        dd.items = PM.moveDockItem(dd.items, app.path, g, n, dd.cols);
        renderDock();
        saveLayout();
      },
    });
  }
  // 分栏数量不再占用坞顶按钮：收进应用图标的右键菜单，默认 3 栏
  items.push({ sep: true });
  [2, 3].forEach(n => {
    items.push({
      label: n === d.cols ? '当前 ' + n + ' 栏' : '改为 ' + n + ' 栏',
      run: () => { if (n !== d.cols) setDockCols(n); },
    });
  });
  showMenu(e.clientX, e.clientY, items);
}

function onFileDown(ev, f) {
  if (ev.button !== 0) return;
  ev.stopPropagation();
  const group = S.selected.has(f.path)
    ? S.desktop.files.filter(x => S.selected.has(x.path))
    : [];
  const files = group.length ? group : [f];
  const nodes = files
    .map(x => $$('.file').find(n => n.dataset.path === x.path))
    .filter(Boolean);
  const startX = ev.clientX, startY = ev.clientY;
  let moved = false;

  nodes.forEach(n => n.classList.add('dragging'));
  setIgnore(false);

  const move = e => {
    const dx = (e.clientX - startX) / SCALE;
    const dy = (e.clientY - startY) / SCALE;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    nodes.forEach(n => { n.style.setProperty('--dx', dx + 'px'); n.style.setProperty('--dy', dy + 'px'); });
    highlightTargets(targetsAt(e.clientX, e.clientY));
  };

  const up = async e => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
    const dx = (e.clientX - startX) / SCALE;
    const dy = (e.clientY - startY) / SCALE;
    nodes.forEach(n => {
      n.classList.remove('dragging');
      n.style.removeProperty('--dx');
      n.style.removeProperty('--dy');
    });
    clearHighlight();
    dragging = null;
    refreshIgnore();
    if (!moved) {
      if (S.selectMode) toggleSelect(f.path);
      else showTip(e.clientX, e.clientY, '拖到书架收纳；点「点选模式」可多选', 1800);
      return;
    }
    await dropFiles(files, targetsAt(e.clientX, e.clientY), dx, dy, e.clientX, e.clientY);
  };
  const cancel = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
    nodes.forEach(n => {
      n.classList.remove('dragging');
      n.style.removeProperty('--dx');
      n.style.removeProperty('--dy');
    });
    clearHighlight();
    dragging = null;
    refreshIgnore();
  };

  dragging = { kind: 'files', files };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
}

async function dropFiles(files, t, dx, dy, x, y) {
  if (t.bin) {
    const label = files.length > 1 ? '把这 ' + files.length + ' 个文件' : '把「' + files[0].name + '」';
    if (!await askConfirm(label + '放进回收站？<br><span style="color:#A58181;font-size:10.5px">走系统回收站，可恢复</span>')) return;
    let fail = 0, firstErr = '';
    for (const f of files) {
      const r = await window.planet.trash(f.path);
      if (!r.ok) { fail++; firstErr = firstErr || r.error; }
    }
    clearSelection();
    await refreshAll();
    if (fail) showTip(x, y, fail + ' 个没删掉：' + firstErr, 3000);
    return;
  }

  if (t.figure >= 0) {
    const img = files.find(isFigureImage);
    if (!img) { showTip(x, y, '展柜只收 PNG / GIF', 2400); clearSelection(); return; }
    const r = await window.planet.figureSet(t.figure, img.path);
    if (r.ok) {
      S.show = r.showcase;
      renderShow();
      showTip(x, y, r.hint || ('放进第 ' + (t.figure + 1) + ' 位啦（文件仍在地毯上）'), r.hint ? 3200 : 2400);
    } else showTip(x, y, r.error || '没放进去', 2600);
    clearSelection();
    return;
  }

  if (t.polaroid >= 0) {
    const img = files.find(isAlbumImage);
    if (!img) { showTip(x, y, '相册只放图片', 2200); clearSelection(); return; }
    const r = await window.planet.albumSet(ALBUM_IDS[t.polaroid], img.path);
    if (r.ok) {
      S.album = r.album;
      renderAlbum(t.polaroid);
      showTip(x, y, '挂上麻绳了（文件仍在地毯上）', 2400);
    } else showTip(x, y, r.error || '没放进去', 2600);
    clearSelection();
    return;
  }

  if (t.row >= 0) {
    await shelveFiles(files, t.row);
    return;
  }

  const z = floorSize();
  for (const f of files) {
    const p = poseOf(f.name);
    const c = PM.clampPos(p.x + dx, p.y + dy, CARD_W, CARD_H, z.w, z.h);
    p.x = c.x;
    p.y = c.y;
  }
  saveLayout();
  renderFloor();
  clearSelection();
}

/* ---------------- 点选模式 ---------------- */

function toggleSelectMode(on) {
  S.selectMode = typeof on === 'boolean' ? on : !S.selectMode;
  document.body.classList.toggle('selecting', S.selectMode);
  const btn = $('#btnSelect');
  btn.classList.toggle('on', S.selectMode);
  btn.setAttribute('aria-pressed', String(S.selectMode));
  if (!S.selectMode) clearSelection();
  renderFloor();
}

function toggleSelect(path) {
  if (S.selected.has(path)) S.selected.delete(path);
  else S.selected.add(path);
  $$('.file').forEach(n => n.classList.toggle('sel', S.selected.has(n.dataset.path)));
  updateSelectbar();
}

function clearSelection() {
  if (!S.selected.size) { updateSelectbar(); return; }
  S.selected.clear();
  $$('.file.sel').forEach(n => n.classList.remove('sel'));
  updateSelectbar();
}

function updateSelectbar() {
  $('#selCount').textContent = String(S.selected.size);
}

function selectedFiles() {
  return S.desktop.files.filter(f => S.selected.has(f.path));
}

/* ---------------- 书架 ---------------- */

function bookWidth(e) {
  const look = bookLook(e);
  if (look === 'doc') return 22;
  // 文件夹（含快捷方式）与资料同款竖排书脊：比资料宽 2px，给四个字留一点横向余量
  return 24;
}

/** 书脊统一高度：以「春夏秋冬备忘」那本（66px）为基准。
    之前按文件名哈希在 54–71px 之间抖动，书脊顶边本来就不齐；文字又从书脊底部对齐，
    字数不同、数字混排比汉字矮，会让第一个字的起笔高度差出十几像素，不同格式看着更乱。
    现在所有书（资料 / 文件夹 / 快捷方式）同高，文字一律从顶部固定留白处起笔。
    66px 正好排下六个整字：8.5px 字号 + 0.3 字距 ≈ 8.8/字，六字 ≈ 52.8px，
    顶部留 10px、底部还剩 3px，不压层板。 */
const SPINE_H = 66;
function docHeight() { return SPINE_H; }

function rowInner(row) {
  const r = $$('.shelf__row')[row];
  return r ? r.clientWidth - 20 : 316;
}

function shelfUsage() {
  const used = [0, 0, 0, 0, 0];
  for (const e of S.shelf) used[clampRow(e.row)] += bookWidth(e) + 3;
  return used;
}

function renderShelf() {
  const rows = $$('.shelf__row');
  const sorted = S.shelf.slice().sort((a, b) => {
    const ra = clampRow(a.row), rb = clampRow(b.row);
    if (ra !== rb) return ra - rb;
    const ao = Number.isFinite(a.order) ? a.order : 1e6;
    const bo = Number.isFinite(b.order) ? b.order : 1e6;
    return ao - bo;
  });

  rows.forEach((rowEl, ri) => {
    rowEl.innerHTML = '';
    const list = sorted.filter(e => clampRow(e.row) === ri);
    // 空层不再挂提示小字：拖入时整层高亮（.hot）已经足够说明，
    // 收纳语义在说明抽屉里也有完整描述。
    if (!list.length) return;
    for (const entry of list) {
      const look = bookLook(entry);
      const b = el('div', 'book ' + look);
      b.dataset.entry = entry.id;
      b.dataset.row = String(ri);
      b.dataset.name = entry.name;
      // 三类书脊统一高度：底边都落在层板上，顶边自然齐平，文字起笔也在同一水平线
      const h = look === 'doc' ? docHeight() : SPINE_H;
      b.style.width = bookWidth(entry) + 'px';
      b.style.height = h + 'px';
      if (look === 'doc') {
        const ink = inkOf(entry);
        b.style.setProperty('--ink', ink[0]);
        b.style.setProperty('--ink-dark', ink[1]);
        // 中段底色浅化承托深墨粗字；两侧立边仍是原格式色，按格式配色不丢
        b.style.setProperty('--ink-light', PM.lightenInk(ink[0]));
        // 统一 66px 书脊固定排六个整字（短名按实际字数），不留半截字；
        // 全名仍在 data-name 与悬停提示里。仍走 spineChars(h)，书高若调整会自适应。
        b.appendChild(el('span', 'spine-name', PM.shortName(entry.name, PM.spineChars(h))));
      } else {
        // 文件夹（含快捷方式）与资料同款：书脊上竖排前四个字，不再用正面 2×2 标签，
        // 也不再显示子项数量角标。暖牛皮色 / 蓝灰折角只用来区分类型，不改排版。
        b.appendChild(el('span', 'spine-name', PM.shortName(entry.name, 4)));
      }
      b.addEventListener('mouseenter', e => showTip(e.clientX, e.clientY, entry.name));
      b.addEventListener('mouseleave', hideTip);
      b.addEventListener('click', e => { e.stopPropagation(); window.planet.open(entry.storedPath); });
      b.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); bookMenu(e, entry); });
      b.addEventListener('pointerdown', e => { if (e.button === 0) { e.stopPropagation(); onBookDown(e, entry); } });
      rowEl.appendChild(b);
    }
  });

}

function onBookDown(ev, entry) {
  const startX = ev.clientX, startY = ev.clientY;
  const node = ev.currentTarget;
  let moved = false;
  beginGhost(entry.name, ev.clientX, ev.clientY);
  setIgnore(false);
  dragging = { kind: 'book', entry };

  const move = e => {
    if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) {
      moved = true;
      node.classList.add('dragging');
    }
    const t = targetsAt(e.clientX, e.clientY);
    moveGhost(e.clientX, e.clientY, t.row >= 0 || t.bin);
    highlightTargets(t);
    if (t.row >= 0) {
      const slot = bookSlot(e.clientX, t.row, entry.id);
      moveGhost(e.clientX, e.clientY, '第 ' + (t.row + 1) + ' 层 · 第 ' + (slot.order + 1) + ' 位');
    }
  };

  const up = async e => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
    endGhost();
    node.classList.remove('dragging');
    clearHighlight();
    dragging = null;
    refreshIgnore();
    if (!moved) return;
    const t = targetsAt(e.clientX, e.clientY);

    if (t.bin) {
      if (!await askConfirm('把「' + esc(entry.name) + '」放进回收站？<br><span style="color:#A58181;font-size:10.5px">走系统回收站，可恢复</span>')) return;
      const r = await window.planet.trash(entry.storedPath);
      if (!r.ok) { showTip(e.clientX, e.clientY, r.error || '没删掉', 2600); return; }
      await window.planet.discardBook(entry.id);
      await refreshAll();
      return;
    }

    if (t.row >= 0) {
      const slot = bookSlot(e.clientX, t.row, entry.id);
      const r = await window.planet.moveBook(entry.id, slot.row, slot.order);
      if (r.ok) {
        await refreshAll();
        const n = $$('.book').find(x => x.dataset.entry === entry.id);
        if (n) { n.classList.add('just-moved'); setTimeout(() => n.classList.remove('just-moved'), 1100); }
        showTip(e.clientX, e.clientY, '已放到第 ' + (slot.row + 1) + ' 层 · 第 ' + (slot.order + 1) + ' 位', 1600);
      } else showTip(e.clientX, e.clientY, r.error || '没放稳，再试一次', 2400);
      return;
    }

    const r = await window.planet.restore(entry.id);
    if (r.ok) {
      await refreshAll();
      showTip(e.clientX, e.clientY, '已还原：' + String(r.path || '').split(/[\\/]/).pop(), 2200);
    } else showTip(e.clientX, e.clientY, r.error || '还原失败', 2800);
  };

  const cancel = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
    endGhost();
    node.classList.remove('dragging');
    clearHighlight();
    dragging = null;
    refreshIgnore();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
}

/** 层内插入位：按同层书脊中心比较，跟眼睛看到的一致 */
function bookSlot(x, row, movingId) {
  const others = $$('.book')
    .filter(n => n.dataset.entry !== movingId && Number(n.dataset.row) === row);
  let order = 0;
  for (const n of others) {
    const r = n.getBoundingClientRect();
    if (x > r.left + r.width / 2) order++;
  }
  return { row, order };
}

async function shelveFiles(files, preferredRow) {
  if (!files.length) return;
  const ok = await ensureShelfWarn();
  if (!ok) return;

  const used = shelfUsage();
  let row = Number.isInteger(preferredRow) ? preferredRow : 4;
  let done = 0, fail = 0, firstErr = '', firstRow = -1;

  for (const f of files) {
    const need = bookWidth(f) + 3;
    while (row >= 0 && used[row] + need > rowInner(row)) row--;
    if (row < 0) { fail++; firstErr = firstErr || '书架放不下了，先还原几本'; break; }
    const r = await window.planet.shelve(f.path, row);
    if (r.ok) {
      done++;
      used[row] += need;
      if (firstRow < 0) firstRow = row;
    } else {
      fail++;
      firstErr = firstErr || (r.error || '收纳失败');
    }
  }

  clearSelection();
  await refreshAll();
  if (fail) toast(done + ' 个已收纳，' + fail + ' 个没进去：' + firstErr);
  else toast(done > 1 ? '已收纳 ' + done + ' 个，整整齐齐' : '收进第 ' + (firstRow + 1) + ' 层啦');
}

async function ensureShelfWarn() {
  if (localStorage.getItem('planet.shelfWarned')) return true;
  const ok = await askConfirm(
    '收纳会把文件<b>真正移动</b>到收纳目录，桌面上的原件会消失。<br>' +
    '<span style="color:#A58181;font-size:10.5px">每次移动都写日志，可在「收纳记录」里一键还原。</span>');
  if (ok) localStorage.setItem('planet.shelfWarned', '1');
  return ok;
}

/* ---------------- 相册 ---------------- */

const isAlbumImage = f => {
  const ext = String(f.ext || (String(f.name).match(/\.[^.]+$/) || [''])[0]).toLowerCase();
  return S.albumExts.has(ext);
};
const isFigureImage = f => /^\.(png|gif)$/i.test(String(f.ext || (String(f.name).match(/\.[^.]+$/) || [''])[0]));

function renderAlbum(developIndex) {
  const box = $('#polaroids');
  box.innerHTML = '';
  const rots = [-7, 5, -4, 8];
  ALBUM_IDS.forEach((id, i) => {
    const e = S.album[id];
    const p = el('div', 'polaroid' + (e ? '' : ' empty'));
    p.dataset.pi = String(i);
    p.style.left = (4 + i * 82) + 'px';
    p.style.top = (34 + (i % 2 ? 10 : 0)) + 'px';
    p.style.setProperty('--rot', rots[i] + 'deg');
    p.innerHTML = '<div class="clip"></div>' +
      '<div class="polaroid__img">' + (e ? '<img src="' + e.url + '" alt="" draggable="false">' : '') + '</div>' +
      // 空相册只留「+」和斜纹虚线框（与房间主题的空相框一致），四张都写小字太挤；
      // 交互引导交给 hover 提示，有图时仍显示文件名。
      (e ? '<div class="polaroid__cap">' + esc(e.name) + '</div>' : '');
    p.addEventListener('click', ev => {
      ev.stopPropagation();
      if (e) window.planet.albumOpen(id);
      else pickAlbum(id, ev.clientX, ev.clientY);
    });
    p.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); albumMenu(ev, id); });
    p.addEventListener('mouseenter', ev => showTip(ev.clientX, ev.clientY, e ? e.name + '　右键可换图 / 清空' : '点我选一张，或把图片拖进来'));
    p.addEventListener('mouseleave', hideTip);
    box.appendChild(p);
    if (developIndex === i) {
      p.classList.add('developing');
      setTimeout(() => p.classList.remove('developing'), 1200);
    }
  });
}

async function pickAlbum(id, x, y) {
  const r = await window.planet.albumPick(id);
  if (r.canceled) return;
  if (r.ok) {
    S.album = r.album;
    renderAlbum(ALBUM_IDS.indexOf(id));
    if (x != null) showTip(x, y, '显影完成，挂上麻绳啦', 1800);
  } else if (x != null) showTip(x, y, r.error || '没放进去', 2400);
}

function albumMenu(e, id) {
  const has = !!S.album[id];
  const items = [{ label: has ? '换一张' : '选择图片', run: () => pickAlbum(id, e.clientX, e.clientY) }];
  if (has) {
    items.push({ label: '打开大图', run: () => window.planet.albumOpen(id) });
    items.push({ label: '打开原图位置', run: async () => {
      const r = await window.planet.albumReveal(id);
      if (!r.ok) showTip(e.clientX, e.clientY, r.error, 2600);
    } });
    items.push({ sep: true });
    items.push({ label: '清空这张', danger: true, run: async () => {
      const r = await window.planet.albumClear(id);
      if (!r.ok) { showTip(e.clientX, e.clientY, r.error, 2400); return; }
      S.album = r.album;
      renderAlbum();
    } });
  }
  showMenu(e.clientX, e.clientY, items);
}

/* ---------------- 今日小愿望 ---------------- */

function renderTodos() {
  const box = $('#todoList');
  box.innerHTML = '';
  S.layout.todos.forEach((t, i) => {
    const d = el('div', 'todo');
    d.dataset.id = t.id;
    d.style.setProperty('--rot', (Number.isFinite(t.rot) ? t.rot : 0) + 'deg');
    const txt = el('div', 'todo__text', t.text);
    const del = el('div', 'todo__del', '×');
    del.title = '做完就撕掉（可撤销）';
    txt.addEventListener('click', ev => { ev.stopPropagation(); if (!suppressClick) openTodoEditor(t.id); });
    del.addEventListener('pointerdown', ev => ev.stopPropagation());
    del.addEventListener('click', ev => { ev.stopPropagation(); deleteTodo(t.id); });
    d.append(txt, del);
    d.addEventListener('pointerdown', ev => onTodoDown(ev, t, d));
    box.appendChild(d);
  });
  const add = el('div', 'todo add', '+');
  add.title = '写一张新便签';
  add.addEventListener('click', () => openTodoEditor(null));
  box.appendChild(add);
}

let suppressClick = false;

function onTodoDown(ev, t, node) {
  if (ev.button !== 0) return;
  if (ev.target.closest('.todo__del')) return;
  const startX = ev.clientX, startY = ev.clientY;
  let moved = false;
  // 拖出便签范围后会经过柜体空白：锁住穿透并标记 dragging，
  // 否则 mousemove 会把整层重新设成穿透，pointerup 收不到，便签卡在半路
  dragging = { kind: 'todo' };
  setIgnore(false);
  const move = e => {
    const dx = (e.clientX - startX) / SCALE;
    const dy = (e.clientY - startY) / SCALE;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      moved = true;
      node.style.setProperty('--dx', dx + 'px');
      node.style.setProperty('--dy', dy + 'px');
      const t2 = targetsAt(e.clientX, e.clientY);
      $('#bin').classList.toggle('hot', !!t2.bin);
    }
  };
  const finish = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
    node.style.removeProperty('--dx');
    node.style.removeProperty('--dy');
    $('#bin').classList.remove('hot');
    if (dragging && dragging.kind === 'todo') dragging = null;
    refreshIgnore();
  };
  const cancel = () => finish();
  const up = async e => {
    const wasMoved = moved;
    finish();
    if (!wasMoved) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 260);
    const t2 = targetsAt(e.clientX, e.clientY);
    if (t2.bin) archiveTodo(t.id);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
}

async function archiveTodo(id) {
  const i = S.layout.todos.findIndex(t => t.id === id);
  if (i < 0) return;
  const t = S.layout.todos[i];
  if (!await askConfirm('把这张便签丢进糖果罐？<br><span style="color:#A58181;font-size:10.5px">会存成文本归档，不是直接消失</span>')) return;
  const r = await window.planet.archiveNote(t.text);
  if (!r.ok) { toast(r.error || '归档失败'); return; }
  S.layout.todos.splice(i, 1);
  saveLayout();
  renderTodos();
  toast('便签已归档成文本', { label: '打开', fn: () => window.planet.openNotesArchive() });
}

function deleteTodo(id) {
  const i = S.layout.todos.findIndex(t => t.id === id);
  if (i < 0) return;
  const removed = S.layout.todos[i];
  S.layout.todos.splice(i, 1);
  saveLayout();
  renderTodos();
  const label = String(removed.text || '').split('\n')[0].slice(0, 10);
  toast('撕掉了「' + label + '」', {
    label: '撤销',
    fn: () => {
      S.layout.todos = PM.insertAt(S.layout.todos, i, removed);
      saveLayout();
      renderTodos();
      toast('便签回来啦');
    },
  });
}

async function openTodoEditor(id) {
  const t = S.layout.todos.find(x => x.id === id);
  openModal('<h3>' + (t ? '改改这张便签' : '写一张新便签') + '</h3>' +
    '<p>可以写很多行，Ctrl + Enter 保存</p>' +
    '<textarea class="editor" id="todoText" placeholder="今天想做点什么…">' + (t ? esc(t.text) : '') + '</textarea>' +
    '<div class="modal__actions">' +
    (t ? '<button class="btn danger" id="todoDel">撕掉</button>' : '') +
    '<button class="btn" id="todoCancel">取消</button>' +
    '<button class="btn primary" id="todoSave">贴上去</button></div>');
  await window.planet.focus(true);
  const ta = $('#todoText');
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  const save = () => {
    const v = ta.value.trim();
    if (!v) { toast('还没写内容呢'); return; }
    if (t) t.text = v;
    else S.layout.todos.unshift({ id: 't' + Date.now(), text: v, rot: +(Math.random() * 2.4 - 1.2).toFixed(1) });
    saveLayout();
    closeModal();
    renderTodos();
    toast('便签贴好啦');
  };
  $('#todoSave').addEventListener('click', save);
  $('#todoCancel').addEventListener('click', closeModal);
  if ($('#todoDel')) $('#todoDel').addEventListener('click', () => { closeModal(); deleteTodo(id); });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
    if (e.key === 'Escape') closeModal();
  });
}

/* ---------------- 展柜 ---------------- */

async function switchSeries(key) {
  if (!SERIES[key]) return;
  // 已选中的系列不再重绘：否则双击改名时按钮会被第一次 click 换掉，dblclick 收不到
  if (key === S.show.series) return;
  // 每个系列各自一套图片 / 摆位 / 站位数：只告诉主进程「切到哪个系列」，
  // 由它返回该系列自己的 showcase（不再把旧系列的 count/poses 带过去）。
  const r = await window.planet.figureSave({ series: key });
  if (!r.ok) { toast(r.error || '切换失败'); return; }
  S.show = r.showcase;
  renderShow();
  toast('换到「' + seriesLabel(key) + '」· 这个系列有自己的形象与摆位');
}

async function persistShow() {
  const r = await window.planet.figureSave({ series: S.show.series, count: S.show.count });
  if (r.ok) S.show = r.showcase;
}

function renderShow() {
  const P = PM.seriesOf(S.show.series);
  const zone = $('#zoneShow');
  zone.style.setProperty('--sc-a', P.a);
  zone.style.setProperty('--sc-b', P.b);
  zone.style.setProperty('--sc-lamp', P.lamp);

  renderSeriesTabs();
  $('#slotCount').textContent = S.show.count + ' 只';

  const grid = $('#showGrid');
  grid.innerHTML = '';
  const defaults = PM.stagesFor(S.show.count);
  const bases = [];
  for (let i = 0; i < S.show.count; i++) bases.push(defaults[i] || defaults[defaults.length - 1]);
  for (let i = 0; i < S.show.count; i++) {
    const base = bases[i];
    const custom = S.show.poses && S.show.poses[i];
    const x = custom ? custom.x : base.x;
    const y = custom ? custom.y : base.y;
    // 自由摆位后按脚底线重算景深：站得越靠下越大、越靠前，不会一个尺寸贴到底。
    // 用户用滚轮定过层级时，明暗/模糊跟着那一层走。
    const depth = custom ? PM.poseScale(base, y, custom.z) : base;
    const slot = S.show.slots[i];
    const zoom = zoomOf(i);
    // 倾斜度：手动调过就用 poses[i].rot，否则用该站位的默认角度
    const rot = custom && Number.isFinite(Number(custom.rot)) ? Number(custom.rot) : base.rot;
    const tagText = (slot ? esc(slot.name || '我的收藏') : '原创占位 · 可拖动') +
      (Math.abs(zoom - 1) > 0.01 ? ' · ' + Math.round(zoom * 100) + '%' : '');
    const fig = el('div', 'figure');
    fig.dataset.i = String(i);
    fig.dataset.pose = custom ? 'custom' : 'default';
    fig.tabIndex = 0;
    fig.setAttribute('role', 'button');
    fig.setAttribute('aria-label', '展柜第 ' + (i + 1) + ' 位，' +
      (slot ? '已放入 ' + (slot.name || '我的收藏') : '原创占位，点击上传 PNG 或 GIF') +
      '，按住可拖动摆放，滚轮缩放');
    // 景深只决定大小与层叠顺序，不再给后排玩偶自动加暗/模糊；
    // 缩放（--zoom）由滚轮控制，和景深的 --s 相乘，互不干扰。
    fig.style.cssText = '--x:' + x + '%;--y:' + y + '%;--w:' + base.w + 'px;--h:' + base.h +
      'px;--s:' + depth.s + ';--z:' + depth.z + ';--rot:' + rot + 'deg;--b:1;--blur:0px;--zoom:' + zoom;
    fig.innerHTML = '<div class="figure__shadow"></div><div class="figure__stand"></div>' +
      '<div class="figure__body">' + (slot ? '<img src="' + slot.url + '" alt="" draggable="false">' : placeholder(i)) + '</div>' +
      '<div class="figure__tag">' + tagText + '</div>' +
      '<div class="figure__x" title="移除这张">×</div>' +
      '<div class="figure__move"><button data-a="ccw" title="向左倾斜">‹</button><button data-a="cw" title="向右倾斜">›</button></div>';

    fig.querySelector('.figure__x').addEventListener('click', e => { e.stopPropagation(); clearFigure(i); });
    Array.from(fig.querySelectorAll('.figure__move button')).forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        nudgeRotate(i, b.dataset.a === 'ccw' ? -1 : 1, e.clientX, e.clientY);
      });
    });
    fig.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); figureMenu(e, i); });
    // 倾倒度 / 移除 / 系列标签这些控件自己处理交互，别再走「按下拖拽、没动就弹添加图片」
    const CTRL = '.figure__move, .figure__x, .figure__tag';
    fig.addEventListener('keydown', e => {
      if (e.target.closest(CTRL)) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFigure(i); }
    });
    fig.addEventListener('pointerdown', e => {
      if (e.target.closest(CTRL)) return;   // 点 ‹ › 只调倾斜，不再误弹添加图片窗
      if (e.button === 0) { e.stopPropagation(); onFigureDown(e, fig, i); }
    });
    // 滚轮调前后：上滚往前、下滚往后，一格一层
    fig.addEventListener('wheel', e => {
      e.preventDefault();
      e.stopPropagation();
      onFigureWheel(e, i);
    }, { passive: false });
    grid.appendChild(fig);
  }
}

/* ---------------- 手动层级：滚轮 / 右键 ---------------- */

let depthSaveTimer = null;
let depthSaveSeq = 0;
// 连续滚动时锁定同一只玩偶：层级一变，指针可能落到另一只身上，不锁会变成轮换调所有人
let depthWheel = { i: -1, at: 0 };

function figureBase(i) {
  const defaults = PM.stagesFor(S.show.count);
  return defaults[i] || defaults[defaults.length - 1];
}

function currentPose(i) {
  const base = figureBase(i);
  const c = S.show.poses && S.show.poses[i];
  return c ? { x: c.x, y: c.y, z: c.z } : { x: base.x, y: base.y, z: null };
}

function poseArray() {
  const poses = (S.show.poses || []).slice(0, 6);
  while (poses.length < 6) poses.push(null);
  return poses;
}

/** 当前每只玩偶的实际层级（手动优先，没手动就用脚底线推算） */
function effectiveZs() {
  const out = [];
  for (let i = 0; i < S.show.count; i++) {
    const p = S.show.poses && S.show.poses[i];
    out.push(p ? PM.poseScale(figureBase(i), p.y, p.z).z : figureBase(i).z);
  }
  return out;
}

async function persistPoses() {
  clearTimeout(depthSaveTimer);
  depthSaveTimer = null;
  const seq = ++depthSaveSeq;
  const r = await window.planet.figureSave({ poses: poseArray() });
  if (seq !== depthSaveSeq) return;          // 已经有更新的一次保存，忽略旧结果
  if (r.ok) S.show = r.showcase;
  else toast(r.error || '层级没记住');
}

function persistPosesSoon() {
  clearTimeout(depthSaveTimer);
  depthSaveTimer = setTimeout(() => { persistPoses(); }, 320);
}

/** 名次 → 明暗比例：0 最后、1 最前。两只时就是 0 / 1。 */
function depthFrontness(rank, count) {
  return count > 1 ? (rank - 1) / (count - 1) : 1;
}

/** 把某一只的层级变化画到界面上：z、明暗、模糊、悬停标签一起更新 */
function paintFigureDepth(j, z, rank) {
  const fig = document.querySelector('.figure[data-i="' + j + '"]');
  if (!fig) return;
  const cur = currentPose(j);
  const d = PM.poseScale(figureBase(j), cur.y, z);
  fig.style.setProperty('--z', d.z);
  fig.style.setProperty('--b', 1);
  fig.style.setProperty('--blur', '0px');
  const tag = fig.querySelector('.figure__tag');
  if (tag) {
    const slot = S.show.slots[j];
    const zz = zoomOf(j);
    tag.textContent = (slot ? (slot.name || '我的收藏') : '原创占位 · 可拖动') +
      (Math.abs(zz - 1) > 0.01 ? ' · ' + Math.round(zz * 100) + '%' : '');
  }
  fig.classList.add('depth-pulse');
  clearTimeout(fig.__depthPulse);
  fig.__depthPulse = setTimeout(() => fig.classList.remove('depth-pulse'), 240);
}

/** 往前/往后换一层：和相邻名次的那只交换深度槽；到顶/到底返回 null */
function applyDepthStep(i, dir, opts = {}) {
  const zs = effectiveZs();
  const next = PM.stepDepth(zs, i, dir);
  if (!next) return null;
  const ranks = PM.depthRanks(next);
  const poses = poseArray();
  for (let j = 0; j < S.show.count; j++) {
    if (next[j] === zs[j]) continue;
    const cur = currentPose(j);
    const prev = (S.show.poses && S.show.poses[j]) || {};
    poses[j] = Object.assign({ x: cur.x, y: cur.y, z: next[j] },
      Number.isFinite(Number(prev.zoom)) ? { zoom: Number(prev.zoom) } : {},
      Number.isFinite(Number(prev.rot)) ? { rot: Number(prev.rot) } : {});
    paintFigureDepth(j, next[j], ranks[j]);
  }
  S.show.poses = poses;
  if (opts.save) persistPoses();
  else persistPosesSoon();
  return { z: next[i], rank: ranks[i] };
}

/** 直接置于最前 / 最后：一格一格换过去，保证顺序一定改变 */
async function moveDepthToEnd(i, dir) {
  let moved = 0;
  for (let guard = 0; guard < 8; guard++) {
    const ranks = PM.depthRanks(effectiveZs());
    if (dir > 0 ? ranks[i] === S.show.count : ranks[i] === 1) break;
    if (!applyDepthStep(i, dir)) break;
    moved++;
  }
  if (!moved) {
    toast(dir > 0 ? '已经是最前面一层' : '已经是最后面一层');
    return;
  }
  await persistPoses();
  const rank = PM.depthRanks(effectiveZs())[i];
  toast((dir > 0 ? '已置于最前' : '已置于最后') + ' · 第 ' + rank + ' / ' + S.show.count + ' 层');
}

/** 每个玩偶的缩放倍率（1 = 原始大小），缺省按 1 处理 */
function zoomOf(i) {
  const p = S.show.poses && S.show.poses[i];
  const v = p ? Number(p.zoom) : 1;
  return Number.isFinite(v) && v > 0 ? Math.max(0.5, Math.min(2, v)) : 1;
}

/** 滚轮 = 放大 / 缩小当前玩偶（不再调前后层级），缩放倍率写进 poses[i].zoom */
function onFigureWheel(e, target) {
  e.preventDefault();
  e.stopPropagation();
  const i = target;
  if (!(i >= 0 && i < S.show.count)) return;
  const base = figureBase(i);
  const cur = (S.show.poses && S.show.poses[i]) || {};
  const old = zoomOf(i);
  const dir = e.deltaY < 0 ? 1 : -1;          // 上滚放大、下滚缩小
  const next = Math.round(Math.max(0.5, Math.min(2, old + dir * 0.1)) * 100) / 100;
  if (next === old) {
    showTip(e.clientX, e.clientY, dir > 0 ? '已经放到最大' : '已经缩到最小', 1100);
    return;
  }
  const poses = poseArray();
  poses[i] = Object.assign({}, cur, {
    x: Number.isFinite(Number(cur.x)) ? Number(cur.x) : base.x,
    y: Number.isFinite(Number(cur.y)) ? Number(cur.y) : base.y,
    zoom: next,
  });
  S.show.poses = poses;
  const fig = document.querySelector('.figure[data-i="' + i + '"]');
  if (fig) {
    fig.style.setProperty('--zoom', next);
    const tag = fig.querySelector('.figure__tag');
    const slot = S.show.slots[i];
    if (tag) tag.textContent = (slot ? (slot.name || '我的收藏') : '原创占位 · 可拖动') + ' · ' + Math.round(next * 100) + '%';
  }
  persistPosesSoon();
  showTip(e.clientX, e.clientY, (dir > 0 ? '放大' : '缩小') + ' · ' + Math.round(next * 100) + '%', 900);
}

/** 当前倾斜度（度）：手动调过就用 poses[i].rot，否则用该站位的默认角度 */
function rotOf(i) {
  const p = S.show.poses && S.show.poses[i];
  const v = p ? Number(p.rot) : NaN;
  return Number.isFinite(v) ? v : figureBase(i).rot;
}

/** 顶部 ‹ › 按钮 = 调整倾斜度（每次 5°，夹在 ±30°），写进 poses[i].rot */
function nudgeRotate(i, dir, x, y) {
  if (!(i >= 0 && i < S.show.count)) return;
  const base = figureBase(i);
  const cur = (S.show.poses && S.show.poses[i]) || {};
  const old = rotOf(i);
  const next = Math.max(-30, Math.min(30, Math.round(old + dir * 5)));
  if (next === old) {
    showTip(x, y, dir > 0 ? '已经向右倾斜到底' : '已经向左倾斜到底', 1100);
    return;
  }
  const poses = poseArray();
  poses[i] = Object.assign({}, cur, {
    x: Number.isFinite(Number(cur.x)) ? Number(cur.x) : base.x,
    y: Number.isFinite(Number(cur.y)) ? Number(cur.y) : base.y,
    rot: next,
  });
  S.show.poses = poses;
  const fig = document.querySelector('.figure[data-i="' + i + '"]');
  if (fig) {
    fig.style.setProperty('--rot', next + 'deg');
    fig.classList.add('depth-pulse');
    clearTimeout(fig.__depthPulse);
    fig.__depthPulse = setTimeout(() => fig.classList.remove('depth-pulse'), 200);
  }
  persistPosesSoon();
  showTip(x, y, (dir < 0 ? '向左倾斜' : '向右倾斜') + ' · ' + next + '°', 900);
}

async function nudgeDepth(i, dir) {
  const res = applyDepthStep(i, dir, { save: true });
  if (!res) {
    toast(dir > 0 ? '已经是最前面一层' : '已经是最后面一层');
    return;
  }
  toast('已' + (dir > 0 ? '往前' : '往后') + '一层 · 第 ' + res.rank + ' / ' + S.show.count + ' 层');
}

/** 按住玩偶拖动 = 在玻璃柜里自由摆位；松手写盘，点一下（没移动）= 换图 */
function onFigureDown(ev, fig, i) {
  const startX = ev.clientX, startY = ev.clientY;
  const rect = $('#showGrid').getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const defaults = PM.stagesFor(S.show.count);
  const base = defaults[i] || defaults[defaults.length - 1];
  const cur = (S.show.poses && S.show.poses[i]) || { x: base.x, y: base.y };
  const x0 = cur.x, y0 = cur.y;
  const z0 = cur.z != null ? PM.clampDepth(cur.z) : null;
  const zoom0 = Number.isFinite(Number(cur.zoom)) ? Number(cur.zoom) : 1;
  let moved = false;
  let last = { x: x0, y: y0 };

  dragging = { kind: 'figure' };
  setIgnore(false);

  const paint = (x, y) => {
    const p = PM.clampPose(x, y);
    last = p;
    const d = PM.poseScale(base, p.y, z0);
    fig.style.setProperty('--x', p.x + '%');
    fig.style.setProperty('--y', p.y + '%');
    fig.style.setProperty('--s', d.s);
    fig.style.setProperty('--z', d.z);
    fig.style.setProperty('--b', 1);
    fig.style.setProperty('--blur', '0px');
    fig.dataset.pose = 'custom';
  };

  const move = e => {
    const dx = (e.clientX - startX) / SCALE;
    const dy = (e.clientY - startY) / SCALE;
    if (!moved && Math.hypot(dx, dy) > 4) {
      moved = true;
      fig.classList.add('dragging');
    }
    if (!moved) return;
    paint(x0 + dx / rect.width * 100, y0 + dy / rect.height * 100);
  };

  const finish = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
    fig.classList.remove('dragging');
    if (dragging && dragging.kind === 'figure') dragging = null;
    refreshIgnore();
  };
  const cancel = () => {
    finish();
    renderShow();                 // 中途取消就回到已保存的位置
  };

  const up = async e => {
    const wasMoved = moved;
    finish();
    if (!wasMoved) { pickFigure(i); return; }
    const poses = (S.show.poses || []).slice(0, 6);
    while (poses.length < 6) poses.push(null);
    poses[i] = Object.assign({ x: last.x, y: last.y },
      z0 != null ? { z: z0 } : {},
      Math.abs(zoom0 - 1) > 0.001 ? { zoom: zoom0 } : {},
      Number.isFinite(Number(cur.rot)) ? { rot: Number(cur.rot) } : {});
    const r = await window.planet.figureSave({ poses });
    if (r.ok) {
      S.show = r.showcase;
      renderShow();
      showTip(e.clientX, e.clientY, '摆好了 · 右键可回到默认站位', 1800);
    } else {
      toast(r.error || '位置没记住');
      renderShow();
    }
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
}

/** 回到默认站位：which 为 null 时全部重排 */
async function resetPoses(which) {
  const poses = (S.show.poses || []).slice(0, 6);
  while (poses.length < 6) poses.push(null);
  if (which == null) for (let i = 0; i < 6; i++) poses[i] = null;
  else poses[which] = null;
  const r = await window.planet.figureSave({ poses });
  if (!r.ok) { toast(r.error || '没重排'); return; }
  S.show = r.showcase;
  renderShow();
  toast(which == null ? '全部回到默认站位' : '这一位回到默认站位');
}

async function pickFigure(i) {
  const r = await window.planet.figurePick(i);
  if (r.canceled) return;
  if (r.ok) {
    S.show = r.showcase;
    renderShow();
    starsAt(window.innerWidth / 2, window.innerHeight / 2, 8);
    toast(r.hint || ('放进柜里啦 · ' + (/\.gif$/i.test((S.show.slots[i] || {}).name || '') ? 'GIF 动效原样保留' : 'PNG 已就位')));
  } else toast(r.error || '没放进去');
}

async function clearFigure(i) {
  const r = await window.planet.figureClear(i);
  if (!r.ok) { toast(r.error || '没清掉'); return; }
  S.show = r.showcase;
  renderShow();
  toast('这一位清空了，回到原创占位');
}

async function swapFigures(a, b) {
  if (a === b) return;
  const r = await window.planet.figureSwap(a, b);
  if (!r.ok) { toast(r.error || '换位失败'); return; }
  S.show = r.showcase;
  renderShow();
  toast('第 ' + (a + 1) + ' 位和第 ' + (b + 1) + ' 位换好啦');
}

function figureMenu(e, i) {
  const custom = !!(S.show.poses && S.show.poses[i]);
  showMenu(e.clientX, e.clientY, [
    { label: '上传 / 替换图片', run: () => pickFigure(i) },
    ...(S.show.slots[i] ? [{ label: '移除这张', danger: true, run: () => clearFigure(i) }] : []),
    { sep: true },
    { label: '往前一层', run: () => nudgeDepth(i, 1) },
    { label: '往后一层', run: () => nudgeDepth(i, -1) },
    { label: '置于最前', run: () => moveDepthToEnd(i, 1) },
    { label: '置于最后', run: () => moveDepthToEnd(i, -1) },
    { sep: true },
    { label: custom ? '这一位回到默认站位' : '这一位已在默认站位', run: () => resetPoses(i) },
    { label: '全部重排', run: () => resetPoses(null) },
    { label: '与下一位交换形象', run: () => swapFigures(i, (i + 1) % S.show.count) },
  ]);
}

function starsAt(x, y, n) {
  for (let i = 0; i < (n || 7); i++) {
    const s = el('div', 'star');
    s.style.position = 'fixed';
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    s.style.animation = 'none';
    s.style.transition = 'transform .75s cubic-bezier(.2,.8,.3,1), opacity .75s';
    s.innerHTML = '<svg viewBox="0 0 20 20" width="12" height="12"><path d="M10 0l2.2 6.2L19 8.5l-6 3.3L10 19l-3-7.2-6-3.3 6.8-2.3z" fill="#F2A0C4"/></svg>';
    document.body.appendChild(s);
    const a = Math.PI * 2 * i / (n || 7);
    const d = 30 + hash('star' + i + Date.now()) % 46;
    requestAnimationFrame(() => {
      s.style.transform = 'translate(' + Math.cos(a) * d + 'px,' + Math.sin(a) * d + 'px) scale(.4)';
      s.style.opacity = '0';
    });
    setTimeout(() => s.remove(), 800);
  }
}

/* ---------------- 唱片机 ---------------- */

const audio = document.getElementById('audio-el');
const player = new window.PlayerState.PlayerState({ mode: 'all' });
let demoTimer = null, actx = null;

const audioUrl = p => 'xome-planet-audio://track?p=' + encodeURIComponent(p);
const fmt = s => {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return m + ':' + String(r).padStart(2, '0');
};

function renderMusic() {
  const cur = player.current();
  const hasList = player.playlist.length > 0;
  // 未选目录时这行留空（CSS :empty 隐藏），不再挂一长串说明小字；
  // 真正播放时才显示「序号/总数　曲名」，概念稿的 1/3 首信息就在这里。
  $('#musicNow').textContent = cur
    ? (player.index + 1) + '/' + player.playlist.length + '　' + cur.name
    : '';
  $('#btnPlay').textContent = player.playing ? '暂停' : '播放';
  $('#btnMode').textContent = '模式';
  $('#btnMode').title = '当前：' + player.label() + '（点击切换）';
  $('#disc').classList.toggle('spin', player.playing);
  if (!player.playing) $('#musicBar').style.width = '0';
}

function setSource(cur) { if (cur) audio.src = audioUrl(cur.path); }

async function musicLoad() {
  const st = await window.planet.audioGetState();
  player.setPlaylist(st.files || []);
  player.setMode(st.mode);
  player.select(st.index || 0);
  audio.volume = Number.isFinite(st.volume) ? st.volume : 0.8;
  if (player.current()) setSource(player.current());
  renderMusic();
}

async function musicPick() {
  const r = await window.planet.audioPickFolder();
  if (!r.ok) return;
  player.setPlaylist(r.files || []);
  player.select(0);
  player.pause();
  stopDemo();
  if (player.current()) setSource(player.current());
  renderMusic();
  toast('找到 ' + player.playlist.length + ' 首 MP3');
}

function startDemo() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch (e) { return; }
  const notes = [523.25, 587.33, 659.25, 783.99, 659.25, 587.33, 523.25, 392.0];
  let i = 0;
  const ping = () => {
    if (!player.playing) return;
    try {
      const t = actx.currentTime;
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = 'sine';
      o.frequency.value = notes[i % notes.length];
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.connect(g).connect(actx.destination);
      o.start(t);
      o.stop(t + 0.6);
      i++;
    } catch (e) { /* 音频设备不可用时静默降级 */ }
  };
  ping();
  demoTimer = setInterval(ping, 620);
}

function stopDemo() {
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
}

async function musicToggle() {
  if (player.playing) {
    if (player.playlist.length) audio.pause();
    stopDemo();
    player.pause();
  } else if (player.playlist.length) {
    if (!player.play()) return;
    if (!audio.getAttribute('src') && player.current()) setSource(player.current());
    audio.play().catch(() => {});
  } else {
    // 没选 MP3 时播演示旋律：setPlaylist 为空，PlayerState.play() 会返回 false，
    // 所以这里直接置播放态，状态机仍负责模式与切歌语义。
    player.playing = true;
    startDemo();
  }
  await window.planet.audioSaveState({ index: player.index, mode: player.mode });
  renderMusic();
}

async function musicMode() {
  const m = player.nextMode();
  await window.planet.audioSetMode(m);
  renderMusic();
  toast('播放模式：' + player.label());
}

audio.addEventListener('timeupdate', () => {
  const d = audio.duration;
  $('#musicBar').style.width = (Number.isFinite(d) && d > 0 ? Math.min(100, audio.currentTime / d * 100) : 0) + '%';
});

audio.addEventListener('ended', async () => {
  const r = player.onEnded();
  if (r.action === 'replay') { audio.currentTime = 0; audio.play().catch(() => {}); }
  else if (r.action === 'play') { setSource(player.current()); audio.play().catch(() => {}); }
  else { audio.pause(); $('#musicBar').style.width = '0'; }
  await window.planet.audioSaveState({ index: player.index, mode: player.mode });
  renderMusic();
});

/* ---------------- 我的电脑 ---------------- */

function renderPc() {
  const disk = S.pc.disk;
  const mem = S.pc.mem;
  $('#pcDisk').textContent = Number.isFinite(disk) ? disk + '%' : '—';
  $('#pcMem').textContent = Number.isFinite(mem) ? mem + '%' : '—';
  $('#pcDiskBar').style.width = (Number.isFinite(disk) ? disk : 0) + '%';
  $('#pcMemBar').style.width = (Number.isFinite(mem) ? mem : 0) + '%';
}

async function pcRefresh() {
  try { S.pc = await window.planet.pcStats(); renderPc(); } catch (e) {}
}

const QUICK = [
  { key: 'home', label: '个人文件夹', icon: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>' },
  { key: 'desktop', label: '桌面', icon: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>' },
  { key: 'documents', label: '文档', icon: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h4M9 12h6M9 16h6"/>' },
  { key: 'downloads', label: '下载', icon: '<path d="M12 3v12M7 11l5 5 5-5"/><path d="M4 20h16"/>' },
  { key: 'pictures', label: '图片', icon: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M4 18l5-5 4 4 3-3 4 4"/>' },
  { key: 'trash', label: '回收站', icon: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>' },
];

function openQuick() {
  openModal('<h3>我的电脑</h3><p>磁盘与内存是真实读数 · 点一下直接打开对应位置</p>' +
    '<div class="quick-grid">' + QUICK.map(q =>
      '<button class="quick" data-key="' + q.key + '"><i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + q.icon + '</svg></i>' +
      esc(q.label) + '</button>').join('') + '</div>' +
    '<div class="modal__actions"><button class="btn" id="qClose">关上</button></div>');
  $$('#modal .quick').forEach(b => b.addEventListener('click', async () => {
    const r = await window.planet.pcOpen(b.dataset.key);
    if (!r.ok) toast(r.error || '打不开');
  }));
  $('#qClose').addEventListener('click', closeModal);
}

function toggleSaver() {
  S.saver = !S.saver;
  $('#zonePC').classList.toggle('saver', S.saver);
  $('#pcMsg').hidden = false;
}

function tickClock() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  $('#clockTime').textContent = hh + ':' + mm;
  $('#clockDate').textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 · 周' + '日一二三四五六'[d.getDay()];
  $('#pcTime').textContent = hh + ':' + mm;
  if (S.saver) $('#pcMsg').textContent = '☾ ' + hh + ':' + mm;
}

/* ---------------- 收纳记录 / 说明 ---------------- */

async function openJournal() {
  const rows = await window.planet.journal();
  const label = {
    'shelve-intent': '收纳', 'shelve-done': '收纳完成', 'shelve-failed': '收纳失败',
    'restore-intent': '还原', 'restore-done': '还原完成', 'restore-failed': '还原失败',
    'restore-missing': '原件丢失',
  };
  const tail = rows.slice(-14).reverse();
  const list = tail.map(r => {
    const t = (r.at || '').slice(5, 19).replace('T', ' ');
    return '<div class="journal__row"><span class="jt">' + esc(t) + '</span>' +
      '<span class="jo">' + esc(label[r.op] || r.op || '') + '</span>' +
      '<span class="jn">' + esc(r.name || r.id || '') + '</span>' +
      (r.error ? '<span class="je" title="' + esc(r.error) + '">!</span>' : '') + '</div>';
  }).join('');
  openModal('<h3>收纳记录</h3><p>每次移动都写一行，可逐条还原</p>' +
    '<div style="max-height:250px;overflow:auto">' + (list || '<div class="journal__row">还没有任何移动记录</div>') + '</div>' +
    '<div class="modal__actions">' +
    '<button class="btn" id="jNote">便签归档</button>' +
    '<button class="btn" id="jDir">打开收纳目录</button>' +
    '<button class="btn primary" id="jAll">一键还原全部</button></div>');
  $('#jDir').addEventListener('click', () => window.planet.openShelfDir());
  $('#jNote').addEventListener('click', async () => {
    const r = await window.planet.openNotesArchive();
    if (!r.ok) toast(r.error || '还没有归档的便签');
  });
  $('#jAll').addEventListener('click', async () => {
    const ok = await askConfirm('把书架里的文件全部还原到桌面？');
    if (!ok) return;
    const r = await window.planet.restoreAll();
    await refreshAll();
    openJournal();
    toast('还原 ' + r.done.length + ' 条' + (r.failed.length ? '，失败 ' + r.failed.length + ' 条' : ''));
  });
}

function openDrawer() { drawerEl.classList.add('on'); drawerEl.setAttribute('aria-hidden', 'false'); setIgnore(false); }
function closeDrawer() { drawerEl.classList.remove('on'); drawerEl.setAttribute('aria-hidden', 'true'); refreshIgnore(); }

/* ---------------- 右键菜单 ---------------- */

function fileMenu(e, f) {
  showMenu(e.clientX, e.clientY, [
    { label: '打开', run: () => window.planet.open(f.path) },
    { label: '在资源管理器中显示', run: () => window.planet.reveal(f.path) },
    { label: '复制路径', run: async () => {
      const r = await window.planet.copyPath(f.path);
      if (r.ok) showTip(e.clientX, e.clientY, '路径已复制', 1400);
    } },
    { label: '重命名', run: () => renameFile(f) },
    { sep: true },
    { label: '收纳到书架', run: () => shelveFiles([f], 4) },
    { label: '移到回收站', danger: true, run: async () => {
      if (!await askConfirm('把「' + esc(f.name) + '」放进回收站？')) return;
      const r = await window.planet.trash(f.path);
      if (r.ok) await refreshAll(); else showTip(e.clientX, e.clientY, r.error || '没删掉', 2400);
    } },
  ]);
}

function bookMenu(e, entry) {
  showMenu(e.clientX, e.clientY, [
    { label: '打开', run: () => window.planet.open(entry.storedPath) },
    { label: '还原到桌面', run: async () => {
      const r = await window.planet.restore(entry.id);
      if (r.ok) await refreshAll(); else showTip(e.clientX, e.clientY, r.error || '还原失败', 2600);
    } },
    { label: '复制路径', run: async () => {
      const r = await window.planet.copyPath(entry.storedPath);
      if (r.ok) showTip(e.clientX, e.clientY, '路径已复制', 1400);
    } },
    { label: '在收纳目录中显示', run: () => window.planet.openShelfDir() },
  ]);
}

async function renameFile(f) {
  const name = await askText('改名（回车确认）', f.name);
  if (!name || name === f.name) return;
  const r = await window.planet.rename(f.path, name);
  if (r.ok) await refreshAll();
  else toast(r.error || '改名失败');
}

/* ---------------- 命中穿透 ---------------- */

let ignoring = true;
let altMode = false;
let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

/* 命中区：只有这些地方接管鼠标，其余（顶栏空白、柜体玻璃、地毯空隙）一律穿透给桌面。
   漏一个交互元素的表现是「看得见、点不动」，所以这张表与 refreshIgnore 共用一份。 */
const HIT_SELECTOR = '[data-hit], .file, .book, .polaroid, .todo, .figure, #bin, .selectbar, #ctx, #toast';

function setIgnore(v) {
  if (v === ignoring) return;
  ignoring = v;
  window.planet.setIgnore(v);
}

function refreshIgnore() {
  if (dragging) { setIgnore(false); return; }
  const t = document.elementFromPoint(lastPointer.x, lastPointer.y);
  const hit = !!(t && t.closest(HIT_SELECTOR));
  setIgnore(!(hit || altMode || !modalEl.hidden || drawerEl.classList.contains('on')));
}

// 命中穿透：每次移动都 elementFromPoint 会触发布局、长时间操作后发涩。
// 用 requestAnimationFrame 合帧，每帧最多算一次。
let mmRaf = 0;
function syncIgnoreAtPointer() {
  const t = document.elementFromPoint(lastPointer.x, lastPointer.y);
  const hit = !!(t && t.closest(HIT_SELECTOR));
  setIgnore(!(hit || altMode));
}

// 隐藏→显示星球后，主进程的 setIgnoreMouseEvents 与渲染进程的 ignoring 变量可能失步，
// 表现为「整个星球点不动」。这里无条件按当前指针位置重算并直发一次 IPC，强制对齐。
function resyncIgnore() {
  const t = document.elementFromPoint(lastPointer.x, lastPointer.y);
  const hit = !!(t && t.closest(HIT_SELECTOR));
  const next = !(hit || altMode || !modalEl.hidden || drawerEl.classList.contains('on'));
  ignoring = next;
  window.planet.setIgnore(next);
}
document.addEventListener('mousemove', e => {
  lastPointer = { x: e.clientX, y: e.clientY };
  if (dragging || ghostEl || !modalEl.hidden || drawerEl.classList.contains('on')) return;
  if (mmRaf) return;
  mmRaf = requestAnimationFrame(() => { mmRaf = 0; if (!dragging) syncIgnoreAtPointer(); });
}, { passive: true });

// 静止看门狗：重渲染后光标没动、元素却换了一批，不能等下一次 mousemove 才校准
setInterval(() => {
  if (dragging || ghostEl || !modalEl.hidden || drawerEl.classList.contains('on')) return;
  syncIgnoreAtPointer();
}, 1200);

window.addEventListener('keydown', e => {
  if (e.key === 'Alt') { altMode = true; setIgnore(false); }
});
window.addEventListener('keyup', e => { if (e.key === 'Alt') { altMode = false; refreshIgnore(); } });
window.addEventListener('blur', () => { altMode = false; refreshIgnore(); });

/* 按住 Alt 在地毯空白处拖 = 框选；框选结果与点选共用一套 selected */
document.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !e.altKey) return;
  if (!e.target.closest('#app') || e.target.closest('.file, #topbar, #modal, #drawer, #ctx, .selectbar, .todo, .book, .figure, .polaroid')) return;
  e.preventDefault();
  const x0 = e.clientX, y0 = e.clientY;
  marqueeEl = el('div', 'marquee');
  marqueeEl.style.cssText = 'position:fixed;border:1px solid rgba(242,135,176,.95);background:rgba(242,135,176,.14);border-radius:3px;pointer-events:none;z-index:99997';
  document.body.appendChild(marqueeEl);
  const move = ev => {
    const x = Math.min(x0, ev.clientX), y = Math.min(y0, ev.clientY);
    Object.assign(marqueeEl.style, {
      left: x + 'px', top: y + 'px',
      width: Math.abs(ev.clientX - x0) + 'px', height: Math.abs(ev.clientY - y0) + 'px',
    });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    const box = marqueeEl.getBoundingClientRect();
    marqueeEl.remove();
    marqueeEl = null;
    $$('.file').forEach(n => {
      const r = n.getBoundingClientRect();
      const hit = !(r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom);
      if (hit) S.selected.add(n.dataset.path);
      n.classList.toggle('sel', S.selected.has(n.dataset.path));
    });
    updateSelectbar();
    refreshIgnore();
    if (S.selected.size) toast('已选 ' + S.selected.size + ' 张 · 拖到书架收纳');
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  setIgnore(false);
}, true);

/* ---------------- 刷新 ---------------- */

async function refreshAll() {
  const [d, s] = await Promise.all([window.planet.refresh(), window.planet.shelfList()]);
  applyDesktop(d);
  S.shelf = s.entries || [];
  prevNames = new Set(S.desktop.files.map(f => f.name));
  await loadIcons([...S.desktop.files, ...S.apps]);
  ensureDock();
  renderDock();
  renderShelf();
  renderFloor();
}

/* ---------------- 自测（PLANET_SELFTEST=1） ---------------- */

async function selfTest() {
  const out = [];
  const log = (k, ok, extra) => out.push((ok ? 'OK  ' : 'FAIL') + ' ' + k + (extra ? ' :: ' + extra : ''));
  const name = 'planet自测-' + Date.now() + '.txt';
  const made = await window.planet.makeTestFile(name);
  log('建测试文件', made.ok);
  if (!made.ok) return out;
  localStorage.setItem('planet.shelfWarned', '1');
  await refreshAll();
  await shelveFiles(S.desktop.files.filter(f => f.name === name), 0);
  const list = await window.planet.shelfList();
  const got = (list.entries || []).find(e => e.name === name);
  log('收纳进书架', !!got);
  log('原件已离桌面', !(await window.planet.refresh()).files.some(f => f.name === name));
  if (got) {
    const r = await window.planet.restore(got.id);
    log('还原成功', r.ok);
    log('回到桌面', (await window.planet.refresh()).files.some(f => f.name === name));
    if (r.ok) await window.planet.removeFile(r.path);
  }
  return out;
}

/* ---------------- 启动 ---------------- */

function bindEvents() {
  $('#btnSelect').addEventListener('click', () => toggleSelectMode());
  $('#btnJournal').addEventListener('click', openJournal);
  $('#btnHelp').addEventListener('click', openDrawer);
  $('#btnQuit').addEventListener('click', () => window.planet.quit());
  $('#drawerClose').addEventListener('click', closeDrawer);

  $('#btnShelveAll').addEventListener('click', () => shelveFiles(selectedFiles(), 4));
  $('#btnSelClear').addEventListener('click', clearSelection);

  $('#slotMinus').addEventListener('click', async () => {
    if (S.show.count <= PM.SLOT_MIN) { toast('最少留一只呀'); return; }
    S.show.count -= 1;
    await persistShow();
    renderShow();
    toast('收起一位，已上传的图都留着');
  });
  $('#slotPlus').addEventListener('click', async () => {
    if (S.show.count >= PM.SLOT_MAX) { toast('最多站 6 只（柜子就这点地方啦）'); return; }
    S.show.count += 1;
    await persistShow();
    renderShow();
    toast('多站一只，前后错落会重新排');
  });
  $('#poseReset').addEventListener('click', () => resetPoses(null));

  $('#btnPickAudio').addEventListener('click', musicPick);
  $('#btnPlay').addEventListener('click', musicToggle);
  $('#btnMode').addEventListener('click', musicMode);
  audio.addEventListener('error', () => { if (player.playing && player.playlist.length) toast('这首读不出来，换一首试试'); });

  let clickTimer = null;
  $('#zonePC').addEventListener('click', () => {
    if (S.saver) { toggleSaver(); return; }
    clearTimeout(clickTimer);
    clickTimer = setTimeout(openQuick, 220);
  });
  $('#zonePC').addEventListener('dblclick', () => {
    clearTimeout(clickTimer);
    toggleSaver();
  });

  // 糖果罐现在在「我的电脑」卡片里：必须挡住冒泡，否则会同时弹出电脑快捷入口
  $('#bin').addEventListener('click', e => { e.stopPropagation(); window.planet.openTrash(); });
  $('#bin').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); window.planet.openTrash(); }
  });
  $('#bin').addEventListener('dblclick', e => e.stopPropagation());
  $('#bin').addEventListener('mouseenter', e => showTip(e.clientX, e.clientY, '糖果罐 · 拖资料或书进来丢进回收站'));
  $('#bin').addEventListener('mouseleave', hideTip);

  window.addEventListener('resize', fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(document.documentElement);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);
  window.planet.onScreen(() => fit());
  window.planet.onResync(() => resyncIgnore());
  window.planet.onDisplay(d => {
    S.display = Object.assign(S.display || { preset: 'auto' }, d);
    fit();
    // 屏幕比档位小时会被夹取：说清楚，避免「选了没反应」的错觉
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    const auto = PM.fitFor(vw, vh, 'auto', safeBottomFor(vh), S.stageW);
    const clamped = S.display.preset !== 'auto' && Math.abs(SCALE - auto.scale) < 0.002;
    toast('画面适配：' + PM.displayPresetLabel(S.display.preset) +
      (clamped ? ' · 当前屏幕按最大可用比例' : ''));
  });

  window.planet.onDesktop(async next => {
    const fresh = new Set(next.files.filter(f => !isAppShortcut(f))
      .filter(f => !prevNames || !prevNames.has(f.name)).map(f => f.name));
    applyDesktop(next);
    prevNames = new Set(S.desktop.files.map(f => f.name));
    await loadIcons([...S.desktop.files, ...S.apps]);
    ensureDock();
    renderDock();
    renderFloor(fresh);
  });

  // 书架目录被外部改动（如直接在资源管理器/回收站删文件）时，同步最新的书架条目
  window.planet.onShelf(d => {
    if (!d) return;
    S.shelf = d.entries || [];
    renderShelf();
  });

  window.planet.onCmd(name => {
    if (name === 'journal') openJournal();
    if (name === 'help') openDrawer();
  });

  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k === 'j' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openJournal(); }
    if (k === 'q' && (e.ctrlKey || e.metaKey)) window.planet.quit();
    if (k === 'r') refreshAll();
    if (e.key === 'Escape') {
      closeModal(); closeDrawer(); closeMenu(); hideTip();
      if (S.selectMode) toggleSelectMode(false);
    }
  });
}

async function init() {
  const d = await window.planet.init();
  // 顶部版本号：单一来源是 package.json 的 version（打包脚本会写进 exe）
  const verEl = $('#brandVer');
  if (verEl) verEl.textContent = 'v' + (d.version || '1.0.0');
  S.layout = d.layout;
  applyDesktop(d.desktop);
  S.shelf = d.shelf || [];
  S.album = d.album || {};
  S.albumExts = new Set(d.albumExts || []);
  S.show = d.showcase || S.show;
  S.display = d.display || { preset: 'auto', presets: {} };
  S.pc = d.pc || S.pc;
  S.screen = d.screen;

  buildScene();
  fit();
  await loadIcons([...S.desktop.files, ...S.apps]);
  ensureDock();
  renderDock();
  renderAlbum();
  renderTodos();
  renderShow();
  renderShelf();
  renderFloor();
  renderPc();
  await musicLoad();
  tickClock();
  setInterval(tickClock, 1000);
  setInterval(pcRefresh, 30000);

  prevNames = new Set(S.desktop.files.map(f => f.name));
  bindEvents();

  if (window.planet.selftest) {
    setTimeout(async () => {
      const lines = await selfTest();
      console.error('[selftest]\n' + lines.join('\n'));
    }, 2400);
  }
}

init().catch(err => console.error('[planet] 初始化失败', err && err.stack || String(err)));
