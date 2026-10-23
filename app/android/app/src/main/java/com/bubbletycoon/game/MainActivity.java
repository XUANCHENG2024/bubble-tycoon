package com.bubbletycoon.game;

import android.os.Bundle;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        /* ★ 注册自定义插件（Capacitor 7 的注册方式）。
           ★ 必须在 super.onCreate 之后 —— Bridge 还没建好时注册会失败。 */
        registerPlugin(BubbleStorePlugin.class);

        /* ★★★ 全屏沉浸（V20.7）★★★
         *
         * ★★ 为什么不能只靠 FLAG_FULLSCREEN ★★
         *   FLAG_FULLSCREEN 只隐藏**状态栏**，导航栏（手势条/三键）还在。
         *   ★ 而 targetSdk 35 → **Android 15 强制 edge-to-edge**：
         *   系统栏一律**覆盖**在应用内容之上，WebView 拿到的是全屏尺寸。
         *   ★ 结果：导航栏盖住 WebView 底部，
         *   ★ 而平台的 inset 读不到（见 platform.js 的 env() 探针说明），
         *   ★ → 底部「暂停 / 开门营业」按钮**被盖住、点不到**。
         *
         * ★★ 现在的做法（三步，缺一不可）★★
         *   ① setDecorFitsSystemWindows(false)
         *      → 内容延伸到系统栏之下（edge-to-edge）
         *   ② 隐藏系统栏（沉浸式）
         *      → 状态栏与导航栏都不占位也不覆盖
         *   ③ 手指上滑可临时唤出系统栏
         *      → BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
         *      ★ 不给这个的话，系统栏一旦显示就再也不消失。
         *
         * ★ 为什么这样不需要在 JS 里算 inset：
         *   沉浸式下内容铺满全屏，底部本来就没有被遮挡的东西。
         *   ★ 而**万一**系统栏被临时唤出，WebView 会收到 resize，
         *   ★ V20.7 的 resize 处理会重算布局
         *     （此时 env() 探针能读到 inset 并重新避让）。
         */
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);

        /* ★ 保持屏幕常亮：经营游戏常常要盯着屏幕算备货量，
           屏幕一暗就打断思路。
           ★ 只影响本 App，不影响系统其他 App 的电源策略。 */
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    /* ★★ Android 物理返回键（V20.4）
     *
     * ★ Capacitor 7 的 App 插件会监听 backButton 事件；
     *   本作注册了 JS 侧的监听器（platform.js 的 onBack），
     *   **只要 JS 侧注册了就由 JS 决定** ——
     *   所以真正的层级判断（弹窗→引导→子页面→营业中→二次确认退出）
     *   放在 JS 层（那里才有 VIEW 状态）。
     *   ★ 这里不需要额外处理返回键。
     *
     * ★★ 关于 onResume：本来写了一个「回到前台时 pauseTimers/resumeTimers」
     *   的钩子，但**它是自相矛盾的** ——
     *   pauseTimers 紧接着 resumeTimers，等于什么都没做，
     *   而 WebView 在后台本来就会被系统挂起（rAF 自动停）。
     *   ★ 「后台暂停」的正确位置是 JS 侧的 visibilitychange
     *   （引擎要暂停营业计时，见 main.js）。
     *   ★ 而且那个钩子写成了 protected，编译不过
     *     （BridgeActivity.onResume 是 public）——
     *     ★ 教训：**写不出「这个钩子到底做了什么」的代码，
     *       说明它不该存在**。删掉比修好更诚实。
     *
     * ★ onSaveInstanceState 同样不重写：Capacitor 的 BridgeActivity
     *   自己处理 WebView 状态，重写反而可能破坏它的恢复流程。
     */
}
