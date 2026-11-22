// verify/test-shelf-virtual.js —— 桌面虚拟书架：退出解散 / 启动恢复 / 旧目录迁移
// 只用临时目录，绝不碰真实桌面。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Store } = require('../room/store');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + ' :: ' + e.message); fail++; }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xome-shelf-virtual-'));
const desk = path.join(root, 'desk');
const data = path.join(root, 'data');
fs.mkdirSync(desk, { recursive: true });
fs.mkdirSync(data, { recursive: true });

const shelfDir = path.join(desk, '糖绒星球书架');
const fileA = path.join(desk, '报告.pdf');
const fileB = path.join(desk, '照片.png');
fs.writeFileSync(fileA, 'A');
fs.writeFileSync(fileB, 'B');

const store = new Store({ dataDir: data, desktop: desk, shelfDir });

t('收纳目录在桌面内，不是 AppData', () => {
  assert.strictEqual(path.dirname(store.shelfDir), desk);
});

const r1 = store.shelve(fileA, 0);
const r2 = store.shelve(fileB, 2);
t('文件被收进桌面书架目录', () => {
  assert.ok(r1.ok && r2.ok);
  assert.ok(fs.existsSync(r1.entry.storedPath) && fs.existsSync(r2.entry.storedPath));
  assert.ok(r1.entry.storedPath.startsWith(shelfDir + path.sep));
  assert.ok(!fs.existsSync(fileA) && !fs.existsSync(fileB));
  assert.strictEqual(store.entries().length, 2);
});

const dis = store.dissolveAll();
t('退出解散：文件回到桌面原位', () => {
  assert.strictEqual(dis.total, 2);
  assert.ok(fs.existsSync(fileA) && fs.existsSync(fileB));
  assert.ok(!fs.existsSync(shelfDir), '空的书架目录应被删掉');
  assert.strictEqual(store.entries().length, 2, '条目要保留，供下次启动恢复');
});

const store2 = new Store({ dataDir: data, desktop: desk, shelfDir });
const re = store2.rehydrate();
t('下次启动：按条目把文件收回书架', () => {
  assert.strictEqual(re.moved, 2);
  assert.ok(!fs.existsSync(fileA) && !fs.existsSync(fileB));
  assert.strictEqual(store2.entries().length, 2);
  for (const e of store2.entries()) assert.ok(fs.existsSync(e.storedPath), e.name);
});

t('退出后原文件被删改，不会用旧快照覆盖新文件', () => {
  // 解散后 报告.pdf 回到桌面；用户把它删掉、又新建了同名文件
  const s3 = new Store({ dataDir: data, desktop: desk, shelfDir });
  s3.dissolveAll();
  fs.unlinkSync(fileA);
  fs.writeFileSync(fileA, '用户新建');
  const rr = s3.rehydrate();
  assert.ok(rr.missing.some(n => /报告/.test(n)), JSON.stringify(rr));
  assert.strictEqual(fs.readFileSync(fileA, 'utf8'), '用户新建');
  assert.ok(!fs.readdirSync(shelfDir).some(id => fs.existsSync(path.join(shelfDir, id, '报告.pdf'))));
});

t('旧版 %APPDATA% 收纳目录会在启动时迁移到桌面书架', () => {
  const oldData = path.join(root, 'oldData');
  const oldShelf = path.join(oldData, 'shelf');
  fs.mkdirSync(oldShelf, { recursive: true });
  const oldFile = path.join(oldShelf, 'e1', '旧资料.txt');
  fs.mkdirSync(path.dirname(oldFile), { recursive: true });
  fs.writeFileSync(oldFile, 'old');
  fs.writeFileSync(path.join(oldData, 'shelf.json'), JSON.stringify({
    entries: [{
      id: 'e1', name: '旧资料.txt', storedPath: oldFile,
      originalPath: path.join(desk, '旧资料.txt'), row: 0, order: 0, kind: 'file',
    }],
  }), 'utf8');
  const s4 = new Store({ dataDir: oldData, desktop: desk, shelfDir });
  const rr = s4.rehydrate();
  assert.ok(rr.moved >= 1, JSON.stringify(rr));
  const e = s4.entries().find(x => x.id === 'e1');
  assert.ok(e.storedPath.startsWith(shelfDir + path.sep), e.storedPath);
  assert.ok(fs.existsSync(e.storedPath));
});

console.log('\n结果：通过 ' + pass + '，失败 ' + fail);
try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
