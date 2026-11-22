// model.js —— 糖绒星球的纯逻辑：画布适配、展柜站位、槽位增删、地毯排布
// 不依赖 DOM / Electron，主进程单测与渲染进程共用（UMD，与 room/player-state.js 同一模式）。
'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PlanetModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const BASE_W = 1440;
  const BASE_H = 940;
  // 画布横向展开的上限：再宽中间展柜会失去柜体比例（代码限制）
  const STAGE_MAX_W = 1720;

  // 代码限制：展柜 1–6 个站位、相册 4 格。这是写死在布局与实现里的容量，不是业务枚举。
  const SLOT_MIN = 1;
  const SLOT_MAX = 6;
  const ALBUM_SIZE = 4;

  /* 系列只换「展柜主题」：配色、灯光、默认站位数与铭牌。
     不是官方形象库，内置形象一律是原创糖绒小精灵占位。 */
  const SERIES = {
    big37: { label: '37cm 大号', sub: 'BIG · 37cm', slots: 1, a: '#FFE7AB', b: '#F0C879', lamp: '#FFE09A' },
    caramel: { label: '焦糖', sub: 'CARAMEL', slots: 3, a: '#F8DCB8', b: '#DEA972', lamp: '#FFD2A0' },
    starman: { label: '星星人', sub: 'STARDUST', slots: 5, a: '#DED5FA', b: '#A99AE4', lamp: '#CFC0FF' },
    custom: { label: '自定义', sub: 'CUSTOM', slots: 4, a: '#FFD9E8', b: '#F2A8C8', lamp: '#FFC2DC' },
  };
  const SERIES_KEYS = Object.keys(SERIES);

  /* 画面适配档位：以参考分辨率为「设计尺寸」算缩放，再按当前窗口夹取。
     用户觉得画面太大/太小时，在托盘右键「画面适配」里切换即可。
     只有写了 w/h 的档位才算固定参考，auto 跟随窗口——这是代码分支，不是机型清单。 */
  const DISPLAY_PRESETS = {
    auto: { label: '自动（跟随窗口）' },
    fhd: { label: '1920 × 1080', w: 1920, h: 1080 },
    qhd: { label: '2560 × 1440', w: 2560, h: 1440 },
    wqhd: { label: '2880 × 1620', w: 2880, h: 1620 },
    uhd: { label: '3120 × 2080', w: 3120, h: 2080 },
  };
  const DISPLAY_KEYS = Object.keys(DISPLAY_PRESETS);

  /* 站位阵列：远排靠上 / 更小 / 更淡 / 轻微模糊 / 低层级，近排靠下 / 更大 / 更亮 / 高层级。
     x/y 是展柜内百分比，w/h 是基准像素，s 再叠一层缩放，z 决定层叠。 */
  const S = (x, y, s, z, rot, b, blur, w, h) => ({ x, y, s, z, rot, b, blur, w, h });
  const STAGES = {
    1: [S(50, 92, 1.34, 9, -2, 1, 0, 116, 134)],
    2: [S(31, 68, 0.92, 4, -6, 0.86, 0.3, 92, 106),
        S(70, 92, 1.20, 8, 4, 1, 0, 106, 122)],
    3: [S(20, 64, 0.82, 3, -8, 0.82, 0.4, 88, 100),
        S(50, 94, 1.24, 9, 1, 1, 0, 108, 126),
        S(81, 70, 0.92, 5, 7, 0.90, 0.2, 94, 108)],
    4: [S(16, 60, 0.78, 2, -9, 0.80, 0.5, 86, 98),
        S(39, 76, 1.00, 6, -2, 0.96, 0, 98, 112),
        S(64, 62, 0.84, 4, 6, 0.86, 0.3, 90, 104),
        S(84, 90, 1.16, 8, 3, 1, 0, 104, 120)],
    5: [S(14, 58, 0.70, 2, -11, 0.76, 0.6, 80, 92),
        S(31, 70, 0.86, 4, -5, 0.86, 0.3, 88, 102),
        S(57, 56, 0.76, 3, 4, 0.80, 0.5, 82, 94),
        S(82, 78, 1.02, 7, 8, 0.96, 0.2, 100, 114),
        S(46, 96, 1.26, 10, -1, 1, 0, 110, 128)],
    6: [S(12, 54, 0.68, 2, -12, 0.74, 0.7, 78, 90),
        S(29, 68, 0.84, 4, -6, 0.84, 0.4, 86, 100),
        S(48, 52, 0.74, 3, 1, 0.78, 0.6, 80, 92),
        S(68, 76, 0.94, 6, 7, 0.94, 0.2, 94, 108),
        S(88, 60, 0.78, 5, 10, 0.80, 0.5, 84, 96),
        S(47, 97, 1.24, 10, -1, 1, 0, 110, 128)],
  };

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  /** 画布宽度跟随窗口宽高比横向展开：16:9 / 16:10 时中间展柜变宽，
      窄屏或 3:2 保持 1440 基准，最宽不超过 1720。 */
  function stageWidth(vw, vh) {
    if (!vw || !vh) return BASE_W;
    const byAspect = Math.round(BASE_H * (vw / vh));
    return clamp(byAspect, BASE_W, STAGE_MAX_W);
  }

  /** 等比缩放并居中；底部预留 safeBottom（Windows 任务栏 / 自动隐藏任务栏的安全间距）
      返回舞台左上角偏移与比例，供拖拽换算用 */
  function computeFit(vw, vh, baseW, baseH, safeBottom) {
    const w = baseW || BASE_W;
    const h = baseH || BASE_H;
    const gap = clamp(Number(safeBottom) || 0, 0, Math.max(0, vh - 320));
    const availH = Math.max(320, vh - gap);
    const scale = Math.min(vw / w, availH / h);
    return {
      scale,
      ox: (vw - w * scale) / 2,
      oy: (availH - h * scale) / 2,
      safeBottom: gap,
    };
  }

  /** 按用户选的画面档位算缩放：参考分辨率决定 UI 大小，当前窗口决定上限，永不溢出 */
  function fitFor(vw, vh, presetId, safeBottom, stageW) {
    const sw = stageW || BASE_W;
    const base = computeFit(vw, vh, sw, BASE_H, safeBottom);
    const p = DISPLAY_PRESETS[presetId];
    if (!p || !p.w || !p.h) return Object.assign({}, base, { preset: 'auto', stageW: sw });
    // 参考分辨率也按自己的宽高比展开画布，1080p 档在 16:9 屏上正好铺满 1920×1080
    const target = computeFit(p.w, p.h, stageWidth(p.w, p.h), BASE_H, 0);
    const scale = Math.min(target.scale, base.scale);
    const gap = base.safeBottom;
    const availH = Math.max(320, vh - gap);
    return {
      scale,
      ox: (vw - sw * scale) / 2,
      oy: (availH - BASE_H * scale) / 2,
      safeBottom: gap,
      preset: presetId,
      stageW: sw,
    };
  }

  function displayPresetLabel(key) {
    return (DISPLAY_PRESETS[key] || DISPLAY_PRESETS.auto).label;
  }

  function clampCount(n) {
    const v = Number(n);
    return clamp(Number.isFinite(v) ? Math.round(v) : SERIES.starman.slots, SLOT_MIN, SLOT_MAX);
  }

  function seriesOf(key) { return SERIES[key] || SERIES.starman; }

  /** 扩展模式下需要铺「副屏粉色背景」的显示器边界（排除主屏、排除无效尺寸）。
      displays 为 Electron screen.getAllDisplays() 的返回，primaryId 为主屏 id。 */
  function secondaryBounds(displays, primaryId) {
    if (!Array.isArray(displays)) return [];
    return displays
      .filter(d => d && d.id !== primaryId && d.bounds && d.bounds.width >= 2 && d.bounds.height >= 2)
      .map(d => ({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height }));
  }

  function stagesFor(n) { return STAGES[clampCount(n)] || STAGES[SLOT_MAX]; }

  /** 交换两个槽位；越界或同位一律原样返回，不抛错、不复制错位 */
  function swapSlots(list, a, b) {
    const out = Array.isArray(list) ? list.slice() : [];
    if (a === b || a < 0 || b < 0 || a >= out.length || b >= out.length) return out;
    const t = out[a];
    out[a] = out[b];
    out[b] = t;
    return out;
  }

  /** 删除第 i 项并返回「删了什么、原位置」，撤销时据此插回 */
  function removeAt(list, i) {
    const out = Array.isArray(list) ? list.slice() : [];
    if (i < 0 || i >= out.length) return { list: out, removed: null, index: -1 };
    const removed = out.splice(i, 1)[0];
    return { list: out, removed, index: i };
  }

  function insertAt(list, i, item) {
    const out = Array.isArray(list) ? list.slice() : [];
    const at = clamp(Number.isFinite(i) ? Math.round(i) : 0, 0, out.length);
    out.splice(at, 0, item);
    return out;
  }

  /** 书架纵向比例 → 行号；落在所有行之外时返回 -1 */
  function rowFromY(fy, rows) {
    if (!Array.isArray(rows) || !rows.length) return -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (fy >= rows[i].top - 0.02 && fy <= rows[i].bottom + 0.03) return i;
    }
    if (fy < rows[0].top) return 0;
    if (fy > rows[rows.length - 1].bottom) return rows.length - 1;
    return -1;
  }

  /** 首次落位：按卡片尺寸铺成带轻微抖动的网格，保证不出界、不重叠 */
  function gridPositions(count, w, h, zoneW, zoneH, opts) {
    const o = opts || {};
    const pad = o.pad == null ? 16 : o.pad;
    const gapX = o.gapX == null ? 10 : o.gapX;
    const gapY = o.gapY == null ? 8 : o.gapY;
    const cols = Math.max(1, Math.floor((zoneW - pad * 2 + gapX) / (w + gapX)));
    const out = [];
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      // 只做横向轻微错位：纵向加抖动会让相邻两行压到一起。
      // 「散乱感」由外层的随机歪斜角负责，排布本身必须保证不重叠。
      const jx = ((i * 7) % 3) * 2 - 2;
      const x = pad + col * (w + gapX) + jx;
      const y = pad + row * (h + gapY);
      out.push({
        x: Math.round(clamp(x, 6, Math.max(6, zoneW - w - 6))),
        y: Math.round(clamp(y, 4, Math.max(4, zoneH - h - 4))),
      });
    }
    return out;
  }

  /** 拖到地毯上时把卡片夹在可视区内，避免半张卡跑到柜体外 */
  function clampPos(x, y, w, h, zoneW, zoneH) {
    return {
      x: Math.round(clamp(Number(x) || 0, 4, Math.max(4, zoneW - w - 4))),
      y: Math.round(clamp(Number(y) || 0, 4, Math.max(4, zoneH - h - 4))),
    };
  }

  /** 玩偶自由摆位：x 是展柜内横向百分比，y 是脚底线百分比。
      横向留 5% 边、纵向留 18% 顶边与 2% 底边，任何屏幕比例下都不会跑出玻璃柜。 */
  function clampPose(x, y) {
    return {
      x: +clamp(Number(x) || 0, 5, 95).toFixed(2),
      y: +clamp(Number(y) || 0, 18, 98).toFixed(2),
    };
  }

  /** 自由摆位后的景深：以原站位为基准，向下更大更靠前、向上更小更淡，
      保证「拖到哪儿像站在哪儿」，而不是一个尺寸贴到底。 */
  const DEPTH_MIN = 1;
  const DEPTH_MAX = 14;

  /** 手动层级：1 最远、14 最近。用户滚轮微调时用，夹在同一个范围内。 */
  function clampDepth(z) {
    return Math.round(clamp(Number(z) || DEPTH_MIN, DEPTH_MIN, DEPTH_MAX));
  }

  /** 给定每只玩偶的层级，返回它们的 1..N 名次（同层按 DOM 顺序，后面的算更前）。
      工具提示里的「第 3 / 5 层」用它，比直接显示 1..14 好懂。 */
  function depthRanks(zs) {
    const order = (Array.isArray(zs) ? zs : [])
      .map((z, i) => ({ z: Number(z) || 0, i }))
      .sort((a, b) => a.z - b.z || a.i - b.i);
    const ranks = new Array(order.length);
    order.forEach((it, idx) => { ranks[it.i] = idx + 1; });
    return ranks;
  }

  /** 换一层：和相邻名次的那只交换深度槽。返回新的 zs（不修改入参），到顶/到底返回 null。
      只交换两只的 z，不动整组分布——这样 2 只时不会把后排一下压到最暗，
      连续滚也不会有「滚好几格名次不动」的空档。同层时用 ±1 破平。 */
  function stepDepth(zs, index, dir) {
    const list = Array.isArray(zs) ? zs.map(z => clampDepth(z)) : [];
    const n = list.length;
    if (index < 0 || index >= n || n < 2) return null;
    const order = list.map((z, i) => ({ z, i }))
      .sort((a, b) => a.z - b.z || a.i - b.i)
      .map(o => o.i);
    const at = order.indexOf(index);
    const to = at + (dir > 0 ? 1 : -1);
    if (to < 0 || to >= n) return null;

    const out = list.slice();
    const other = order[to];
    const a = out[index], b = out[other];
    out[index] = b;
    out[other] = a;
    if (out[index] === out[other]) {
      // 两只本来同层：谁往前就把谁的 z 抬高一格，另一方留在原层
      if (dir > 0) {
        if (b < DEPTH_MAX) out[index] = b + 1;
        else { out[index] = b; out[other] = b - 1; }
      } else {
        if (b > DEPTH_MIN) out[index] = b - 1;
        else { out[index] = b; out[other] = b + 1; }
      }
    }
    return out;
  }

  /** 景深：s 仍由脚底线（y）决定，站得低就大；
      zOverride 只覆盖前后层级。frontness（0 最后、1 最前）决定明暗与模糊：
      用户把后排玩偶滚到最前时，它就该是清晰的，而不是沿用原来的暗度。 */
  function poseScale(base, y, zOverride, frontness) {
    const by = clamp(Number(base && base.y) || 1, 1, 100);
    const yy = clamp(Number(y) || 0, 1, 100);
    const k = (0.8 + yy / 100 * 0.42) / (0.8 + by / 100 * 0.42);
    const s = +(clamp((base.s || 1) * k, 0.3, 2.2)).toFixed(3);
    if (zOverride != null && Number.isFinite(Number(zOverride))) {
      const z = clampDepth(zOverride);
      const t = frontness == null
        ? (z - DEPTH_MIN) / (DEPTH_MAX - DEPTH_MIN)
        : clamp(Number(frontness) || 0, 0, 1);
      // 层级只决定谁压住谁；不再按名次自动加暗 / 模糊——
      // 多只同时展示时，后排玩偶保持原色，靠大小与遮挡关系表达纵深。
      return { s, z, b: 1, blur: 0 };
    }
    return {
      s,
      z: Math.round(clamp((base.z || 1) + (yy - by) / 9, DEPTH_MIN, DEPTH_MAX)),
      b: 1,
      blur: 0,
    };
  }

  /** 书脊用的短名：先摘掉 .lnk / .url / .exe 这类壳后缀，再按字符截断。
      用 Array.from 而不是 slice 直接切，避免把 emoji 的代理对劈成半个。
      完整名字仍由悬停提示负责，这里只解决「一眼认出是哪一本/哪个文件夹」。 */
  function shortName(name, max) {
    const limit = Math.round(clamp(Number(max) || 4, 1, 12));
    const clean = String(name == null ? '' : name).replace(/\.(lnk|url|exe)$/i, '').trim();
    return Array.from(clean).slice(0, limit).join('');
  }

  /** 书脊能排下的整字数：8.5px 字号 + 0.3 字距 ≈ 8.8px/字，上下留白 8px、底边 3px。
      向下取整——宁可少写一个字，也不让最后一个字被裁成半截。最少 4 个（书高 ≥ 54px）。 */
  function spineChars(h) {
    const avail = Math.max(0, Number(h) - 11);
    return clamp(Math.floor(avail / 8.8), 4, 12);
  }

  /** 短名的行拆分工具：汉字按 2×2 排，四个窄字（数字/英文）排一行。
      书架已统一为竖排书脊、不再渲染正面标签，这里保留为纯逻辑工具（含单测覆盖），
      供其它视图/后续版式复用；"2026 年度照片" 硬拆成 20/26 会读不出来。 */
  function boxRows(name, max) {
    const chars = Array.from(shortName(name, max));
    if (chars.length <= 2 || chars.every(c => c.charCodeAt(0) < 128)) return [chars.join('')];
    return [chars.slice(0, 2).join(''), chars.slice(2).join('')];
  }

  /** 书脊底色浅化：把「格式色」按比例混白，保留色相、只抬亮度。
      资料原来直接用中饱和格式色当底 + 白细字，对比度明显不如文件夹/快捷方式的
      「浅底 + 深墨粗字」。浅化后所有格式都能承深色字，按格式配色也还分得出来；
      两侧立边仍用原格式色，颜色辨识不丢。支持 #rgb / #rrggbb / 不带 #。 */
  const INK_MIX = 0.6;
  function lightenInk(hex, ratio) {
    const r = Number.isFinite(Number(ratio)) ? clamp(Number(ratio), 0, 1) : INK_MIX;
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex == null ? '' : hex).trim());
    if (!m) return '#EDE3F2';
    let s = m[1];
    if (s.length === 3) s = Array.from(s).map(c => c + c).join('');
    let out = '#';
    for (let i = 0; i < 6; i += 2) {
      const c = parseInt(s.slice(i, i + 2), 16);
      out += Math.round(c + (255 - c) * r).toString(16).padStart(2, '0');
    }
    return out.toUpperCase();
  }

  /* ---------------- 底部应用坞 ---------------- */

  const DOCK_COLS = [2, 3];

  function clampDockCols(n) { return Number(n) === 2 ? 2 : 3; }

  /** 整理应用坞条目：去重、夹组、组内连续编号。只保留 {key,g,o} 三个字段。 */
  function normalizeDock(items, cols) {
    const c = clampDockCols(cols);
    const out = [];
    const seen = new Set();
    for (const it of Array.isArray(items) ? items : []) {
      const key = String((it && it.key) || '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        g: Math.round(clamp(Number(it.g) || 0, 0, c - 1)),
        o: Number.isFinite(Number(it.o)) ? Number(it.o) : 0,
      });
    }
    for (let g = 0; g < c; g++) {
      out.filter(i => i.g === g)
        .sort((a, b) => a.o - b.o || a.key.localeCompare(b.key))
        .forEach((it, i) => { it.o = i; });
    }
    return out.sort((a, b) => a.g - b.g || a.o - b.o);
  }

  /** 把桌面现有的应用与已保存摆位对齐：保留旧位置，新应用放进当前最空的一组。 */
  function reconcileDock(saved, paths, cols) {
    const c = clampDockCols(cols);
    const keys = Array.from(new Set((Array.isArray(paths) ? paths : []).map(String)));
    const allowed = new Set(keys);
    const kept = normalizeDock(
      (Array.isArray(saved) ? saved : []).filter(i => i && allowed.has(String(i.key))), c);
    const have = new Set(kept.map(i => i.key));
    for (const key of keys) {
      if (have.has(key)) continue;
      let g = 0, min = Infinity;
      for (let i = 0; i < c; i++) {
        const n = kept.filter(x => x.g === i).length;
        if (n < min) { min = n; g = i; }
      }
      kept.push({ key, g, o: kept.filter(x => x.g === g).length });
      have.add(key);
    }
    return normalizeDock(kept, c);
  }

  /** 拖动一个图标到某组某位；index 是目标组里「去掉自己之后」的插入位。 */
  function moveDockItem(items, key, g, index, cols) {
    const c = clampDockCols(cols);
    const base = normalizeDock(items, c);
    if (!base.some(i => i.key === key)) return base;
    const rest = base.filter(i => i.key !== key);
    const target = Math.round(clamp(Number(g) || 0, 0, c - 1));
    const group = rest.filter(i => i.g === target).sort((a, b) => a.o - b.o);
    const at = Math.round(clamp(Number(index) || 0, 0, group.length));
    group.splice(at, 0, { key, g: target, o: 0 });
    // 先按数组顺序写 o，再 normalize：否则同 o 的条目会被 key 排序打乱插入位
    group.forEach((it, i) => { it.o = i; });
    return normalizeDock(rest.filter(i => i.g !== target).concat(group), c);
  }

  /** 切换 2/3 栏：超出栏数的组并到最后一栏，不丢图标。 */
  function setDockCols(items, cols) {
    return normalizeDock(items, cols);
  }

  /** 拖拽换了卡片的左上角，用指针在卡片内的抓取偏移回推，手感不跳 */
  function dragOrigin(pointerX, pointerY, grabX, grabY, scale) {
    const s = scale || 1;
    return { x: pointerX - grabX / s, y: pointerY - grabY / s };
  }

  return {
    BASE_W, BASE_H, STAGE_MAX_W, SLOT_MIN, SLOT_MAX, ALBUM_SIZE,
    SERIES, SERIES_KEYS, STAGES,
    DISPLAY_PRESETS, DISPLAY_KEYS, displayPresetLabel,
    stageWidth, computeFit, fitFor, clampCount, seriesOf, stagesFor, secondaryBounds,
    swapSlots, removeAt, insertAt, rowFromY,
    gridPositions, clampPos, clampPose, poseScale, stepDepth, clampDepth, depthRanks, DEPTH_MIN, DEPTH_MAX, shortName, spineChars, boxRows, lightenInk, INK_MIX, dragOrigin,
    DOCK_COLS, clampDockCols, normalizeDock, reconcileDock, moveDockItem, setDockCols,
  };
});
