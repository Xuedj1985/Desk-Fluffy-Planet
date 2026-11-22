// test-player-state.js —— 播放模式状态机单测（纯 Node，不启动 Electron）
'use strict';
const assert = require('assert');
const { PlayerState, MODES, MODE_LABELS, isAudioPathAllowed } = require('./player-state');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '  → ' + e.message); fail++; }
}
const tracks = [
  { name: '第一首.mp3', path: '/music/a.mp3' },
  { name: '第二首.mp3', path: '/music/b.mp3' },
  { name: '第三首.mp3', path: '/music/c.mp3' },
];
const fresh = mode => {
  const p = new PlayerState({ mode });
  p.setPlaylist(tracks);
  return p;
};

console.log('播放模式状态机：');
t('三态齐全且标签可读', () => {
  assert.deepStrictEqual(MODES, ['all', 'none', 'one']);
  assert.deepStrictEqual(MODE_LABELS, { all: '列表循环', none: '播完即停', one: '单曲循环' });
});
t('默认列表循环，非法初值回退 all', () => {
  assert.strictEqual(new PlayerState().mode, 'all');
  assert.strictEqual(new PlayerState({ mode: 'xxx' }).mode, 'all');
});
t('列表循环：逐首前进，末首回到第一首', () => {
  const p = fresh('all');
  assert.strictEqual(p.onEnded().index, 1);
  assert.strictEqual(p.onEnded().index, 2);
  const r = p.onEnded();
  assert.strictEqual(r.action, 'play');
  assert.strictEqual(r.index, 0);
  assert.strictEqual(p.playing, true);
});
t('播完即停 none：停止、index 不变、playing=false', () => {
  const p = fresh('none');
  p.select(1);
  const r = p.onEnded();
  assert.deepStrictEqual(r, { action: 'stop', index: 1 });
  assert.strictEqual(p.index, 1);
  assert.strictEqual(p.playing, false);
});
t('单曲循环 one：重播当前、index 不变、playing=true', () => {
  const p = fresh('one');
  p.select(2);
  const r = p.onEnded();
  assert.deepStrictEqual(r, { action: 'replay', index: 2 });
  assert.strictEqual(p.index, 2);
  assert.strictEqual(p.playing, true);
});
t('两种单曲语义可在同一实例上反复切换且不串味', () => {
  const p = fresh('none');
  assert.strictEqual(p.onEnded().action, 'stop');
  assert.strictEqual(p.setMode('one'), true);
  assert.strictEqual(p.onEnded().action, 'replay');
  assert.strictEqual(p.setMode('none'), true);
  assert.strictEqual(p.onEnded().action, 'stop');
  assert.strictEqual(p.setMode('all'), true);
  assert.strictEqual(p.onEnded().action, 'play');
});
t('空播放列表时三态都安全停止', () => {
  for (const m of MODES) {
    const p = new PlayerState({ mode: m });
    assert.strictEqual(p.onEnded().action, 'stop');
    assert.strictEqual(p.playing, false);
  }
});
t('单曲列表下 all 仍停在 index 0', () => {
  const p = new PlayerState({ mode: 'all' });
  p.setPlaylist([tracks[0]]);
  assert.strictEqual(p.onEnded().index, 0);
});
t('setMode 拒绝非法值且不改变当前模式', () => {
  const p = fresh('one');
  assert.strictEqual(p.setMode('bogus'), false);
  assert.strictEqual(p.mode, 'one');
});
t('nextMode 按 all→none→one→all 循环', () => {
  const p = fresh('all');
  assert.strictEqual(p.nextMode(), 'none');
  assert.strictEqual(p.nextMode(), 'one');
  assert.strictEqual(p.nextMode(), 'all');
});
t('label 随模式变化', () => {
  const p = fresh('all');
  assert.strictEqual(p.label(), '列表循环');
  p.nextMode(); assert.strictEqual(p.label(), '播完即停');
  p.nextMode(); assert.strictEqual(p.label(), '单曲循环');
});
t('select 边界被夹住，current 与 index 一致', () => {
  const p = fresh('all');
  p.select(-5); assert.strictEqual(p.index, 0);
  p.select(99); assert.strictEqual(p.index, 2);
  assert.strictEqual(p.current().name, '第三首.mp3');
});
t('setPlaylist 变短时 index 自动归零', () => {
  const p = fresh('all');
  p.select(2);
  p.setPlaylist([tracks[0]]);
  assert.strictEqual(p.index, 0);
});
t('toJSON 往返可恢复模式与进度', () => {
  const p = fresh('one');
  p.select(2);
  const saved = JSON.parse(JSON.stringify(p.toJSON()));
  const q = new PlayerState({ mode: saved.mode });
  q.setPlaylist(tracks); q.select(saved.index);
  assert.strictEqual(q.mode, 'one');
  assert.strictEqual(q.index, 2);
  assert.strictEqual(q.onEnded().action, 'replay');
});

t('协议白名单：目录内 .mp3 放行', () => {
  assert.strictEqual(isAudioPathAllowed('/music/a.mp3', '/music'), true);
  assert.strictEqual(isAudioPathAllowed('C:\\music\\子目录\\a.MP3', 'C:\\music'), true);
});
t('协议白名单：../ 穿越、非 mp3、未选目录一律拒绝', () => {
  assert.strictEqual(isAudioPathAllowed('/music/../secret.mp3', '/music'), false);
  assert.strictEqual(isAudioPathAllowed('/music/a.txt', '/music'), false);
  assert.strictEqual(isAudioPathAllowed('/music/a.mp3', ''), false);
  assert.strictEqual(isAudioPathAllowed('/music2/a.mp3', '/music'), false);
});

console.log('');
console.log('结果：通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
