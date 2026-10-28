/* ============================================================
 *  生成小游戏用的音效文件
 *
 *  抖音小游戏里没有 WebAudio，tt.createInnerAudioContext 只认真实音频文件，
 *  所以浏览器版那套「振荡器现算」的音效在真机上会全部静音。
 *  这里离线合成 5 个极短的 WAV（单声道 16bit / 22.05kHz），
 *  体积一共五十几 KB，换来的却是点击有回弹 —— 本作核心手感的一半。
 *  （V21 由 3 个扩到 5 个：补 up2 / ach，理由见文件末尾的长注释）
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

/** 合成一段由多个音组成的序列（琶音/和弦）——
 *  比单个正弦好听得多，也更接近 H5 端 WebAudio 那套「三音上行」的听感。
 *  notes: [{ f, at, dur, vol, type }]（at/dur 单位秒） */
function synthSeq(name, total, notes) {
  const n = Math.round(RATE * total);
  const buf = new Float64Array(n);
  for (const nt of notes) {
    const s0 = Math.round(nt.at * RATE);
    const len = Math.round(nt.dur * RATE);
    for (let i = 0; i < len; i++) {
      const t = i / RATE;
      const idx = s0 + i;
      if (idx >= n) break;
      /* 每个音自己的包络：12ms 起音（避免爆音）+ 指数衰减 */
      const env = Math.exp(-6 * (t / nt.dur)) * Math.min(1, t / 0.012);
      let v;
      if (nt.type === 'square') {
        v = Math.sign(Math.sin(2 * Math.PI * nt.f * t));
      } else if (nt.type === 'saw') {
        v = 2 * ((nt.f * t) % 1) - 1;
      } else {
        v = Math.sin(2 * Math.PI * nt.f * t);
      }
      buf[idx] += v * env * (nt.vol == null ? 0.5 : nt.vol);
    }
  }
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 30000), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(pcm.length, 40);
  const out = Buffer.concat([head, pcm]);
  fs.writeFileSync(path.join(outDir, name), out);
  console.log(`  ✔ ${name}  ${(out.length / 1024).toFixed(1)} KB  ${total.toFixed(2)}s`);
}

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

/* ============================================================
 *  V21 扩充：3 个 → 6 个
 *
 *  ★ 为什么必须扩：小游戏端原来只有 tap/up/down 三个文件，
 *    而 platform.play() 只能"按频率硬分流"（>=850 播 tap、<300 播 down、其余播 up）。
 *    代码里实际有 48 处 beep(...) 调用、其中大量是 880/980/1175/1405Hz 的
 *    **达成类**反馈 —— 落进 >=850 这一档后**全部变成 tap（点击声）**。
 *    也就是说：玩家达成中期目标、拿到成就、老板亲自上阵，
 *    听到的都是"点了一下按钮"的声音，和随手点个 Tab 一模一样。
 *    H5 端有 12 种语义音效，小游戏端 3 个 —— 两版听觉体验严重不对等。
 *
 *  ★ 只补两个文件就够，不要为每个事件做一个（体积与收益不成正比）：
 *      up2 —— 中高强度正向（升级/开店/招人）  三音上行
 *      ach —— 最高强度（成就/里程碑/老板上阵） 四音上行 + 收尾高音
 *    tap / up / down 保持原样（手感已经调过，不动）。
 *    分流规则改成「语义优先、频率次之」—— 见 platform.js。
 *
 *  ★ 体积：两个文件合计约 39KB（22.05kHz 单声道 16bit）。
 *    整个音频目录 17KB → 56KB；bundle 795KB、音频原本只占 2%，
 *    这点增量换"成就听起来像成就"，非常划算。
 * ============================================================ */

/* up2：升级 / 开店 / 招人 / 升主店 —— 三音上行（C5-E5-G5） */
synthSeq('up2.wav', 0.34, [
  { f: 523.25, at: 0.00, dur: 0.14, vol: 0.34, type: 'sine' },
  { f: 659.25, at: 0.07, dur: 0.14, vol: 0.32, type: 'sine' },
  { f: 783.99, at: 0.14, dur: 0.18, vol: 0.36, type: 'sine' },
]);

/* ach：成就 / 中期目标 / 老板上阵 —— 四音上行（E5-A5-C6-E6），
   最后一个音拖长，给"落地感"。刻意比 up2 高一个八度档，
   不看画面也能听出"这次比升级更值钱"。 */
synthSeq('ach.wav', 0.78, [
  { f: 659.25, at: 0.00, dur: 0.20, vol: 0.30, type: 'sine' },
  { f: 880.00, at: 0.10, dur: 0.20, vol: 0.30, type: 'sine' },
  { f: 1046.50, at: 0.20, dur: 0.22, vol: 0.30, type: 'sine' },
  { f: 1318.51, at: 0.30, dur: 0.46, vol: 0.34, type: 'sine' },
  { f: 2637.02, at: 0.30, dur: 0.30, vol: 0.08, type: 'sine' },  /* 泛音，避免高音单薄 */
]);

console.log('  ✔ 音效已生成到 minigame/audio/（共 5 个文件）');
