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

    /// ★ Capacitor 7 要求显式列出方法（Swift 没有宏可用）
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
    @objc func getMany(_ call: CAPPluginCall) {
        var values: [String: String] = [:]
        if let keys = call.getArray("keys", String.self) {
            for k in keys {
                let full = KEY_PREFIX + k
                if defaults.object(forKey: full) != nil {
                    values[k] = defaults.string(forKey: full) ?? ""
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
