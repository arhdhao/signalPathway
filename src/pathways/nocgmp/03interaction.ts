/* ══════════════════════════════════════════════════════════════════════════
 * ③ INTERACTION —— 碰撞资格层（标签密码表）
 *
 *    这一层回答「谁有资格和谁发生作用」。它既不是纯生物学（密码是我们抽象出来的
 *    游戏机制），也不是动力学（这里依然没有数字），所以单独占一层。
 *
 *    规则：两个分子只要【共享至少一个标签】，就可能发生碰撞。
 * ══════════════════════════════════════════════════════════════════════════*/

/**
 * 分子携带的标签密码。
 *
 *   NO_Signal    NO 与 sGC 的对接密码
 *   cGMP_like    cGMP 与 PKG 的结合口袋
 *   PKG_dock     PKG 的底物识别位点（MLCP 与 PDE5 共享 → 旁路串扰的来源）
 *   PDE_Target   PDE5 的降解识别标签（cGMP 与西地那非共享 → 竞争抑制的来源）
 *
 * 「共享标签」是刻意设计，不是偷懒：
 *   · MLCP 与 PDE5 共享 PKG_dock  → 制造了负反馈（PKG 一手救火一手点火）
 *   · cGMP 与西地那非共享 PDE_Target → 制造了竞争抑制（两个底物抢同一批槽位）
 * 想让 PDE5 不再误伤 cGMP，改标签比改反应边更符合这套机制的本意。
 */
export const TAGS: Record<string, string[]> = {
  NO:         ['NO_Signal'],
  sGC:        ['NO_Signal', 'receptor_sGC'],
  cGMP:       ['cGMP_like', 'PDE_Target'],
  PKG:        ['cGMP_like', 'PKG_dock'],
  MLCP:       ['PKG_dock', 'effector'],
  PDE5:       ['PKG_dock', 'PDE5'],
  Sildenafil: ['PDE_Target'],
};
