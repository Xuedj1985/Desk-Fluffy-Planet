// test-store.js —— 收纳/还原的破坏性测试（只用临时目录，不碰真实桌面）
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Store } = require('./store');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xome-store-'));
const desktop = path.join(root, 'Desktop');
const dataDir = path.join(root, 'data');
fs.mkdirSync(desktop, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '  → ' + e.message); fail++; }
}

const store = new Store({ dataDir, desktop });

console.log('收纳目录：' + store.shelfDir);
console.log('');

// 1. 收纳单个文件
const f1 = path.join(desktop, '会议纪要.txt');
fs.writeFileSync(f1, 'hello');
const r1 = store.shelve(f1, 1);
t('收纳成功', () => assert.ok(r1.ok, r1.error));
t('原件已离开桌面', () => assert.ok(!fs.existsSync(f1)));
t('收纳目录里有这个文件', () => assert.ok(fs.existsSync(r1.entry.storedPath)));
t('内容没坏', () => assert.strictEqual(fs.readFileSync(r1.entry.storedPath, 'utf8'), 'hello'));
t('记录了原路径', () => assert.strictEqual(r1.entry.originalPath, f1));
t('书架有一条', () => assert.strictEqual(store.entries().length, 1));

// 2. 日志
const j = store.journalTail(10);
t('日志有 intent 和 done', () => {
  assert.ok(j.some(x => x.op === 'shelve-intent'), '缺 intent');
  assert.ok(j.some(x => x.op === 'shelve-done'), '缺 done');
});
t('日志记了 from/to', () => {
  const i = j.find(x => x.op === 'shelve-intent');
  assert.strictEqual(i.from, f1);
  assert.ok(i.to.includes('shelf'));
});

// 3. 还原
const r2 = store.restore(r1.entry.id);
t('还原成功', () => assert.ok(r2.ok, r2.error));
t('文件回到原路径', () => assert.strictEqual(r2.path, f1));
t('内容没坏', () => assert.strictEqual(fs.readFileSync(f1, 'utf8'), 'hello'));
t('书架清空', () => assert.strictEqual(store.entries().length, 0));

// 4. 原路径被占：改名还原，不覆盖
const f2 = path.join(desktop, '撞名.txt');
fs.writeFileSync(f2, '第一份');
const r3 = store.shelve(f2, 0);
fs.writeFileSync(f2, '第二份');            // 收纳后又在桌面放一个同名文件
const r4 = store.restore(r3.entry.id);
t('撞名时还原成功', () => assert.ok(r4.ok, r4.error));
t('没有覆盖桌面上的同名文件', () => assert.strictEqual(fs.readFileSync(f2, 'utf8'), '第二份'));
t('还原成带序号的新名字', () => assert.ok(/\(2\)/.test(r4.path), r4.path));
t('新的那份内容正确', () => assert.strictEqual(fs.readFileSync(r4.path, 'utf8'), '第一份'));

// 5. 一键还原全部
const names = ['a.md', 'b.png', 'c.docx'];
const ids = [];
for (const n of names) {
  const p = path.join(desktop, n);
  fs.writeFileSync(p, n);
  const r = store.shelve(p, 0);
  ids.push(r.entry.id);
}
t('三条都进书架', () => assert.strictEqual(store.entries().length, 3));
const all = store.restoreAll();
t('一键还原全部成功', () => assert.ok(all.ok, JSON.stringify(all.failed)));
t('三条都回桌面', () => names.forEach(n => assert.ok(fs.existsSync(path.join(desktop, n)), n)));
t('书架清空', () => assert.strictEqual(store.entries().length, 0));

// 6. 对账
const audit = store.audit();
t('对账无缺失无孤儿', () => assert.deepStrictEqual(audit, { entries: 0, missing: [], orphan: [] }));

// 7. 收纳后删除（模拟拖进回收站）
const f5 = path.join(desktop, '要删的.log');
fs.writeFileSync(f5, 'x');
const r5 = store.shelve(f5, 2);
fs.unlinkSync(r5.entry.storedPath);
const a2 = store.audit();
t('文件被删后对账能报缺失', () => assert.ok(a2.missing.includes('要删的.log')));

// 8. 拒绝收纳不存在的路径
const bad = store.shelve(path.join(desktop, '不存在.txt'), 0);
t('不存在时明确失败', () => assert.strictEqual(bad.ok, false));

// 9. 收纳目录里的残留能不能被手工救回（打开目录即可见）
t('收纳目录可访问', () => assert.ok(fs.statSync(store.shelfDir).isDirectory()));

// 10. 书架内换层 / 排序：只改元数据，不动文件，落盘后重启不跳位
const mFiles = ['甲.docx', '乙.xlsx', '丙.pptx'].map(n => {
  const p = path.join(desktop, n);
  fs.writeFileSync(p, 'x');
  return p;
});
const before = store.entries().length;
const ma = store.shelve(mFiles[0], 0).entry;
const mb = store.shelve(mFiles[1], 0).entry;
const mc = store.shelve(mFiles[2], 0).entry;
const mIds = [ma.id, mb.id, mc.id];
const row0 = () => store.entries()
  .filter(e => e.row === 0 && mIds.indexOf(e.id) >= 0)
  .sort((x, y) => x.order - y.order).map(e => e.name);
t('新条目自动排到层尾', () => assert.deepStrictEqual([ma.order, mb.order, mc.order], [0, 1, 2]));
t('条目带扩展名', () => assert.strictEqual(ma.ext, '.docx'));
t('收纳后条数正确', () => assert.strictEqual(store.entries().length, before + 3));

const mv1 = store.move(mc.id, 2, 0);
t('换层成功', () => assert.ok(mv1.ok && mv1.row === 2 && mv1.order === 0));
t('换层后原件没被移动', () => assert.ok(fs.existsSync(mc.storedPath)));
t('原层重新编号', () => assert.deepStrictEqual(row0(), ['甲.docx', '乙.xlsx']));
t('新层落定在第 0 位', () => {
  const e = store.entries().find(x => x.id === mc.id);
  assert.strictEqual(e.row, 2);
  assert.strictEqual(e.order, 0);
});

const mv2 = store.move(ma.id, 0, 1);
t('层内改顺序成功', () => assert.ok(mv2.ok && mv2.order === 1));
t('层内顺序落定', () => assert.deepStrictEqual(row0(), ['乙.xlsx', '甲.docx']));

const store2 = new Store({ dataDir, desktop });
const row0b = () => store2.entries()
  .filter(e => e.row === 0 && mIds.indexOf(e.id) >= 0)
  .sort((x, y) => x.order - y.order).map(e => e.name);
t('重新读盘后顺序不变（吸附固定）', () => assert.deepStrictEqual(row0b(), ['乙.xlsx', '甲.docx']));
t('重新读盘后换层结果不变', () => assert.strictEqual(
  store2.entries().find(e => e.name === '丙.pptx').row, 2));

// 11. 文件夹条目带子项数量：档案盒上直接显示，不用点开才知道是不是空的
const dir = path.join(desktop, '项目资料');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
fs.mkdirSync(path.join(dir, '子目录'));
const rd = store2.shelve(dir, 4, { linkDir: false });
t('文件夹收纳成功', () => assert.ok(rd.ok, rd.error));
t('文件夹条目记录子项数量', () => assert.strictEqual(rd.entry.count, 3));

const empty = path.join(desktop, '空文件夹');
fs.mkdirSync(empty, { recursive: true });
const re = store2.shelve(empty, 4);
t('空文件夹数量为 0（界面不显示角标）', () => assert.strictEqual(re.entry.count, 0));

// 12. 原件被送进回收站后，条目要能同步移除，不留一本打不开的书
const gone = path.join(desktop, '待丢.txt');
fs.writeFileSync(gone, 'x');
const rg = store2.shelve(gone, 0);
const disc = store2.discard(rg.entry.id);
t('discard 返回被移除的条目', () => assert.ok(disc.ok && disc.entry.name === '待丢.txt', disc.error));
t('discard 后书架不再有这一条', () => assert.ok(!store2.entries().some(e => e.id === rg.entry.id)));
t('discard 写了日志', () => assert.ok(store2.journalTail(6).some(x => x.op === 'shelf-discard')));
t('discard 不存在的条目明确失败', () => assert.strictEqual(store2.discard('nope').ok, false));

console.log('');
console.log(`结果：通过 ${pass}，失败 ${fail}`);
fs.rmSync(root, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
