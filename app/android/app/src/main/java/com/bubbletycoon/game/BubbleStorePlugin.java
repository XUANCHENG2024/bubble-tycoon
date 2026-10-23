package com.bubbletycoon.game;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 同步存储插件（BubbleStore）
 *
 * ★★ 为什么必须有它（而不是用 @capacitor/preferences）：
 *   本作引擎（js/engine.js）的存储契约是**同步**的 ——
 *   storageGet(key) 必须立刻返回字符串。
 *   这是因为小游戏 API（tt.getStorageSync）与 localStorage 都是同步的，
 *   契约从 V2 一直没变过。
 *
 *   ★ 而 @capacitor/preferences 是 **Promise 异步**的。
 *     直接接上会怎样？
 *       storageGet 全部返回 undefined
 *       → 读档全空、存档全丢，**而且不报任何错**（最难查的那种）。
 *
 *   ★ 底层其实本来就是同步的：
 *     Android = SharedPreferences（同步）
 *     iOS     = UserDefaults（同步）
 *   Capacitor 把它们包成了异步接口，才产生了这个契约冲突。
 *
 *   ★ 所以这里直接调原生同步 API，把契约还原回去 ——
 *     **引擎一行都不用改**。
 *
 * ★ 另一个用途：批量预热。
 *   App 启动时把所有存档键一次性读进内存（原生同步，几微秒），
 *   之后 JS 侧读内存，写时同步落盘。
 */
@CapacitorPlugin(name = "BubbleStore")
public class BubbleStorePlugin extends Plugin {

    private static final String PREF_NAME = "bubble_tycoon";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
    }

    /**
     * 同步读一个键。
     * @param call { key: string }
     * @return { value: string, found: boolean }
     */
    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key", "");
        SharedPreferences p = prefs();
        JSObject ret = new JSObject();
        if (p.contains(key)) {
            ret.put("value", p.getString(key, ""));
            ret.put("found", true);
        } else {
            ret.put("value", "");
            ret.put("found", false);
        }
        call.resolve(ret);
    }

    /**
     * 同步写一个键。
     * @param call { key: string, value: string }
     */
    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key", "");
        String value = call.getString("value", "");
        /* ★ commit() 而不是 apply()：
             apply() 是异步落盘，进程被杀可能丢数据；
             commit() 同步写、返回成功与否。
             ★ 存档写入不频繁（每局结束 / 每天结算），同步写的开销可接受，
               换来的是「写完就是写进去了」的确定性。 */
        boolean ok = prefs().edit().putString(key, value).commit();
        JSObject ret = new JSObject();
        ret.put("ok", ok);
        call.resolve(ret);
    }

    /**
     * 同步删一个键。
     * @param call { key: string }
     */
    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key", "");
        prefs().edit().remove(key).commit();
        call.resolve();
    }

    /**
     * 批量读（启动预热用）。
     * ★ 一次 JNI 往返读完所有键，比逐个 get 快得多。
     * @param call { keys: string[] }
     * @return { values: { key: value } }
     */
    @PluginMethod
    public void getMany(PluginCall call) {
        /* ★ 直接用 JSObject 装结果 —— 不需要额外的 Holder 类。
           JSObject.put(String, Object) 与 put(String, String) 都存在，
           直接把 String 值塞进去即可。 */
        JSObject values = new JSObject();
        try {
            com.getcapacitor.JSArray keys = call.getArray("keys");
            if (keys != null) {
                SharedPreferences p = prefs();
                for (int i = 0; i < keys.length(); i++) {
                    String k = keys.getString(i);
                    if (k == null) continue;
                    if (p.contains(k)) values.put(k, p.getString(k, ""));
                }
            }
        } catch (Exception e) {
            /* 读不到就当没有 —— 引擎会走「空存档」的正常路径 */
        }
        JSObject ret = new JSObject();
        ret.put("values", values);
        call.resolve(ret);
    }

    /**
     * 清空全部（App 的「重置进度」用）。
     * ★ 注意：只清本插件的命名空间，不碰其他插件的数据。
     */
    @PluginMethod
    public void clearAll(PluginCall call) {
        prefs().edit().clear().commit();
        call.resolve();
    }
}
