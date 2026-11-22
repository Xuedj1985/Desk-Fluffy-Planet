// store.js —— 书架收纳：真移动 + 全量日志 + 可还原
// 原则：
//   1. 任何移动前先写 journal（intent），移动完再写一条（done）——崩溃也能对账
//   2. 目标已存在就拒绝，绝不覆盖
//   3. 跨盘 rename 失败时走 copy → 校验大小 → 删源
//   4. 收纳目录与桌面同盘优先，降低跨盘概率
'use strict';

const fs = require('fs');
const path = require('path');

function nowIso() {
  return new Date().toISOString();
}

function genId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function exists(p) {
  try { fs.lstatSync(p); return true; } catch (e) { return false; }
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = path.join(dir, name);
  let n = 2;
  while (exists(candidate)) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

function statOf(p) {
  const st = fs.lstatSync(p);
  return { size: st.size, mtime: Math.round(st.mtimeMs), dir: st.isDirectory() };
}

/** 文件夹里有多少个可见子项：档案盒上显示数字，不用点开才知道是不是空的 */
function countChildren(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => !d.name.startsWith('.') && !/^(desktop\.ini|thumbs\.db)$/i.test(d.name))
      .length;
  } catch (e) { return 0; }
}

class Store {
  constructor({ dataDir, desktop, shelfDir }) {
    this.dataDir = dataDir;
    this.desktop = desktop;
    // 收纳目录默认放数据目录下；糖绒星球把它改到「桌面\糖绒星球书架」，
    // 这样文件始终留在中国桌面盘上，退出 App 后依然能直接取回。
    this.shelfDir = shelfDir || path.join(dataDir, 'shelf');
    this.listFile = path.join(dataDir, 'shelf.json');
    this.journalFile = path.join(dataDir, 'journal.jsonl');
    fs.mkdirSync(this.shelfDir, { recursive: true });
    this.data = this._load();
  }

  _load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.listFile, 'utf8'));
      if (Array.isArray(d.entries)) return d;
    } catch (e) { /* 首次运行 */ }
    return { entries: [] };
  }

  _save() {
    const tmp = this.listFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.listFile);
  }

  journal(rec) {
    const line = JSON.stringify({ at: nowIso(), ...rec }) + '\n';
    fs.appendFileSync(this.journalFile, line, 'utf8');
  }

  entries() {
    return this.data.entries;
  }

  journalTail(n = 40) {
    try {
      const lines = fs.readFileSync(this.journalFile, 'utf8').trim().split('\n');
      return lines.slice(-n).map(l => { try { return JSON.parse(l); } catch (e) { return { raw: l }; } });
    } catch (e) { return []; }
  }

  /** 跨盘安全移动：先试 rename，失败再 copy+校验+删 */
  _move(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (exists(to)) throw new Error('目标已存在，拒绝覆盖：' + to);
    const src = statOf(from);
    try {
      fs.renameSync(from, to);
      return { how: 'rename' };
    } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      if (src.dir) throw new Error('跨盘移动文件夹不支持，请手动处理：' + from);
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      const dst = statOf(to);
      if (dst.size !== src.size) {
        try { fs.unlinkSync(to); } catch (e2) {}
        throw new Error('复制后大小不一致，已回滚：' + from);
      }
      fs.unlinkSync(from);
      return { how: 'copy' };
    }
  }

  /** 把桌面文件收进书架 */
  shelve(srcPath, row, meta = {}) {
    if (!exists(srcPath)) return { ok: false, error: '文件不存在：' + srcPath };
    const name = path.basename(srcPath);
    const id = genId();
    const dir = path.join(this.shelfDir, id);
    const to = path.join(dir, name);
    let st;
    try { st = statOf(srcPath); } catch (e) { return { ok: false, error: e.message }; }
    // 子项数量要在移动之前数：移动完成后原目录已经不在桌面上了
    const childCount = st.dir ? countChildren(srcPath) : 0;

    this.journal({ op: 'shelve-intent', id, name, from: srcPath, to, row, size: st.size, dir: st.dir });
    try {
      fs.mkdirSync(dir, { recursive: true });
      const how = this._move(srcPath, to);
      this.journal({ op: 'shelve-done', id, name, to, how: how.how });
    } catch (e) {
      this.journal({ op: 'shelve-failed', id, name, from: srcPath, error: e.message });
      return { ok: false, error: e.message };
    }

    const entry = {
      id, name, storedPath: to, originalPath: srcPath,
      row: Number.isFinite(row) ? row : 0,
      order: this._nextOrder(row),
      kind: st.dir ? 'folder' : 'file',
      ext: path.extname(name).toLowerCase(),
      linkDir: !!meta.linkDir,          // 快捷方式指向的是文件夹
      count: childCount,
      size: st.size, at: nowIso(),
    };
    this.data.entries.push(entry);
    this._save();
    return { ok: true, entry };
  }

  /** 该层下一个追加序号（兼容没有 order 的历史条目） */
  _nextOrder(row) {
    const r = Number.isFinite(row) ? row : 0;
    const list = this.data.entries.filter(e => (e.row || 0) === r);
    if (!list.length) return 0;
    return Math.max(...list.map(e => (Number.isFinite(e.order) ? e.order : -1))) + 1;
  }

  /** 书架内换层 / 排序：只改元数据，不动文件；返回落定后的层与序号 */
  move(id, row, order) {
    const e = this.data.entries.find(x => x.id === id);
    if (!e) return { ok: false, error: '书架里没有这一条' };
    const r = Math.max(0, Number.isFinite(row) ? Math.round(row) : 0);
    const oldRow = e.row || 0;
    const sorted = arr => arr.slice().sort((a, b) => {
      const ao = Number.isFinite(a.order) ? a.order : 1e6;
      const bo = Number.isFinite(b.order) ? b.order : 1e6;
      return ao - bo || this.data.entries.indexOf(a) - this.data.entries.indexOf(b);
    });
    const others = sorted(this.data.entries.filter(x => x.id !== id && (x.row || 0) === r));
    const pos = Math.max(0, Math.min(Number.isFinite(order) ? Math.round(order) : others.length, others.length));
    others.splice(pos, 0, e);
    e.row = r;
    others.forEach((x, i) => { x.order = i; });
    if (oldRow !== r) {
      sorted(this.data.entries.filter(x => x.id !== id && (x.row || 0) === oldRow))
        .forEach((x, i) => { x.order = i; });
    }
    this._save();
    return { ok: true, row: r, order: pos };
  }

  /** 单条还原 */
  restore(id) {
    const e = this.data.entries.find(x => x.id === id);
    if (!e) return { ok: false, error: '书架里没有这一条' };
    if (!exists(e.storedPath)) {
      this.journal({ op: 'restore-missing', id, storedPath: e.storedPath });
      return { ok: false, error: '收纳目录里找不到原件：' + e.storedPath };
    }
    const target = exists(e.originalPath) ? uniquePath(this.desktop, e.name) : e.originalPath;
    this.journal({ op: 'restore-intent', id, name: e.name, from: e.storedPath, to: target });
    try {
      const how = this._move(e.storedPath, target);
      this.journal({ op: 'restore-done', id, name: e.name, to: target, how: how.how });
    } catch (err) {
      this.journal({ op: 'restore-failed', id, name: e.name, error: err.message });
      return { ok: false, error: err.message };
    }
    try { fs.rmdirSync(path.dirname(e.storedPath)); } catch (err) {}
    this.data.entries = this.data.entries.filter(x => x.id !== id);
    this._save();
    return { ok: true, path: target };
  }

  /** 原件已经被送进回收站：同步删掉书架条目，别留一本打不开的书 */
  discard(id) {
    const e = this.data.entries.find(x => x.id === id);
    if (!e) return { ok: false, error: '书架里没有这一条' };
    this.journal({ op: 'shelf-discard', id, name: e.name, storedPath: e.storedPath });
    this.data.entries = this.data.entries.filter(x => x.id !== id);
    this._save();
    return { ok: true, entry: e };
  }

  /** 一键还原全部：逐条来，失败不中断 */
  restoreAll() {
    const list = this.data.entries.slice();
    const done = [];
    const failed = [];
    for (const e of list) {
      const r = this.restore(e.id);
      if (r.ok) done.push({ name: e.name, to: r.path });
      else failed.push({ name: e.name, error: r.error });
    }
    return { ok: failed.length === 0, total: list.length, done, failed };
  }

  /** 退出时「解散」虚拟书架：把收纳目录里的原件全部放回桌面原位，但保留条目。
      下一次启动 rehydrate 会按条目把它们再收回书架，于是书架看起来跨重启仍在，
      而 App 关掉时文件始终躺在桌面上，不依赖收纳目录是否还在。 */
  dissolveAll() {
    const list = this.data.entries.slice();
    const done = [];
    const failed = [];
    for (const e of list) {
      if (!exists(e.storedPath)) continue;
      const target = exists(e.originalPath) ? uniquePath(this.desktop, e.name) : e.originalPath;
      this.journal({ op: 'dissolve-intent', id: e.id, name: e.name, from: e.storedPath, to: target });
      try {
        const how = this._move(e.storedPath, target);
        e.restoredPath = target;
        // 记下放回桌面那一份的身份：启动恢复时只认「还是这一份」，
        // 用户在 App 关闭期间删掉又新建同名文件的，绝不把新文件吞进书架
        try {
          const st = statOf(target);
          e.restoredSize = st.size;
          e.restoredMtime = st.mtime;
        } catch (err) { delete e.restoredSize; delete e.restoredMtime; }
        done.push({ id: e.id, to: target });
        this.journal({ op: 'dissolve-done', id: e.id, name: e.name, to: target, how: how.how });
      } catch (err) {
        failed.push({ id: e.id, name: e.name, error: err.message });
        this.journal({ op: 'dissolve-failed', id: e.id, name: e.name, error: err.message });
      }
    }
    this._save();
    // 目录空了就删掉，桌面上不留一个空壳；只删空目录，万一有文件没搬走就原样保留
    const prune = dir => {
      let names = [];
      try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const d of names) if (d.isDirectory()) prune(path.join(dir, d.name));
      try { fs.rmdirSync(dir); } catch (e) {}
    };
    prune(this.shelfDir);
    return { ok: failed.length === 0, total: list.length, done, failed };
  }

  /** 启动时把上次解散回桌面的文件重新收进书架；原路径不存在就留在桌面并记一笔缺失 */
  rehydrate() {
    let moved = 0;
    const missing = [];
    const inside = p => {
      const rel = path.relative(this.shelfDir, path.resolve(String(p || '')));
      return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    };
    for (const e of this.data.entries) {
      // 旧版本把文件收在 %APPDATA% 里：启动时先迁到新的桌面书架目录
      if (exists(e.storedPath) && !inside(e.storedPath)) {
        const dir = path.join(this.shelfDir, e.id);
        const to = path.join(dir, path.basename(e.storedPath));
        try {
          fs.mkdirSync(dir, { recursive: true });
          this._move(e.storedPath, to);
          e.storedPath = to;
          moved += 1;
          this.journal({ op: 'shelf-migrate', id: e.id, name: e.name, to });
        } catch (err) {
          this.journal({ op: 'shelf-migrate-failed', id: e.id, name: e.name, error: err.message });
        }
        continue;
      }
      if (exists(e.storedPath)) continue;
      const src = e.restoredPath;
      if (!src || !exists(src)) { missing.push(e.name); continue; }
      if (Number.isFinite(e.restoredSize) || Number.isFinite(e.restoredMtime)) {
        let st = null;
        try { st = statOf(src); } catch (err) { st = null; }
        const same = st && (!Number.isFinite(e.restoredSize) || st.size === e.restoredSize) &&
          (!Number.isFinite(e.restoredMtime) || Math.abs(st.mtime - e.restoredMtime) <= 2000);
        if (!same) { missing.push(e.name); continue; }
      }
      const dir = path.join(this.shelfDir, e.id);
      const to = path.join(dir, path.basename(src));
      try {
        fs.mkdirSync(dir, { recursive: true });
        const how = this._move(src, to);
        e.storedPath = to;
        e.name = path.basename(src);
        delete e.restoredPath;
        delete e.restoredSize;
        delete e.restoredMtime;
        moved += 1;
        this.journal({ op: 'rehydrate-done', id: e.id, name: e.name, from: src, how: how.how });
      } catch (err) {
        missing.push(e.name);
        this.journal({ op: 'rehydrate-failed', id: e.id, name: e.name, error: err.message });
      }
    }
    this._save();
    return { moved, missing };
  }

  /** 对账：书架记录与收纳目录是否一致 */
  audit() {
    let names = [];
    try { names = fs.readdirSync(this.shelfDir); } catch (e) { names = []; }
    const stored = new Set(names);
    const missing = [];
    const orphan = [];
    for (const e of this.data.entries) {
      if (!exists(e.storedPath)) missing.push(e.name);
      stored.delete(e.id);
    }
    for (const id of stored) orphan.push(id);
    return { entries: this.data.entries.length, missing, orphan };
  }
}

module.exports = { Store, uniquePath };
