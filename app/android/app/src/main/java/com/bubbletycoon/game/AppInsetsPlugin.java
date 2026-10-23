package com.bubbletycoon.game;

import android.os.Build;
import android.view.View;
import android.view.WindowInsets;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 系统栏 / 刘海 安全区查询插件（AppInsets）
 *
 * ★★★ 为什么必须有它（V20.8 的核心修复）★★★
 *
 * ★ 问题：CSS 的 env(safe-area-inset-top) 在 Android WebView 上**不可靠**。
 *   背景：
 *   · CSS `env(safe-area-inset-*)` 是 Apple 在 iOS Safari 上定义并实现的。
 *   · Android WebView（Chromium）**直到 Chromium 140 才补上**这个支持，
 *     而更早的版本在 **edge-to-edge 模式**下会返回 0 或者错误的值。
 *   · Android 15（API 35）起**强制 edge-to-edge** —— 全局强制，厂商无法豁免。
 *   · 而本项目 targetSdk = 35，且 MainActivity 里显式
 *     `WindowCompat.setDecorFitsSystemWindows(getWindow(), false)`
 *     —— 也就是说**我们正处于 env() 最容易失效的那个组合**。
 *
 * ★ 后果：V20.7 用「隐藏探针元素读 computed padding」拿安全区，
 *   在 iOS 与桌面浏览器上正确，但在**大部分 Android 设备上会静默返回 0**。
 *   ★ 静默是最糟的失败模式 —— 不报错、不告警，只是底部按钮被 Home 指示条盖住，
 *     玩家点了没反应，而开发者（我）以为已经修好了。
 *
 * ★ 正确解法：**直接向系统问**。
 *   Android 的 `WindowInsetsCompat` 就是系统的权威答案：
 *   · `Type.systemBars()` → 状态栏 + 导航栏（手势条/三键）
 *   · `Type.displayCutout()` → 刘海 / 挖孔 / 圆角
 *   拿到像素值后除以 density 换成 CSS px（WebView 里的坐标单位就是 CSS px）。
 *
 * ★ 为什么不用 @capacitor/status-bar：
 *   它只暴露 `getInfo()` 里的 `statusBarHeight`（**只有顶部**），
 *   没有底部导航栏、没有刘海 —— 而底部才是本项目真正被遮挡的地方。
 *   那个插件也不能给出旋转后的实时值。
 *
 * ★ 为什么不用 @capacitor-community/safe-area：
 *   ① 它是第三方依赖，Capacitor 7 版需要额外 npm 安装 + cap sync；
 *   ② 它的核心作用是给**旧版 WebView 打补丁**（把 inset 转成 padding 打在 WebView 上），
 *      那会让 WebView 整体内缩 —— 与我们「Canvas 自己避让」的设计冲突：
 *      Canvas 版不需要 WebView 内缩，需要的是**拿到数值**；
 *   ③ 它和 @capacitor/status-bar 存在互斥关系（官方明确要求二选一），
 *      而 status-bar 已经在用。
 *   ★ 自己写一个 80 行的插件，只取我们需要的 4 个数，依赖为零，行为完全可控。
 *
 * ★ 返回值的单位：CSS px（= Android px / density）。
 *   WebView 里 `window.innerWidth` 就是 CSS px，所以两边单位一致，
 *   JS 侧拿原生 inset 直接参与布局计算，不用再换算。
 */
@CapacitorPlugin(name = "AppInsets")
public class AppInsetsPlugin extends Plugin {

    /**
     * ★★ 插件加载时立刻挂上 inset 监听，并把当前值**推**给 JS ★★
     *
     * ★ 为什么是「推」而不是让 JS 来「拉」：
     *   JS 侧的 PLAT.info() 是**同步**函数（布局计算要立刻拿到尺寸与 inset），
     *   而 Capacitor 的插件调用**永远是异步的**（Promise）。
     *   ★ 如果只靠 JS 主动调 get()，那么首帧布局算出来的 inset 必然是 0，
     *   ★ 要等 Promise 回来后再重排 —— 视觉上会看到「跳一下」。
     *
     * ★ 推的做法：原生在 inset 变化时（含旋转、折叠屏展开、系统栏显隐）
     *   直接 evaluateJavascript 写入 window.__APP_INSETS。
     *   JS 的 info() 直接读这个全局 —— **同步、即时、无跳变**。
     *
     * ★ 为什么要用 decorateView（而不是 WebView）：
     *   WebView 自己被 Capacitor 加了 OnApplyWindowInsetsListener
     *   （CapacitorWebView.edgeToEdgeHandler），我们不要去抢它。
     *   decorView 是窗口的根，inset 一样能拿到，且不冲突。
     */
    @Override
    public void load() {
        super.load();
        try {
            final android.view.View decor = getActivity().getWindow().getDecorView();
            ViewCompat.setOnApplyWindowInsetsListener(decor, (v, windowInsets) -> {
                pushInsets(windowInsets);
                /* ★ 返回原样（不 CONSUMED）——
                 *   让事件继续往下传，Capacitor 自己的处理不受我们影响。 */
                return windowInsets;
            });
            /* 首次的值：主动请求一次系统派发 */
            decor.post(() -> {
                try {
                    WindowInsetsCompat wi = ViewCompat.getRootWindowInsets(decor);
                    if (wi != null) pushInsets(wi);
                } catch (Exception e) { /* 忽略 */ }
            });
        } catch (Exception e) { /* 拿不到就靠 get() 兜底 */ }
    }

    /** 把 inset 换算成 CSS px 后推给 JS */
    private void pushInsets(WindowInsetsCompat insets) {
        try {
            int[] v = compute(insets);
            String js = "window.__APP_INSETS={top:" + v[0]
                + ",bottom:" + v[1]
                + ",left:" + v[2]
                + ",right:" + v[3]
                + ",ok:true};";
            /* evaluateJavascript 必须在 UI 线程 */
            getActivity().runOnUiThread(() -> {
                try {
                    getBridge().getWebView().evaluateJavascript(js, null);
                } catch (Exception e) { /* 忽略 */ }
            });
        } catch (Exception e) { /* 忽略 */ }
    }

    /**
     * Android px 的 inset → CSS px。
     *
     * ★ 返回 int[] 而非 JSObject —— 因为 JSObject 继承 org.json，
     *   它的 getInt(String) **只有单参版本**（双参的是 optInt），
     *   写成 getInt("top", 0) 编译不过。
     *   ★ 顺序固定为 [top, bottom, left, right]。
     */
    private int[] compute(WindowInsetsCompat insets) {
        float density = getActivity().getResources().getDisplayMetrics().density;
        if (density <= 0f) density = 1f;
        /* ★ Insets 在 androidx.core.graphics 里（不是 WindowInsetsCompat.Insets）*/
        Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
        Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
        /* ★ 取 max：系统栏隐藏时 bars=0 但 cutout≠0（刘海）；反之亦然。 */
        return new int[] {
            Math.round(Math.max(bars.top, cutout.top) / density),
            Math.round(Math.max(bars.bottom, cutout.bottom) / density),
            Math.round(Math.max(bars.left, cutout.left) / density),
            Math.round(Math.max(bars.right, cutout.right) / density),
        };
    }

    /**
     * 取当前的安全区。
     *
     * ★ 返回：{ top, bottom, left, right }，单位 CSS px。
     *   —— top 含**刘海/挖孔**（displayCutout），
     *      因为刘海是**物理遮挡**，即使状态栏隐藏了，挖孔依然在那儿。
     *   —— bottom 含导航栏/手势条。
     *
     * ★ 为什么用 displayCutout 而不只用 systemBars：
     *   本作是沉浸式（隐藏系统栏）。隐藏后 systemBars() 的 bottom 常常是 0，
     *   但**挖孔仍然会遮住顶部**（横屏时挖孔在侧边 → left/right）。
     *   两类都要算，才是对的。
     */
    @PluginMethod
    public void get(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            View decor = getActivity().getWindow().getDecorView();
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decor);
            if (insets == null) {
                ret.put("top", 0);
                ret.put("bottom", 0);
                ret.put("left", 0);
                ret.put("right", 0);
                ret.put("ok", false);
            } else {
                int[] v = compute(insets);
                ret.put("top", v[0]);
                ret.put("bottom", v[1]);
                ret.put("left", v[2]);
                ret.put("right", v[3]);
                ret.put("ok", true);
            }
        } catch (Exception e) {
            /* 读不到就返回 0，JS 侧会退回 env() 探针 */
            ret.put("top", 0);
            ret.put("bottom", 0);
            ret.put("left", 0);
            ret.put("right", 0);
            ret.put("ok", false);
        }
        call.resolve(ret);
    }
}
