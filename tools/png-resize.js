/**
 * 纯 JS 的 PNG 缩放器（V20.4）
 *
 * ★ 为什么自己写：
 *   缩放图标需要图像库（sharp / jimp / pngjs / canvas）——
 *   而本项目**刻意零依赖**（纯静态站点，无 node_modules）。
 *   ★ 为了一次图标缩放引入 sharp（带原生二进制、几十 MB 依赖）不划算。
 *   ★ Node 自带 zlib —— PNG 的 IDAT 解压与回压都是 zlib 格式，
 *     所以纯 JS 实现 PNG 的解码/编码是可行的。
 *
 * ★ 实现范围（够用即可）：
 *   · 支持 8 位 RGB / RGBA（色彩类型 2 / 6）—— 本项目的图标就是这两种
 *   · 支持非隔行扫描（interlace = 0）—— 本项目的图标都是
 *   · 缩放算法：**双线性插值**（比最近邻平滑得多，图标缩小后不会锯齿明显）
 *   · 输出：8 位 RGB（无 alpha）—— iOS 图标要求无透明通道，正好简化
 *
 * ★ 局限（已知且可接受）：
 *   · 不支持调色板（类型 3）与灰度（类型 0）
 *   · 不支持隔行 PNG
 *   · 不支持 16 位深度
 *   遇到这些会明确报错，而不是静默产出坏图。
 */
const zlib = require('zlib');

/** CRC32 表 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * 解码 PNG → { width, height, data: RGBA }
 */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504E47) throw new Error('不是 PNG');
  let off = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];

  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    off += 12 + len;
  }

  if (bitDepth !== 8) throw new Error('只支持 8 位深度（实际 ' + bitDepth + '）');
  if (interlace !== 0) throw new Error('不支持隔行 PNG');
  if (colorType !== 2 && colorType !== 6) {
    throw new Error('只支持 RGB/RGBA（实际色彩类型 ' + colorType + '）');
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));

  /* ★ 反过滤：PNG 每行前面有一个 filter 字节 */
  const bpp = channels;
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let pos = 0;

  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const line = raw.slice(pos, pos + stride);
    pos += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;         /* 左 */
      const b = prev ? prev[x] : 0;                   /* 上 */
      const c = (prev && x >= bpp) ? prev[x - bpp] : 0; /* 左上 */
      let v = line[x];
      switch (ft) {
        case 0: break;
        case 1: v = (v + a) & 0xFF; break;
        case 2: v = (v + b) & 0xFF; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xFF; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          v = (v + pr) & 0xFF;
          break;
        }
        default: throw new Error('未知 filter ' + ft);
      }
      cur[x] = v;
    }
  }

  /* 转成 RGBA */
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    if (channels === 4) {
      rgba[i * 4] = out[i * 4];
      rgba[i * 4 + 1] = out[i * 4 + 1];
      rgba[i * 4 + 2] = out[i * 4 + 2];
      rgba[i * 4 + 3] = out[i * 4 + 3];
    } else {
      rgba[i * 4] = out[i * 3];
      rgba[i * 4 + 1] = out[i * 3 + 1];
      rgba[i * 4 + 2] = out[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
  }
  return { width: w, height: h, data: rgba };
}

/**
 * 编码 RGBA → PNG（8 位 RGB，无 alpha）
 */
function encodePNG(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;   /* filter = None */
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      /* bit depth */
  ihdr[9] = 2;      /* color type = RGB（无 alpha）*/
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 双线性缩放
 * @param {object} img decodePNG 的结果
 * @param {number} tw 目标宽
 * @param {number} th 目标高
 * @param {boolean} dropAlpha true 时把 alpha 压到不透明（iOS 图标要求）
 */
function resize(img, tw, th, dropAlpha) {
  const { width: sw, height: sh, data: src } = img;
  const dst = Buffer.alloc(tw * th * 3);

  /* ★ 双线性：采样时取 4 个邻点加权。
     ★ 比最近邻平滑得多 —— 图标从 1024 缩到 48 时，
       最近邻会明显锯齿（那正是「图标很丑」的来源）。 */
  const ratio = sw / tw;
  const xRatio = sw / tw, yRatio = sh / th;

  for (let y = 0; y < th; y++) {
    const sy = Math.min(sh - 1, (y + 0.5) * yRatio);
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = sy - y0;

    for (let x = 0; x < tw; x++) {
      const sx = Math.min(sw - 1, (x + 0.5) * xRatio);
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = sx - x0;

      const i00 = (y0 * sw + x0) * 4, i01 = (y0 * sw + x1) * 4;
      const i10 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const o = (y * tw + x) * 3;

      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] * (1 - wx) + src[i01 + c] * wx;
        const bot = src[i10 + c] * (1 - wx) + src[i11 + c] * wx;
        dst[o + c] = Math.round(top * (1 - wy) + bot * wy);
      }
      /* alpha：iOS 图标要求不透明 */
      if (dropAlpha) { /* RGB 输出本身就没有 alpha 通道 */ }
    }
  }
  return dst;
}

/** 一步到位：PNG 文件 → 缩放后的 PNG Buffer */
function resizePNGFile(srcPath, tw, th) {
  const fs = require('fs');
  const img = decodePNG(fs.readFileSync(srcPath));
  const rgb = resize(img, tw, th, true);
  return encodePNG(tw, th, rgb);
}

module.exports = { decodePNG, encodePNG, resize, resizePNGFile };