/**
 * 给 workflow 加「失败时建 Issue」的能力
 *
 * ★ 背景：
 *   排查「本地过 / CI 挂」时，Actions 日志要管理员权限才能下（403），
 *   check-run 的 output 也是空的 —— **看不到失败详情就只能猜**。
 *   ★ Issue 是公开可读的，API 匿名能取。
 *
 * ★ 做法：
 *   每个测试步骤改成 `… | tee /tmp/log.txt`，
 *   再加一个 `if: failure()` 的步骤把日志发成 Issue。
 *   ★ 注意 GitHub Actions 的 `if: failure()` 只在**前一步失败**时触发，
 *     所以要在每个测试步骤后加 —— 用一个复合步骤处理。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

/** quick-check：单步测试 → 每步后加一个失败报告步骤 */
const QUICK = [
  ['tools/minigame-smoke.js', '小游戏冒烟（Canvas 端对等）'],
  ['tools/mobile-smoke.js', '移动端布局'],
  ['tools/browser-smoke.js', '真实 DOM 冒烟（H5）'],
  ['tools/xss-verify.js', 'XSS 注入'],
];

/** 追加到每个测试步骤后的失败报告 */
function reportStep(label) {
  return `
      # ★ 失败时把诊断信息发成 Issue（公开可读，API 匿名能取）
      #   —— Actions 日志要管理员权限才能下，check-run 的 output 也是空的
      #   —— 看不到失败详情就只能猜
      - name: 失败报告（${label}）
        if: failure()
        run: |
          node tools/ci-fail-report.js "${label}" /tmp/ci-test.log
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_SHA: \${{ github.sha }}
`;
}

const p = path.join(root, '.github/workflows/quick-check.yml');
let src = fs.readFileSync(p, 'utf8');

for (const [script, label] of QUICK) {
  const oldStep = `      - name: ${label}
        run: node tools/run-ci-test.js ${script}`;
  if (src.indexOf(oldStep) < 0) { console.log('  ✘ 未匹配步骤：' + label); continue; }
  if (src.indexOf('失败报告（' + label + '）') >= 0) { console.log('  · 已存在：' + label); continue; }

  /* 改成 tee 落盘 —— pipe 会吞掉退出码，所以要 pipefail */
  const newStep = `      - name: ${label}
        run: |
          set -o pipefail
          node tools/run-ci-test.js ${script} 2>&1 | tee /tmp/ci-test.log`;
  src = src.replace(oldStep, newStep);

  /* 在该步骤之后插入失败报告 */
  src = src.replace(newStep, newStep + reportStep(label));
  console.log('  ✔ ' + label);
}

/* ★ 需要 issues: write 权限 */
src = src.replace(
  'permissions:\n  contents: read',
  'permissions:\n  contents: read\n  issues: write   # ★ 失败时建 Issue（诊断信息要公开可读）'
);

fs.writeFileSync(p, src);
console.log('');
console.log('完成');
