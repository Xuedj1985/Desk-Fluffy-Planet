// gen-planet-icon.mjs —— 生成糖绒星球自己的托盘图标与应用图标（原创图形，无第三方素材）
// 运行：node tools/gen-planet-icon.mjs
// 产出：planet/assets/tray.png（32×32）、planet/assets/planet.ico（256×256，PNG 压缩的 ICO）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'planet', 'assets');
fs.mkdirSync(OUT_DIR, { recursive: true });

const CRC = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return buf => {
    let c = 0xffffffff;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, sum]);
}

function pngRGBA(w, h, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    pixels.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 5 角星多边形
function starPath(cx, cy, R, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const d = i % 2 === 0 ? R : r;
    pts.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d]);
  }
  return pts;
}
function inPoly(x, y, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}

/** 4×4 超采样，画一个圆形徽章 + 描边 + 白色小星星 */
function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4;
  const c = size / 2;
  const ring = size * 0.455;
  const inner = size * 0.395;
  const star = starPath(c, c * 0.985, size * 0.235, size * 0.105);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const d = Math.hypot(px - c, py - c);
          let col = [0, 0, 0, 0];
          if (d <= ring) {
            // 描边深棕，内部粉＋奶油高光
            if (d > inner) col = [122, 85, 82, 255];
            else if (d > inner - size * 0.05) col = [255, 226, 238, 255];
            else col = [242, 135, 176, 255];
            if (inPoly(px, py, star)) col = [255, 250, 238, 255];
          }
          r += col[0]; g += col[1]; b += col[2]; a += col[3];
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      buf[i] = Math.round(r / n);
      buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(b / n);
      buf[i + 3] = Math.round(a / n);
    }
  }
  return pngRGBA(size, size, buf);
}

const tray = render(32);
fs.writeFileSync(path.join(OUT_DIR, 'tray.png'), tray);

const big = render(256);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);   // reserved
header.writeUInt16LE(1, 2);   // type: icon
header.writeUInt16LE(1, 4);   // count
const entry = Buffer.alloc(16);
entry[0] = 0;                 // 0 = 256
entry[1] = 0;
entry[2] = 0;
entry[3] = 0;
entry.writeUInt16LE(1, 4);    // planes
entry.writeUInt16LE(32, 6);   // bit count
entry.writeUInt32LE(big.length, 8);
entry.writeUInt32LE(22, 12);
fs.writeFileSync(path.join(OUT_DIR, 'planet.ico'), Buffer.concat([header, entry, big]));

console.log('[icon] tray.png ' + tray.length + 'B · planet.ico ' + (22 + big.length) + 'B');
