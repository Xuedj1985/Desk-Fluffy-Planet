const { contextBridge, ipcRenderer } = require('electron');

// 白名单桥：只转发下面明确列出的通道，不接受任意路径 / 任意命令透传。
contextBridge.exposeInMainWorld('planet', {
  init: () => ipcRenderer.invoke('planet:init'),
  refresh: () => ipcRenderer.invoke('planet:refresh'),
  saveLayout: l => ipcRenderer.invoke('planet:save-layout', l),

  icons: paths => ipcRenderer.invoke('planet:icons', paths),
  open: p => ipcRenderer.invoke('planet:open', p),
  reveal: p => ipcRenderer.invoke('planet:reveal', p),
  trash: p => ipcRenderer.invoke('planet:trash', p),
  rename: (p, n) => ipcRenderer.invoke('planet:rename', p, n),
  copyPath: p => ipcRenderer.invoke('planet:copy-path', p),
  openTrash: () => ipcRenderer.invoke('planet:open-trash'),
  archiveNote: text => ipcRenderer.invoke('planet:archive-note', text),
  openNotesArchive: () => ipcRenderer.invoke('planet:open-notes-archive'),

  shelve: (p, row) => ipcRenderer.invoke('planet:shelve', p, row),
  moveBook: (id, row, order) => ipcRenderer.invoke('planet:move-book', id, row, order),
  restore: id => ipcRenderer.invoke('planet:restore', id),
  discardBook: id => ipcRenderer.invoke('planet:discard', id),
  restoreAll: () => ipcRenderer.invoke('planet:restore-all'),
  shelfList: () => ipcRenderer.invoke('planet:shelf-list'),
  journal: () => ipcRenderer.invoke('planet:journal'),
  openShelfDir: () => ipcRenderer.invoke('planet:open-shelf'),

  albumList: () => ipcRenderer.invoke('planet:album-list'),
  albumPick: id => ipcRenderer.invoke('planet:album-pick', id),
  albumSet: (id, p) => ipcRenderer.invoke('planet:album-set', id, p),
  albumClear: id => ipcRenderer.invoke('planet:album-clear', id),
  albumOpen: id => ipcRenderer.invoke('planet:album-open', id),
  albumReveal: id => ipcRenderer.invoke('planet:album-reveal', id),

  figurePick: slot => ipcRenderer.invoke('planet:figure-pick', slot),
  figureSet: (slot, p) => ipcRenderer.invoke('planet:figure-set', slot, p),
  figureClear: slot => ipcRenderer.invoke('planet:figure-clear', slot),
  figureSwap: (a, b) => ipcRenderer.invoke('planet:figure-swap', a, b),
  figureSave: patch => ipcRenderer.invoke('planet:figure-save', patch),

  audioPickFolder: () => ipcRenderer.invoke('planet:audio-pick'),
  audioGetState: () => ipcRenderer.invoke('planet:audio-state'),
  audioSetMode: mode => ipcRenderer.invoke('planet:audio-mode', mode),
  audioSaveState: patch => ipcRenderer.invoke('planet:audio-save', patch),

  pcStats: () => ipcRenderer.invoke('planet:pc-stats'),
  pcOpen: key => ipcRenderer.invoke('planet:pc-open', key),

  getDisplay: () => ipcRenderer.invoke('planet:display-get'),
  setDisplay: preset => ipcRenderer.invoke('planet:display-set', preset),

  setIgnore: v => ipcRenderer.send('planet:ignore', v),
  focus: on => ipcRenderer.invoke('planet:focus', on),
  quit: () => ipcRenderer.send('planet:quit'),
  selftest: process.argv.includes('--planet-selftest'),
  makeTestFile: n => ipcRenderer.invoke('planet:debug-make-file', n),
  removeFile: p => ipcRenderer.invoke('planet:debug-remove', p),

  onCmd: cb => ipcRenderer.on('planet:cmd', (_e, name) => cb(name)),
  onDesktop: cb => ipcRenderer.on('planet:desktop', (_e, d) => cb(d)),
  onDisplay: cb => ipcRenderer.on('planet:display', (_e, d) => cb(d)),
  onScreen: cb => ipcRenderer.on('planet:screen', (_e, s) => cb(s)),
  onResync: cb => ipcRenderer.on('planet:resync', () => cb()),
  // 仅测试环境主进程注册了该通道，生产环境调用会 reject，不影响使用
  testToggle: hidden => ipcRenderer.invoke('planet:test-toggle', hidden),
});
