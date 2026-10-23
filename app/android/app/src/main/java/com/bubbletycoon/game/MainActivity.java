package com.bubbletycoon.game;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        /* ★ 注册自定义插件（Capacitor 7 的注册方式）。
           ★ 必须在 super.onCreate 之后 —— Bridge 还没建好时注册会失败。 */
        registerPlugin(BubbleStorePlugin.class);

        /* ★ 全屏沉浸：游戏不该有状态栏。
           ★ 用 FLAG_FULLSCREEN（不是 setDecorFitsSystemWindows(false)）——
             前者只是隐藏状态栏，WebView 的可视区仍然是「除导航栏外的整屏」，
             布局最省事、最不容易出刘海/手势条遮挡的问题。
           ★ 如果改成 edge-to-edge（内容延伸到状态栏下），
             就要改用 safe-area inset 来避让 —— 本作已经在 platform.js 里
             预留了 insTop/insBottom，但**默认方案更简单可靠**。 */
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN);

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
