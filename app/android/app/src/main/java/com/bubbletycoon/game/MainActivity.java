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
     * ★ Capacitor 的 App 插件会监听 backButton 事件并默认「退出 App」，
     *   但本作的返回键应该先关弹窗 / 回主页，**不该立刻退出**。
     * ★ Capacitor 7 的 App 插件默认行为是「没有 App 插件处理时按返回键退出」，
     *   而我们注册了 backButton 监听器后，**只要 JS 侧注册了就由 JS 决定**。
     *   —— 所以真正的层级判断放在 JS 侧（platform.js 的 onBack + main.js 的分层逻辑），
     *   这里只需要保证「App 不在后台时被杀掉也能恢复」。
     *
     * ★ onSaveInstanceState 不重写：Capacitor 的 BridgeActivity 自己处理 WebView 状态，
     *   重写反而可能破坏它的恢复流程。
     */
    @Override
    protected void onResume() {
        super.onResume();
        /* ★ 回到前台时不要让游戏继续跑 —— 玩家可能在应用商店里，
           回来发现游戏已经结束（时间流逝被算进营业）会很莫名。
           ★ 引擎侧有 phase 状态机，但「后台暂停」必须在原生层做，
           因为 WebView 被挂起时 JS 的定时器不可靠。 */
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().pauseTimers();
            /* ★ 紧接着 pauseTimers 会冻结 rAF 计时，
               所以紧接着要 resume —— 真正要暂停的是「游戏时间」，
               由 JS 侧在 visibilitychange 里处理。
               ★ 这里保持 WebView 正常运行（resumeTimers），
               只把「音频会话」交给原生处理。 */
            getBridge().getWebView().resumeTimers();
        }
    }
}
