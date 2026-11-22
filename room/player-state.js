// player-state.js —— 发音盒播放模式状态机（纯逻辑，无 Electron / DOM 依赖）
// 同一份文件给主进程单测（module.exports）和渲染进程（window.PlayerState）使用。
'use strict';

/** 代码里写死的三态：这是状态机自身的分支，不是「支持哪些模式」的可配置清单 */
const MODES = ['all', 'none', 'one'];
const MODE_LABELS = { all: '列表循环', none: '播完即停', one: '单曲循环' };

class PlayerState {
  constructor(opts) {
    const o = opts || {};
    this.playlist = [];
    this.index = 0;
    this.playing = false;
    this.mode = PlayerState.normalize(o.mode);
  }

  static normalize(mode) { return MODES.indexOf(mode) >= 0 ? mode : 'all'; }

  setPlaylist(files) {
    this.playlist = Array.isArray(files) ? files.slice() : [];
    if (this.index >= this.playlist.length) this.index = 0;
    return this.playlist.length;
  }

  /** 配置 / 接口切换：传入 all|none|one，非法值拒绝并保持原模式 */
  setMode(mode) {
    if (MODES.indexOf(mode) < 0) return false;
    this.mode = mode;
    return true;
  }

  /** UI 单按钮循环切换：all -> none -> one -> all */
  nextMode() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    return this.mode;
  }

  label() { return MODE_LABELS[this.mode]; }
  current() { return this.playlist[this.index] || null; }

  select(i) {
    if (!this.playlist.length) return false;
    const n = Number(i);
    this.index = Math.max(0, Math.min(Number.isFinite(n) ? Math.round(n) : 0, this.playlist.length - 1));
    return true;
  }

  play() { this.playing = this.playlist.length > 0; return this.playing; }
  pause() { this.playing = false; }

  /** 一首播完：返回下一步动作，调用方据此操作 <audio> */
  onEnded() {
    if (!this.playlist.length) { this.playing = false; return { action: 'stop', index: this.index }; }
    if (this.mode === 'one') { this.playing = true; return { action: 'replay', index: this.index }; }
    if (this.mode === 'none') { this.playing = false; return { action: 'stop', index: this.index }; }
    this.index = (this.index + 1) % this.playlist.length;
    this.playing = true;
    return { action: 'play', index: this.index };
  }

  toJSON() { return { mode: this.mode, index: this.index }; }
}

function normalizePath(p) {
  const parts = [];
  for (const seg of String(p).replace(/\\/g, '/').split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return '/' + parts.join('/');
}

/** 只允许播放「已选文件夹内的 .mp3」；先压平 ../ 再判前缀，挡住路径穿越 */
function isAudioPathAllowed(full, root) {
  if (!root || !full || !/\.mp3$/i.test(String(full))) return false;
  const f = normalizePath(full), r = normalizePath(root);
  return f === r || f.startsWith(r + '/');
}

const api = { PlayerState, MODES, MODE_LABELS, isAudioPathAllowed };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.PlayerState = api;
