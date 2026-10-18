"""修复 icon 右下角的水印/补丁痕迹。

背景是低频的平滑渐变（深紫 → 近黑，叠加杯身外溢的一点青色辉光），
所以不要「搬一块过来补」（会带入重影），而是：
  1. 取补丁区左侧与上侧的干净边带做样本
  2. 剔除星星这类高亮离群点
  3. 拟合一个二次曲面 a0 + a1x + a2y + a3x² + a4xy + a5y²
  4. 用曲面在补丁区内求值，再羽化贴回

二次曲面足以表达「径向辉光 + 线性衰减」，而且完全连续，不会出现硬边。
"""

from PIL import Image, ImageDraw, ImageFilter
import sys

HOLE = (756, 856, 1024, 1024)      # 需要重建的区域
LEFT_BAND = (692, 856, 756, 1024)  # 左侧干净样本
TOP_BAND = (756, 776, 1024, 856)   # 上方干净样本
FEATHER = 12


def lum(p):
    return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]


def collect(im, box, samples):
    x0, y0, x1, y1 = box
    px = im.load()
    for y in range(y0, y1):
        for x in range(x0, x1):
            samples.append((x, y, px[x, y]))


def solve6(A, b):
    """6x6 高斯消元（带部分主元）"""
    n = 6
    for i in range(n):
        p = max(range(i, n), key=lambda r: abs(A[r][i]))
        if abs(A[p][i]) < 1e-9:
            return None
        A[i], A[p] = A[p], A[i]
        b[i], b[p] = b[p], b[i]
        for r in range(i + 1, n):
            f = A[r][i] / A[i][i]
            for c in range(i, n):
                A[r][c] -= f * A[i][c]
            b[r] -= f * b[i]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        s = b[i] - sum(A[i][c] * x[c] for c in range(i + 1, n))
        x[i] = s / A[i][i]
    return x


def basis(x, y):
    return [1.0, x, y, x * x, x * y, y * y]


def fit(samples, ch):
    A = [[0.0] * 6 for _ in range(6)]
    b = [0.0] * 6
    for x, y, p in samples:
        f = basis(x, y)
        v = p[ch]
        for i in range(6):
            for j in range(6):
                A[i][j] += f[i] * f[j]
            b[i] += f[i] * v
    return solve6(A, b)


def main():
    im = Image.open('icon-1024.png').convert('RGB')
    if im.size != (1024, 1024):
        print('尺寸异常：', im.size)
        sys.exit(1)

    samples = []
    collect(im, LEFT_BAND, samples)
    collect(im, TOP_BAND, samples)

    # 剔除星星/光点这类高亮离群点，否则曲面会被它们拉歪
    ls = sorted(lum(p) for _, _, p in samples)
    median = ls[len(ls) // 2]
    cut = median + 30
    kept = [s for s in samples if lum(s[2]) <= cut]
    print(f'样本 {len(samples)} → 剔除高亮后 {len(kept)}（中位亮度 {median:.1f}，阈值 {cut:.1f}）')

    coef = [fit(kept, ch) for ch in range(3)]
    if any(c is None for c in coef):
        print('拟合失败')
        sys.exit(1)

    x0, y0, x1, y1 = HOLE
    w, h = x1 - x0, y1 - y0
    patch = Image.new('RGB', (w, h))
    pp = patch.load()
    for y in range(y0, y1):
        for x in range(x0, x1):
            fb = basis(x, y)
            pp[x - x0, y - y0] = tuple(
                max(0, min(255, int(round(sum(coef[ch][i] * fb[i] for i in range(6))))))
                for ch in range(3)
            )

    # 羽化：只在补丁外缘过渡，内部整块替换
    mask = Image.new('L', (w, h), 255)
    d = ImageDraw.Draw(mask)
    for i in range(FEATHER):
        d.rectangle([i, i, w - i - 1, h - i - 1], outline=int(255 * i / FEATHER))
    mask = mask.filter(ImageFilter.GaussianBlur(3))

    im.paste(patch, (x0, y0), mask)
    im.save('icon-1024.png', 'PNG', optimize=True)
    im.resize((512, 512), Image.LANCZOS).save('icon-512.png', 'PNG', optimize=True)
    im.resize((192, 192), Image.LANCZOS).save('icon-192.png', 'PNG', optimize=True)
    im.crop((640, 760, 1024, 1024)).resize((768, 528), Image.LANCZOS).save('_check_corner.png')
    print('重建完成')


main()
