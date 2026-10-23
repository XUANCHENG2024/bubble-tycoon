/* ★★★ 清档必须把备份一起删 ——
     加了双写之后这是最容易漏的一处：
       ① clearSave 只删主档 → hasAnySave 仍为 true，
          玩家删了档却还显示着（浏览器 smoke 立刻抓到了）
       ② 更糟：下次 loadGame 主档读不到会**从备份把档复活**，
          玩家明明点���删除，进游戏发现进度还在。
     ★ 这类「新增机制忘了让旧路径同步」的 bug 特征很固定：
       新功能自己测都对，一旦与老功能交互就出错。
       浏览器 smoke 的「清档后该槽位为空」就是守这个的。 */
  window.eval('window.S = newGame("normal", 0, null); saveGame(window.S);');
  window.eval('clearSave(0);');
  check(window.eval('storageGet(' + JSON.stringify(key) + ')') === ''
    && window.eval('storageGet(' + JSON.stringify(key + '_bak') + ')') === '',
    '清档时主档与备份都被删除');
  check(window.eval('!slotInfo(0)'), '清档后槽位摘要为空');
  check(window.eval('!hasAnySave()'), '清档后 hasAnySave 为 false');
  /* ★ 删了之后读档必须拿不到东西（不能从备份复活） */
  check(window.eval('loadGame(0) === null'), '清档后读档拿不到任何数据');
}