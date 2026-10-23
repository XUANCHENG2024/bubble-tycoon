import Foundation
import Capacitor

/**
 * 同步存储插件（BubbleStore · iOS）
 *
 * ★★ 为什么必须有它（与 Android 版同因）：
 *   本作引擎（js/engine.js）的存储契约是**同步**的 ——
 *   storageGet(key) 必须立刻返回字符串。
 *   ★ 而 @capacitor/preferences 是 Promise 异步的，
 *     直接接上 → storageGet 全返回 undefined
 *     → 读档全空、存档全丢，**而且不报任何错**。
 *
 *   ★ 底层 UserDefaults 本来就是同步的，
 *     是 Capacitor 的异步包装制造了这个契约冲突。
 *     这里直接调原生 API，把契约还原回去 ——
 *     **引擎一行都不用改**。
 */
@objc(BubbleStorePlugin)
public class BubbleStorePlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "BubbleStorePlugin"
    public let jsName = "BubbleStore"

    /// ★ Capacitor 7 要求 Swift 插件显式列出方法。
    /// ★★ 写法**与官方插件完全一致**（照抄 @capacitor/app 与 @capacitor/status-bar）：
    ///     public let pluginMethods: [CAPPluginMethod] = [
    ///         CAPPluginMethod(name: "exitApp", returnType: CAPPluginReturnPromise), …
    ///     ]
    /// ★★ CAPPluginReturnPromise 是 CAPBridgedPlugin.h 里的 ObjC 宏
    ///   （#define CAPPluginReturnPromise @"promise"），
    ///   Swift 能直接用它 —— 官方插件就是这么写的。
    ///   ★ 我一度怀疑它不可用（因为它是「宏」），查了官方插件源码才发现
    ///     官方用的正是它 —— ★ **照抄官方是最省事的验证方式**：
    ///     官方能编译通过的写法，我抄了就能编译通过。
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getMany", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAll", returnType: CAPPluginReturnPromise)
    ]

    /// ★ 存档专用命名空间，不与其他插件的数据混在一起
    private let defaults = UserDefaults.standard
    private let KEY_PREFIX = "bubbleTycoon_"

    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.resolve(["value": "", "found": false])
            return
        }
        let full = KEY_PREFIX + key
        if defaults.object(forKey: full) != nil {
            let v = defaults.string(forKey: full) ?? ""
            call.resolve(["value": v, "found": true])
        } else {
            call.resolve(["value": "", "found": false])
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key"),
              let value = call.getString("value") else {
            call.resolve(["ok": false])
            return
        }
        defaults.set(value, forKey: KEY_PREFIX + key)
        /* ★ 立刻落盘。
           ★ iOS 的 UserDefaults 是内存 + 定期异步刷盘，
             进程被杀可能丢最近的几条写入 ——
             而「刚打完一局，进度没了」是最不能接受的。
           ★ synchronize() 在 iOS 上被官方标记为 deprecated，
             但它仍然有效；对「少量关键写入」是合理的保险。 */
        defaults.synchronize()
        call.resolve(["ok": true])
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.resolve()
            return
        }
        defaults.removeObject(forKey: KEY_PREFIX + key)
        defaults.synchronize()
        call.resolve()
    }

    /// 批量读（启动预热用）—— 一次桥接往返读完所有键
    ///
    /// ★★★ 为什么用「逗号分隔的字符串」而不是数组参数 ★★★
    ///   Capacitor 的 `getArray(_:_:)` 返回 **[T]?（可选数组）**，
    ///   而 `getArray(_:)` 返回 `JSArray?` = `[JSValue]?`。
    ///   ★ 两者都是可选值，而 JSValue 的元素类型还需要额外转换 ——
    ///     这类 API 一旦用错，编译期就报错（Swift 不像 JS 有运行时兜底）。
    ///   ★ 而本作要读的键只有 4 个固定值，用逗号分隔完全够用，
    ///     且**只用 getString**（一个绝不会出错的 API）。
    ///   ★ 权衡：牺牲一点通用性，换「几乎不可能编译不过」。
    ///     这正是本项目当前最需要的 —— 我没有 Mac，**没法验证编译**。
    @objc func getMany(_ call: CAPPluginCall) {
        var values: [String: String] = [:]
        if let joined = call.getString("keys") {
            for k in joined.split(separator: ",") {
                let key = String(k).trimmingCharacters(in: .whitespacesAndNewlines)
                if key.isEmpty { continue }
                let full = KEY_PREFIX + key
                if defaults.object(forKey: full) != nil {
                    values[key] = defaults.string(forKey: full) ?? ""
                }
            }
        }
        call.resolve(["values": values])
    }

    /// 清空全部（只清本插件的命名空间）
    @objc func clearAll(_ call: CAPPluginCall) {
        let all = defaults.dictionaryRepresentation().keys
        for k in all where k.hasPrefix(KEY_PREFIX) {
            defaults.removeObject(forKey: k)
        }
        defaults.synchronize()
        call.resolve()
    }
}
