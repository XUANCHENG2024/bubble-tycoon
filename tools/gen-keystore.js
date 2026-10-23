/**
 * 生成 Android 上架签名密钥（V20.5）
 *
 * ★ 为什么要有这个脚本：
 *   上架需要「upload keystore」——
 *   ★ **一旦上传到 Google Play，这个密钥就永久绑定你的应用了**，
 *     丢了就再也不能更新这个应用（除非申请重置，Google 会人工审核）。
 *   ★ 所以生成过程必须：
 *     ① 用**足够长的有效期**（Google 建议 25 年以上）
 *     ② 明确告知「这个文件要备份到哪」
 *     ③ 口令不要硬编码在仓库里（由使用者自己填）
 *
 * ★ Google Play 的双重密钥体系：
 *   · upload keystore —— 本脚本生成的。用来**上传**包。
 *     ★ 丢了 → 不能上传新版本（但已上架的 App 不受影响）
 *   · app signing key —— Play 自己生成并保管，用来**分发**
 *     ★ 所以真正需要你备份的只有 upload keystore 一个。
 *
 * 用法：node tools/gen-keystore.js [输出目录]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const outDir = process.argv[2] || path.join(root, 'app', 'android');
const jksPath = path.join(outDir, 'bubbletycoon-upload.jks');
const propsPath = path.join(outDir, 'keystore.properties');

const ALIAS = 'bubbletycoon';
/* ★ 有效期 30 年 —— Google 建议 25 年以上，
   因为这个密钥一旦绑定就不能随意换（换了就得重新提交应用）。*/
const DAYS = 10950;

/* ---------- 找 keytool ---------- */
function findKeytool() {
  const javaHome = process.env.JAVA_HOME;
  const cands = [];
  if (javaHome) cands.push(path.join(javaHome, 'bin', 'keytool.exe'));
  /* 工具目录里的 JDK */
  const tools = 'D:/tools/android-build';
  if (fs.existsSync(tools)) {
    for (const d of fs.readdirSync(tools)) {
      if (/^jdk/i.test(d)) cands.push(path.join(tools, d, 'bin', 'keytool.exe'));
    }
  }
  cands.push('keytool');
  for (const c of cands) {
    try {
      execFileSync(c, ['-help'], { stdio: 'ignore' });
      return c;
    } catch (e) {
      /* keytool -help 会返回非 0，所以要用别的方式判断 */
      if (c === 'keytool') return c;
    }
  }
  return null;
}

if (fs.existsSync(jksPath)) {
  console.error('✘ 密钥已存在：' + jksPath);
  console.error('  ★ **不要覆盖** —— 已上传到 Play 的应用换了密钥就无法更新。');
  console.error('  如果确实要重新生成，请先手动改名备份旧密钥。');
  process.exit(1);
}

const keytool = findKeytool();
if (!keytool) {
  console.error('✘ 找不到 keytool（需要 JDK）');
  console.error('  设置 JAVA_HOME，或用 node tools/build-android.js --check 看环境');
  process.exit(1);
}

/* ★ 口令：交互式输入（不回显），或从环境变量读。
   ★ 绝不能硬编码在脚本里 —— 那样就等于公开了。 */
const storePass = process.env.KEYSTORE_PASS || '';
if (!storePass) {
  console.error('');
  console.error('请设置环境变量 KEYSTORE_PASS 后重跑：');
  console.error('  Windows:  set KEYSTORE_PASS=你的口令');
  console.error('  macOS  :  KEYSTORE_PASS=你的口令 node tools/gen-keystore.js');
  console.error('');
  console.error('★ 口令强度要求（Google 不强制，但建议）：至少 6 位，别用生日。');
  console.error('★ 口令只存在于你的机器上，不会进版本库。');
  process.exit(1);
}
if (storePass.length < 6) {
  console.error('✘ 口令太短（至少 6 位）');
  process.exit(1);
}

console.log('生成上架签名密钥…');
console.log('  输出: ' + jksPath);
console.log('  别名: ' + ALIAS);
console.log('  有效期: ' + DAYS + ' 天（约 30 年）');

try {
  execFileSync(keytool, [
    '-genkeypair',
    '-alias', ALIAS,
    '-keyalg', 'RSA',
    '-keysize', '4096',          /* ★ Google 建议 2048 以上，4096 更稳 */
    '-validity', String(DAYS),
    '-keystore', jksPath,
    '-storepass', storePass,
    '-keypass', storePass,
    '-storetype', 'PKCS12',      /* ★ PKCS12 是现在的标准格式 */
    '-dname', 'CN=Bubble Tycoon, OU=Game, O=Bubble Tycoon, L=Shenzhen, ST=Guangdong, C=CN',
  ], { stdio: 'inherit' });
} catch (e) {
  console.error('✘ 密钥生成失败');
  process.exit(1);
}

/* ---------- 写 keystore.properties ---------- */
fs.writeFileSync(propsPath,
  '# ★ 上架签名配置（由 tools/gen-keystore.js 生成）\n'
  + '# ★ 本文件已在 .gitignore 里 —— 里面的口令绝不能进版本库\n'
  + 'storeFile=' + jksPath.replace(/\\/g, '\\\\') + '\n'
  + 'storePassword=' + storePass + '\n'
  + 'keyAlias=' + ALIAS + '\n'
  + 'keyPassword=' + storePass + '\n');

console.log('');
console.log('✔ 完成');
console.log('  密钥: ' + jksPath);
console.log('  配置: ' + propsPath);
console.log('');
console.log('★★ 请立刻备份这两个文件 ★★');
console.log('  ★ upload keystore 一旦上传到 Google Play 就与你的应用绑定了，');
console.log('    丢了 → 永远无法上传新版本（除非申请 Google 人工重置）。');
console.log('  ★ 存到密码管理器 + 云盘各一份，不要只放这台电脑上。');
console.log('');
console.log('★ 下一步构建上架包：');
console.log('  node tools/build-android.js --release');
