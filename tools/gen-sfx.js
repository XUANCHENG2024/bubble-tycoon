/* ============================================================
 *  生成小游戏用的音效文件
 *
 *  抖音小游戏里没有 WebAudio，tt.createInnerAudioContext 只认真实音频文件，
 *  所以浏览器版那套「振荡器现算」的音效在真机上会全部静音。
 *  这里离线合成 3 个极短的 WAV（单声道 16bit / 22.05kHz），
 *  体积一共十几 KB，换来的却是点击有回弹 —— 本作核心手感的一半。
 *
 *  用法：node tools/gen-sfx.js
 * ========================================================== */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'minigame', 'audio');

const RATE = 22050;

/** 合成一段波形：osc(t) 返回 [-1,1]，env(t) 返回 0~1 的包络 */
function synth(name, dur, osc, env) {
  const n = Math.round(RATE * dur);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let v = osc(t) * env(t / dur);
    v = Math.max(-1, Math.min(1, v));
    pcm.writeInt16LE(Math.round(v * 32000), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);          /* fmt chunk 长度 */
  head.writeUInt16LE(1, 20);           /* PCM */
  head.writeUInt16LE(1, 22);           /* 单声道 */
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);    /* byte rate */
  head.writeUInt16LE(2, 32);           /* block align */
  head.writeUInt16LE(16, 34);          /* 位深 */
  head.write('data', 36);
  head.writeUInt32LE(pcm.length, 40);
  const buf = Buffer.concat([head, pcm]);
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log(`  ✔ ${name}  ${(buf.length / 1024).toFixed(1)} KB`);
}

/* 指数衰减：模拟短促的「叮」，比线性截断自然得多 */
const decay = k => t => Math.exp(-k * t);

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

/* tap：连点出杯位时的高频短音。每秒可能响好几次，必须又短又闷，
   否则连点会糊成一片噪音。 */
synth('tap.wav', 0.06,
  t => Math.sin(2 * Math.PI * 880 * t) * 0.7 + Math.sin(2 * Math.PI * 1320 * t) * 0.3,
  decay(46));

/* up：升级 / 雇佣 / 开店这类正向反馈，带一点上扬（两个音叠加） */
synth('up.wav', 0.14,
  t => {
    const f = 520 + 260 * Math.min(1, t / 0.09);
    return Math.sin(2 * Math.PI * f * t) * 0.8;
  },
  decay(16));

/* down：客人流失 / 负反馈。低频 + 锯齿感（叠加奇次谐波），
   听感上明显「往下掉」，和 up 区分得开。 */
synth('down.wav', 0.18,
  t => {
    const f = 150;
    return (Math.sin(2 * Math.PI * f * t)
      + Math.sin(2 * Math.PI * f * 2 * t) * 0.5
      + Math.sin(2 * Math.PI * f * 3 * t) * 0.25) * 0.5;
  },
  decay(13));

console.log('  ✔ 音效已生成到 minigame/audio/（共 3 个文件）');
