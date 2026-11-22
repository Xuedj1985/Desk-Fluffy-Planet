// test-model.js —— 糖绒星球纯逻辑单测（只跑内存数据，不碰文件系统）
'use strict';
const assert = require('assert');
const PM = require('./model');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '  → ' + e.message); fail++; }
}

console.log('糖绒星球 · 纯逻辑单测');
console.log('');

// 1. 画布适配：等比缩放 + 居中
const f = PM.computeFit(1600, 1000);
t('1440×940 在 1600×1000 下缩放 1.0638', () => assert.ok(Math.abs(f.scale - 1.0638297872340425) < 1e-9, f.scale));
t('水平居中留白 34px', () => assert.ok(Math.abs(f.ox - 34.0425531914893) < 0.01, f.ox));
t('高度刚好铺满，无上下偏移', () => assert.ok(Math.abs(f.oy) < 1e-9, f.oy));

const f2 = PM.computeFit(1920, 1080);
t('1920×1080 缩放 1.1489', () => assert.ok(Math.abs(f2.scale - 1080 / 940) < 1e-9, f2.scale));
t('1920×1080 无上下留白', () => assert.ok(Math.abs(f2.oy) < 1e-9));

const f3 = PM.computeFit(800, 600);
t('小窗口按短边收缩且至少一边留白',
  () => assert.ok(f3.scale < 1 && (f3.ox > 1 || f3.oy > 1), JSON.stringify(f3)));

// 2. 展位数量：代码限制 1–6
t('站位数 0 收到 1', () => assert.strictEqual(PM.clampCount(0), 1));
t('站位数 9 收到 6', () => assert.strictEqual(PM.clampCount(9), 6));
t('站位数 3.4 取整为 3', () => assert.strictEqual(PM.clampCount(3.4), 3));
t('非法值回落到默认 5', () => assert.strictEqual(PM.clampCount('x'), 5));

// 3. 系列与站位
t('未知系列回落到星星人', () => assert.strictEqual(PM.seriesOf('nope').label, PM.seriesOf('starman').label));
t('5 只站位有 5 个位置', () => assert.strictEqual(PM.stagesFor(5).length, 5));
t('6 只站位有 6 个位置', () => assert.strictEqual(PM.stagesFor(6).length, 6));
t('1 只站位只有 1 个位置', () => assert.strictEqual(PM.stagesFor(1).length, 1));
t('每个站位都有前后层级与缩放', () => PM.stagesFor(6).every(s =>
  typeof s.z === 'number' && typeof s.s === 'number' && typeof s.x === 'number'));
t('5 只站位至少 4 种缩放（不是并排卡片）',
  () => assert.ok(new Set(PM.stagesFor(5).map(s => s.s)).size >= 4));
t('5 只站位层级互不相同', () => assert.strictEqual(new Set(PM.stagesFor(5).map(s => s.z)).size, 5));

// 4. 槽位交换
const slots = ['a', 'b', 'c', 'd'];
const swapped = PM.swapSlots(slots, 0, 2);
t('交换 0↔2 结果正确', () => assert.deepStrictEqual(swapped, ['c', 'b', 'a', 'd']));
t('交换不改原数组', () => assert.deepStrictEqual(slots, ['a', 'b', 'c', 'd']));
t('同位交换原样返回', () => assert.deepStrictEqual(PM.swapSlots(slots, 1, 1), slots));
t('越界交换不抛错也不改内容', () => assert.deepStrictEqual(PM.swapSlots(slots, 0, 9), slots));
t('空列表交换返回空数组', () => assert.deepStrictEqual(PM.swapSlots(null, 0, 1), []));

// 5. 删除与撤销
const list = ['t1', 't2', 't3'];
const rm = PM.removeAt(list, 1);
t('删除返回被删项与原位置', () => assert.deepStrictEqual([rm.removed, rm.index], ['t2', 1]));
t('删除后列表正确', () => assert.deepStrictEqual(rm.list, ['t1', 't3']));
t('删除不改原数组', () => assert.deepStrictEqual(list, ['t1', 't2', 't3']));
t('撤销插回原位置', () => assert.deepStrictEqual(PM.insertAt(rm.list, rm.index, rm.removed), list));
t('越界删除安全返回', () => assert.deepStrictEqual(PM.removeAt(list, 9), { list, removed: null, index: -1 }));
t('插入位置被夹在 0..length', () => assert.deepStrictEqual(PM.insertAt(['a'], 99, 'b'), ['a', 'b']));

// 6. 书架行判定
const rows = [
  { top: 0.05, bottom: 0.2 }, { top: 0.25, bottom: 0.4 },
  { top: 0.45, bottom: 0.6 }, { top: 0.65, bottom: 0.8 }, { top: 0.85, bottom: 0.98 },
];
t('落在第 3 行', () => assert.strictEqual(PM.rowFromY(0.5, rows), 2));
t('落在行间缝隙时归到下一行', () => assert.strictEqual(PM.rowFromY(0.44, rows), 2));
t('高于首行归到第 1 行', () => assert.strictEqual(PM.rowFromY(0.01, rows), 0));
t('低于末行归到最后一行', () => assert.strictEqual(PM.rowFromY(0.99, rows), 4));
t('没有行时返回 -1', () => assert.strictEqual(PM.rowFromY(0.5, []), -1));

// 7. 地毯排布
const pos = PM.gridPositions(8, 96, 78, 478, 300, { pad: 24, gapX: 4, gapY: 2 });
t('排布数量正确', () => assert.strictEqual(pos.length, 8));
t('排布全在可视区内', () => pos.every(p =>
  p.x >= 0 && p.x <= 478 - 96 && p.y >= 0 && p.y <= 300 - 78));
t('排布不重叠', () => {
  for (let i = 0; i < pos.length; i++) {
    for (let j = i + 1; j < pos.length; j++) {
      const dx = Math.abs(pos[i].x - pos[j].x), dy = Math.abs(pos[i].y - pos[j].y);
      assert.ok(dx >= 96 || dy >= 78, '第 ' + i + ' 与 ' + j + ' 重叠');
    }
  }
});
t('排布是确定的（同参数两次一致）',
  () => assert.deepStrictEqual(PM.gridPositions(8, 96, 78, 478, 300, { pad: 24, gapX: 4, gapY: 2 }), pos));

// 8. 越界夹取与拖拽原点
t('拖出右边界会夹回来', () => assert.deepStrictEqual(PM.clampPos(9999, 9999, 96, 78, 478, 300), { x: 478 - 96 - 4, y: 300 - 78 - 4 }));
t('拖出左边界会夹回来', () => assert.deepStrictEqual(PM.clampPos(-99, -99, 96, 78, 478, 300), { x: 4, y: 4 }));
t('抓取偏移换算成左上角', () => assert.deepStrictEqual(PM.dragOrigin(500, 400, 20, 10, 2), { x: 490, y: 395 }));

// 9. 底部安全间距：画布不能贴住窗口底边
const fs1 = PM.computeFit(1920, 1080, 1440, 940, 32);
t('1080p 预留 32px 后按高度缩放', () => assert.ok(Math.abs(fs1.scale - 1048 / 940) < 1e-9, fs1.scale));
t('画布底边正好停在安全线上', () => {
  const bottom = fs1.oy + 940 * fs1.scale;
  assert.ok(Math.abs(bottom - (1080 - 32)) < 1e-9, bottom);
});
t('没有安全间距时仍按原比例', () => assert.ok(Math.abs(PM.computeFit(1920, 1080, 1440, 940, 0).scale - 1080 / 940) < 1e-9));
t('安全间距不会把画布挤到不可用', () => assert.ok(PM.computeFit(800, 600, 1440, 940, 9999).scale > 0));

// 10. 分辨率档位：参考分辨率决定 UI 大小，当前窗口是硬上限
const auto4k = PM.fitFor(3840, 2160, 'auto', 56);
t('4K 自动档按安全后的高度缩放', () => assert.ok(Math.abs(auto4k.scale - 2104 / 940) < 1e-9, auto4k.scale));
const fhd4k = PM.fitFor(3840, 2160, 'fhd', 56);
t('4K 选 1080p 档 = 1080p 的缩放比例', () => assert.ok(Math.abs(fhd4k.scale - 1080 / 940) < 1e-9, fhd4k.scale));
t('选小档后画面居中且不溢出', () => assert.ok(fhd4k.ox > 0 && fhd4k.oy > 0 &&
  fhd4k.ox + 1440 * fhd4k.scale <= 3840 + 0.01 && fhd4k.oy + 940 * fhd4k.scale <= 2160 - 56 + 0.01,
  JSON.stringify(fhd4k)));
const uhdSmall = PM.fitFor(1366, 768, 'uhd', 24);
t('小屏选大档会被当前窗口夹住', () => assert.ok(uhdSmall.scale <= (768 - 24) / 940 + 1e-9 &&
  uhdSmall.ox >= 0 && uhdSmall.oy >= 0, JSON.stringify(uhdSmall)));
t('未知档位回落到自动', () => assert.strictEqual(PM.fitFor(1920, 1080, 'nope', 0).preset, 'auto'));
t('档位标签可读', () => assert.strictEqual(PM.displayPresetLabel('fhd'), '1920 × 1080'));
t('档位覆盖 1080p–3120 共四档 + 自动', () => assert.strictEqual(PM.DISPLAY_KEYS.length, 5));
t('最高档是 3120×2080', () => assert.deepStrictEqual(
  { w: PM.DISPLAY_PRESETS.uhd.w, h: PM.DISPLAY_PRESETS.uhd.h }, { w: 3120, h: 2080 }));

// 10.1 画布横向展开：16:9 把中间展柜拉宽，3:2 保持基准
t('16:9 画布展开到 1671', () => assert.strictEqual(PM.stageWidth(1920, 1080), 1671));
t('16:10 画布展开到 1504', () => assert.strictEqual(PM.stageWidth(1600, 1000), 1504));
t('3:2（3120×2080）保持 1440 基准', () => assert.strictEqual(PM.stageWidth(3120, 2080), 1440));
t('超宽屏封顶 1720', () => assert.strictEqual(PM.stageWidth(3440, 1440), 1720));
const wideFit = PM.fitFor(1920, 1080, 'auto', 32, PM.stageWidth(1920, 1080));
t('16:9 自动档铺满宽度只留 28px 边', () => {
  assert.ok(Math.abs(wideFit.scale - 1048 / 940) < 1e-9, wideFit.scale);
  assert.ok(Math.abs(wideFit.ox - (1920 - 1671 * wideFit.scale) / 2) < 0.01, wideFit.ox);
});
t('16:9 画布宽度不含安全间距', () => assert.ok(1671 * wideFit.scale > 1860, 1671 * wideFit.scale));
const wideFhd = PM.fitFor(2560, 1440, 'fhd', 43, PM.stageWidth(2560, 1440));
t('2K 屏选 1080p = 1920×1080 的画面块', () => {
  assert.ok(Math.abs(wideFhd.scale - 1080 / 940) < 0.01, wideFhd.scale);
  assert.ok(Math.abs(1671 * wideFhd.scale - 1920) < 3, 1671 * wideFhd.scale);
});

// 11. 玩偶自由摆位
const p1 = PM.clampPose(-10, 5);
t('摆位夹在玻璃柜内（左/上）', () => assert.deepStrictEqual(p1, { x: 5, y: 18 }));
t('摆位夹在玻璃柜内（右/下）', () => assert.deepStrictEqual(PM.clampPose(120, 120), { x: 95, y: 98 }));
t('摆位保留两位小数', () => assert.deepStrictEqual(PM.clampPose(50.1234, 60.4567), { x: 50.12, y: 60.46 }));

const basePose = { x: 50, y: 96, s: 1.26, z: 10, b: 1, blur: 0 };
const same = PM.poseScale(basePose, 96);
t('默认站位不改变原有大小与层级', () => assert.deepStrictEqual(same, { s: 1.26, z: 10, b: 1, blur: 0 }));
const back = PM.poseScale(basePose, 40);
t('往上摆 = 更小、更靠后，但不自动变暗', () => assert.ok(back.s < 1.26 && back.z < 10 && back.b === 1 && back.blur === 0,
  JSON.stringify(back)));
const lowBase = { x: 50, y: 40, s: 1, z: 3, b: 0.85, blur: 0.4 };
const front = PM.poseScale(lowBase, 70);
t('往下摆 = 更大、更靠前，依然保持原色', () => assert.ok(front.s > 1 && front.z > 3 && front.b === 1 && front.blur === 0,
  JSON.stringify(front)));
const nearPose = { x: 50, y: 60, s: 1, z: 5, b: 0.9, blur: 0.2 };
const near = PM.poseScale(nearPose, 90);
t('从后排拖到前排会放大并压到上层', () => assert.ok(near.s > 1 && near.z > 5 && near.b === 1 && near.blur === 0,
  JSON.stringify(near)));

// 11.1 手动层级（滚轮调前后）
t('层级夹在 1–14', () => assert.deepStrictEqual(
  [PM.clampDepth(0), PM.clampDepth(99), PM.clampDepth(5.6)], [1, 14, 6]));
const overrideFront = PM.poseScale({ x: 50, y: 58, s: 0.7, z: 2, b: 0.76, blur: 0.6 }, 58, 14);
t('滚到最前：层级 14、亮度拉满、模糊消失', () =>
  overrideFront.z === 14 && overrideFront.b >= 1 && overrideFront.blur === 0,
  JSON.stringify(overrideFront));
t('滚到最前不改变大小（大小仍归脚底线管）', () => assert.strictEqual(overrideFront.s, 0.7));
const overrideBack = PM.poseScale({ x: 50, y: 80, s: 1.1, z: 9, b: 1, blur: 0 }, 80, 1);
t('滚到最后：层级 1，但仍保持原色不自动变暗', () =>
  overrideBack.z === 1 && overrideBack.b === 1 && overrideBack.blur === 0,
  JSON.stringify(overrideBack));
t('非法层位回落到 1', () => assert.strictEqual(PM.clampDepth('x'), 1));
t('名次按层级从小到大排，同层按 DOM 顺序', () => assert.deepStrictEqual(
  PM.depthRanks([3, 1, 3]), [2, 1, 3]));
t('名次永远是 1..N', () => assert.deepStrictEqual(PM.depthRanks([14, 2, 9, 1]), [4, 2, 3, 1]));

// 11.2 换层：和相邻名次交换深度槽
t('往前换一层 = 和上一名交换 z', () => assert.deepStrictEqual(
  PM.stepDepth([3, 9, 5], 0, 1), [5, 9, 3]));
t('再往前一层就压过原来最前的', () => assert.deepStrictEqual(
  PM.stepDepth([5, 9, 3], 0, 1), [9, 5, 3]));
t('往后换一层 = 和下一名交换 z', () => assert.deepStrictEqual(
  PM.stepDepth([9, 5, 3], 0, -1), [5, 9, 3]));
t('已在最后不能再往后', () => assert.strictEqual(PM.stepDepth([3, 9, 5], 0, -1), null));
t('已到最前不能再往前', () => assert.strictEqual(PM.stepDepth([9, 5, 3], 0, 1), null));
t('只有一只时没有前后可换', () => assert.strictEqual(PM.stepDepth([7], 0, 1), null));
t('同层换层会破平（往前抬一格）', () => assert.deepStrictEqual(PM.stepDepth([5, 5], 0, 1), [6, 5]));
t('换层不修改入参', () => {
  const zs = [3, 9, 5];
  PM.stepDepth(zs, 0, 1);
  assert.deepStrictEqual(zs, [3, 9, 5]);
});

// 11.3 取消自动变暗：不管排第几层，玩偶都保持原色、不模糊
const asFront = PM.poseScale({ x: 50, y: 58, s: 0.7, z: 2, b: 0.76, blur: 0.6 }, 58, 9, 1);
const asBack = PM.poseScale({ x: 50, y: 58, s: 0.7, z: 2, b: 0.76, blur: 0.6 }, 58, 9, 0);
t('排最前时亮度拉满、无模糊', () =>
  asFront.b === 1 && asFront.blur === 0, JSON.stringify(asFront));
t('排最后时同样不变暗、不模糊（只改遮挡层级）', () =>
  asBack.b === 1 && asBack.blur === 0, JSON.stringify(asBack));

// 12. 档案盒正面短名：头四个字
t('长名字只留头四个字', () => assert.strictEqual(PM.shortName('海边照片收藏', 4), '海边照片'));
t('快捷方式先摘掉 .lnk 再截断', () => assert.strictEqual(PM.shortName('资料快捷.lnk', 4), '资料快捷'));
t('可执行文件先摘掉 .exe 再截断', () => assert.strictEqual(PM.shortName('微信.exe', 4), '微信'));
t('短名字原样保留', () => assert.strictEqual(PM.shortName('资料', 4), '资料'));
t('空名字返回空串（调用方自己兜底）', () => assert.strictEqual(PM.shortName('', 4), ''));
t('首尾空格不会占掉一个字', () => assert.strictEqual(PM.shortName('  旅行照片  ', 4), '旅行照片'));
t('emoji 不会被劈成半个', () => {
  const out = PM.shortName('🌊🌴📷📚📁', 4);
  assert.strictEqual(Array.from(out).length, 4, out);
  assert.ok(out.indexOf('\uFFFD') < 0, out);
});
t('上限可以收得更紧', () => assert.strictEqual(PM.shortName('海边照片收藏', 2), '海边'));

// 12.0 书脊整字数：宁少一个字，不留半截字
t('最矮的 54px 书脊正好排四个字', () => assert.strictEqual(PM.spineChars(54), 4));
t('58px 排五个字', () => assert.strictEqual(PM.spineChars(58), 5));
t('66px 排六个字', () => assert.strictEqual(PM.spineChars(66), 6));
t('71px 仍是六个字（不硬塞第七个）', () => assert.strictEqual(PM.spineChars(71), 6));
t('再矮也不少于四个字', () => assert.strictEqual(PM.spineChars(30), 4));
t('整字截断与书脊渲染同源', () => {
  const h = 58;
  const txt = PM.shortName('春夏秋冬备忘录.txt', PM.spineChars(h));
  assert.strictEqual(txt, '春夏秋冬备');
});

// 12.1 标签行拆分：汉字 2×2，窄字整行
t('四个汉字拆成两行两字', () => assert.deepStrictEqual(PM.boxRows('海边照片收藏', 4), ['海边', '照片']));
t('数字名字整行，不拆成 20/26', () => assert.deepStrictEqual(PM.boxRows('2026 年度照片', 4), ['2026']));
t('两个汉字只占一行', () => assert.deepStrictEqual(PM.boxRows('旅行', 4), ['旅行']));
t('英文名整行', () => assert.deepStrictEqual(PM.boxRows('work', 4), ['work']));
t('空名字给一个可渲染的空行', () => assert.deepStrictEqual(PM.boxRows('', 4), ['']));

// 13. 底部应用坞：分栏、保留摆位、新应用落最空组、拖动换位
const dk0 = PM.reconcileDock([], ['a', 'b', 'c'], 3);
t('首次把三个应用均分到三栏', () => assert.deepStrictEqual(
  dk0.map(x => [x.key, x.g, x.o]), [['a', 0, 0], ['b', 1, 0], ['c', 2, 0]]));
t('两个应用只占前两栏', () => assert.deepStrictEqual(
  PM.reconcileDock([], ['a', 'b'], 3).map(x => x.g), [0, 1]));

const dkKeep = PM.reconcileDock([
  { key: 'a', g: 2, o: 0 }, { key: 'b', g: 0, o: 0 },
], ['a', 'b', 'c'], 3);
t('已保存的摆位优先保留', () => assert.deepStrictEqual(
  dkKeep.map(x => [x.key, x.g]), [['b', 0], ['c', 1], ['a', 2]]));
t('新应用自动落到最空的一组', () => assert.strictEqual(dkKeep.find(x => x.key === 'c').g, 1));

const dkDrop = PM.reconcileDock([{ key: 'gone', g: 0, o: 0 }], ['a'], 2);
t('桌面上已移除的应用会被清掉', () => assert.deepStrictEqual(dkDrop.map(x => x.key), ['a']));

const dkMove = PM.moveDockItem(dk0, 'a', 1, 1, 3);
t('拖动到另一栏的指定位置', () => assert.deepStrictEqual(
  dkMove.filter(x => x.g === 1).map(x => [x.key, x.o]), [['b', 0], ['a', 1]]));
t('拖动后原栏不再有它', () => assert.ok(!dkMove.some(x => x.key === 'a' && x.g === 0)));
t('拖到栏首也能插入', () => assert.deepStrictEqual(
  PM.moveDockItem(dk0, 'c', 0, 0, 3).filter(x => x.g === 0).map(x => x.key), ['c', 'a']));
t('越界的栏号会被夹住', () => assert.ok(PM.moveDockItem(dk0, 'a', 9, 0, 3).every(x => x.g <= 2)));

const dk2 = PM.setDockCols(dk0, 2);
t('切到 2 栏时第三栏并进第二栏', () => assert.deepStrictEqual(
  dk2.map(x => [x.key, x.g]), [['a', 0], ['b', 1], ['c', 1]]));
t('切栏不丢图标', () => assert.strictEqual(dk2.length, 3));
t('非法栏数回落到 3', () => assert.strictEqual(PM.clampDockCols(9), 3));
t('重复 key 只留一条', () => assert.strictEqual(
  PM.normalizeDock([{ key: 'a' }, { key: 'a' }], 2).length, 1));

// 8. 书脊底色浅化：抬亮度、保色相，让深墨粗字在任意格式色上都够清楚
const relLum = hex => {
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const contrast = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
t('格式色浅化后亮度明显抬升', () => {
  const out = PM.lightenInk('#1D3A6B');
  assert.ok(/^#[0-9A-F]{6}$/.test(out));
  assert.ok(relLum(out) > relLum('#1D3A6B') + 0.25, out);
});
t('浅化保留色相（蓝色仍是 B>R>G）', () => {
  const c = PM.lightenInk('#7F9FD2');
  const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
  assert.ok(b > g && g > r, c);
});
t('白色浅化后仍是白色', () => assert.strictEqual(PM.lightenInk('#FFFFFF'), '#FFFFFF'));
t('三位简写与六位等价', () => assert.strictEqual(PM.lightenInk('#abc'), PM.lightenInk('#AABBCC')));
t('非法颜色回落到中性浅色', () => assert.strictEqual(PM.lightenInk('rgb(1,2,3)'), '#EDE3F2'));
t('ratio 夹在 0..1（0 = 原色、1 = 纯白）', () => {
  assert.strictEqual(PM.lightenInk('#123456', 0), '#123456');
  assert.strictEqual(PM.lightenInk('#123456', 1), '#FFFFFF');
  assert.strictEqual(PM.lightenInk('#123456', 9), '#FFFFFF');
});
t('内置全部格式色浅化后与深墨字对比度 ≥4.5', () => {
  const inks = ['#7F9FD2', '#7FC9A6', '#E79A7D', '#E58AA0', '#9BB3D6', '#B49BE0',
                '#D2B27A', '#C0A0B2', '#2F5597', '#217346', '#C43E1C', '#A52A2A',
                '#607D8B', '#7B5EA7', '#8A6D3B', '#7A6A52', '#1D3A6B'];
  const worst = inks.map(c => [c, +contrast(PM.lightenInk(c), '#2A3A52').toFixed(2)])
    .sort((a, b) => a[1] - b[1])[0];
  assert.ok(worst[1] >= 4.5, '最差 ' + JSON.stringify(worst));
});

console.log('');
console.log('结果：通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
