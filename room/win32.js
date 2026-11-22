// win32.js —— 窗口层级操作的极薄封装（只做 spike 需要的六个调用）
// 优先用 koffi 直接调 user32；koffi 不可用时降级为常驻 PowerShell 进程。
const { execFile } = require('child_process');

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_NOZORDER = 0x0004;
const HWND_BOTTOM = 1;
const GW_HWNDNEXT = 2;   // z 序下一层（更靠后）
const GW_HWNDPREV = 3;   // z 序上一层（更靠前）

let impl = null;

function pad(n) { return n >>> 0; }

function initKoffi() {
  const koffi = require('koffi');
  const u = koffi.load('user32.dll');
  const f = {
    SetWindowPos: u.func('bool __stdcall SetWindowPos(uintptr_t h, intptr_t after, int x, int y, int cx, int cy, unsigned int flags)'),
    SetParent: u.func('uintptr_t __stdcall SetParent(uintptr_t child, uintptr_t parent)'),
    FindWindowW: u.func('uintptr_t __stdcall FindWindowW(const char16_t *cls, const char16_t *title)'),
    GetForegroundWindow: u.func('uintptr_t __stdcall GetForegroundWindow()'),
    IsWindowVisible: u.func('bool __stdcall IsWindowVisible(uintptr_t h)'),
    GetWindow: u.func('uintptr_t __stdcall GetWindow(uintptr_t h, unsigned int cmd)'),
    IsWindow: u.func('bool __stdcall IsWindow(uintptr_t h)'),
    ShowWindow: u.func('bool __stdcall ShowWindow(uintptr_t h, int cmd)'),
    GetClassNameW: u.func('int __stdcall GetClassNameW(uintptr_t h, void *buf, int n)'),
    GetWindowTextW: u.func('int __stdcall GetWindowTextW(uintptr_t h, void *buf, int n)'),
    EnumWindows: u.func('bool __stdcall EnumWindows(void *cb, intptr_t l)'),
    keybd_event: u.func('void __stdcall keybd_event(unsigned char bVk, unsigned char bScan, unsigned int dwFlags, uintptr_t dwExtraInfo)'),
  };

  const text = (fn, h, bytes) => {
    const buf = Buffer.alloc(bytes);
    const n = fn(h, buf, bytes / 2);
    return n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
  };

  return {
    zOrder() {
      const list = [];
      const EnumWindowsProc = koffi.proto('bool EnumWindowsProc(uintptr_t h, intptr_t l)');
      const EnumWindows = u.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t l)');
      EnumWindows((h) => {
        list.push({
          hwnd: h,
          cls: text(f.GetClassNameW, h, 512),
          title: text(f.GetWindowTextW, h, 512),
          visible: !!f.IsWindowVisible(h),
        });
        return true;
      }, 0);
      return list;
    },
    className: (h) => text(f.GetClassNameW, h, 512),
    // 合成 Win+D / Win+D 还原；只用于 spike 自测，正式版不注入任何按键
    tapWinD() {
      const KEYUP = 0x0002;
      const LWIN = 0x5B, D = 0x44;
      f.keybd_event(LWIN, 0, 0, 0);
      f.keybd_event(D, 0, 0, 0);
      f.keybd_event(D, 0, KEYUP, 0);
      f.keybd_event(LWIN, 0, KEYUP, 0);
    },
    name: 'koffi',
    SetWindowPos: (h, after, x, y, cx, cy, flags) => !!f.SetWindowPos(h, after, x, y, cx, cy, flags),
    SetParent: (c, p) => Number(f.SetParent(c, p)),
    FindWindow: (cls) => Number(f.FindWindowW(cls, null)),
    Foreground: () => Number(f.GetForegroundWindow()),
    Visible: (h) => !!f.IsWindowVisible(h),
    Next: (h, cmd) => Number(f.GetWindow(h, cmd)),
    IsWindow: (h) => !!f.IsWindow(h),
    Show: (h, cmd) => !!f.ShowWindow(h, cmd),
  };
}

// 降级：一个常驻 PowerShell，按行收发。每次调用约 20-60ms，够 spike 用。
function initPowerShell() {
  const { spawn } = require('child_process');
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  let seq = 0;
  const waiters = new Map();
  ps.stdout.on('data', d => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      const m = /^#(\d+)\s(.*)$/.exec(line);
      if (m && waiters.has(Number(m[1]))) {
        const w = waiters.get(Number(m[1]));
        waiters.delete(Number(m[1]));
        w(m[2]);
      }
    }
  });
  const preamble = `
$ErrorActionPreference='Stop'
Add-Type -Namespace L -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
[DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr c, IntPtr p);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string win);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
'@
`;
  ps.stdin.write(preamble + '\n');
  const call = (code, expr) => new Promise(resolve => {
    const id = ++seq;
    waiters.set(id, resolve);
    ps.stdin.write(`$r = try { ${expr} } catch { 'ERR ' + $_.Exception.Message }; "#${id} $r"\n`);
  });
  return {
    name: 'powershell',
    SetWindowPos: (h, after, x, y, cx, cy, flags) => call('swp', `[L.U]::SetWindowPos([IntPtr]${h}, [IntPtr]${after}, ${x}, ${y}, ${cx}, ${cy}, ${flags})`),
    SetParent: (c, p) => call('sp', `[L.U]::SetParent([IntPtr]${c}, [IntPtr]${p}).ToInt64()`),
    FindWindow: (cls) => call('fw', `[L.U]::FindWindow('${cls}', $null).ToInt64()`).then(Number),
    Foreground: () => call('fg', `[L.U]::GetForegroundWindow().ToInt64()`).then(Number),
    Visible: (h) => call('vis', `[L.U]::IsWindowVisible([IntPtr]${h})`).then(v => String(v).trim() === 'True'),
    Next: (h, cmd) => call('gw', `[L.U]::GetWindow([IntPtr]${h}, ${cmd}).ToInt64()`).then(Number),
    IsWindow: (h) => call('iw', `[L.U]::IsWindow([IntPtr]${h})`).then(v => String(v).trim() === 'True'),
    Show: async () => true,
    zOrder: () => [],
    className: () => '',
    tapWinD: () => {},
  };
}

function get() {
  if (impl) return impl;
  try {
    impl = initKoffi();
  } catch (e) {
    console.warn('[win32] koffi 不可用，降级 PowerShell：' + e.message);
    impl = initPowerShell();
  }
  return impl;
}

function hwndOf(browserWindow) {
  const b = browserWindow.getNativeWindowHandle();
  return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
}

/** 把窗口钉在桌面层：直接插到 Progman 之上，位于所有应用窗口之下 */
function pinAboveDesktop(hwnd) {
  const w = get();
  const progman = w.FindWindow('Progman');
  if (!progman) return { ok: false, why: '找不到 Progman' };
  const ok = w.SetWindowPos(hwnd, progman, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
  return { ok: !!ok, progman };
}

function pinBottom(hwnd) {
  const w = get();
  const ok = w.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
  return { ok: !!ok };
}

function attachToDesktop(hwnd) {
  const w = get();
  const progman = w.FindWindow('Progman');
  if (!progman) return { ok: false, why: '找不到 Progman' };
  const prev = w.SetParent(hwnd, progman);
  return { ok: true, progman, prev };
}

function probe(hwnd) {
  const w = get();
  const progman = w.FindWindow('Progman');
  const above = w.Next(hwnd, GW_HWNDPREV);
  const below = w.Next(hwnd, GW_HWNDNEXT);
  return {
    hwnd,
    progman,
    exists: w.IsWindow(hwnd),
    visible: w.Visible(hwnd),
    above,
    below,
    aboveCls: w.className ? w.className(above) : '',
    belowCls: w.className ? w.className(below) : '',
    foreground: w.Foreground(),
  };
}

module.exports = { get, hwndOf, pinAboveDesktop, pinBottom, attachToDesktop, probe, HWND_BOTTOM };
