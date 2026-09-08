/* ══════════════════════════════════════════════════════════════════════════
 * ② BIOLOGY —— 生物学事实层
 *    ⚠️ 这一层【一个数字都不能有】。
 *    它只回答「谁是谁」和「谁影响谁」。至于影响多强、多快，那是 ④ KINETICS 的事。
 *
 *    这样分的好处：以后查到真实文献数据（比如 NO 的半衰期），
 *    改的是 KINETICS 里的 baseDecay，而「NO 激活 sGC」这个生物学事实纹丝不动。
 *
 *    想加一条新通路：这里加一行 → ③ 给两端配好标签 → ④ 补动力学数字。
 * ══════════════════════════════════════════════════════════════════════════*/

import type {
  MoleculeTemplateConfig,
  ReactionConfig,
} from '../../engine.js';

/** ② BIOLOGY 只负责分子档案（谁是谁） */
export type NodeBio = Pick<MoleculeTemplateConfig, 'name' | 'cn' | 'role' | 'kind' | 'desc'>;
/** ② BIOLOGY 只负责反应拓扑（谁影响谁） */
export type RxBio = Pick<ReactionConfig, 'from' | 'to' | 'effect'>;

export const BIOLOGY: {
  nodes: Record<string, NodeBio>;
  reactions: Record<string, RxBio>;
} = {
  /**
   * 分子档案。字段：
   *   name / cn  显示名 / 中文全名
   *   role       分类标记，画布与检查器会用它决定图标样式
   *              messenger 信使 | amplifier 放大器 | kinase 激酶
   *              effector 效应器 | decoy 诱饵 | donor 供体
   *   kind       'node' 内源分子（默认，可不写）| 'drug' 外来药物
   *   desc       点开节点后显示的档案卡文案
   */
  nodes: {
    NO: {
      name: 'NO', cn: '一氧化氮', role: 'messenger',
      desc: '由内皮细胞脉冲释放的气体信使。无视细胞膜地形阻挡，但半衰期极短 —— 它来去如风，靠的是「频率」而不是「存量」。',
    },
    sGC: {
      name: 'sGC', cn: '可溶性鸟苷酸环化酶', role: 'amplifier',
      desc: '放大器。接收频段窄、较难被随机碰撞激活；但一旦与 NO 密码匹配，就以极高的放大倍数把 GTP 批量转化成 cGMP。',
    },
    cGMP: {
      name: 'cGMP', cn: '环磷酸鸟苷', role: 'messenger',
      desc: '次级信使。它不靠单打独斗，而是靠庞大的数量去「淹没」下游分子的结合口袋 —— 数量本身就是它的信号强度。',
    },
    PKG: {
      name: 'PKG', cn: 'cGMP 依赖性蛋白激酶', role: 'kinase',
      desc: '调控核心。平时休眠，被 cGMP 激活后执行双线任务：主线磷酸化靶蛋白降低钙离子；旁路则顺手唤醒沉默的 PDE5 —— 这是整个死局的种子。',
    },
    MLCP: {
      name: '靶蛋白', cn: 'MLCP / 钙离子调控复合体', role: 'effector',
      desc: '效应器。被 PKG 磷酸化后主动降低胞内钙离子浓度。它的激活度衰减很快 —— PKG 一旦哑火，钙离子立刻反弹。',
    },
    PDE5: {
      name: 'PDE5', cn: '5 型磷酸二酯酶', role: 'decoy',
      desc: '负反馈核心。初始休眠，被 PKG 旁路唤醒后，按固定槽位总额降解所有带 PDE_Target 标签的分子。槽位有限 —— 这正是它的弱点。',
    },
    Sildenafil: {
      name: '西地那非', cn: 'PDE5 竞争性抑制剂', role: 'decoy', kind: 'drug',
      desc: '长得和 cGMP 极像的诱饵：拥有相同的 PDE_Target 密码，能被 PDE5 识别结合，但放大乘数为 0 且不可被降解。它凭数量优势塞满 PDE5 的槽位，让酶的算力全部浪费在它身上。',
    },
  },

  /**
   * 反应关系 —— 整个网络的拓扑。加减通路从这里开始。
   *   from / to  起点 / 终点分子 id（必须是上面 nodes 里出现过的）
   *   effect     activate 激活 | inhibit 沉默 | produce 产出 | consume 槽位降解
   *
   * 想「切断」一条通路：优先去 ③ 把共享标签摘掉，而不是删这行 ——
   * 删行等于这个生物学关系不存在了，摘标签只是让它碰不上，后者更符合引擎机制的本意。
   *
   * ─────────────────────────────────────────────────────────────────────────
   * ⚠️ 给未来的 Gillespie 求解器留个便签
   * ─────────────────────────────────────────────────────────────────────────
   *   effect 这四个枚举是【桌游动词】，不是化学计量。它们描述的是「游戏规则里
   *   这条边干什么」，而不是「反应消耗谁、生成谁、各几个」。
   *
   *   骰子求解器（当前）能直接吃它：activate → 挂激活 Buff，produce → 加计数。
   *   Gillespie 吃不下去 —— 它要的是化学计量式，形如：
   *
   *       PKG + MLCP → PKG + MLCP_p      （r4：PKG 不变，MLCP 变磷酸化态）
   *       cGMP       → GMP               （r6：cGMP 被消耗，生成 GMP）
   *       GTP        → cGMP              （r2：消耗 GTP，产出 cGMP）
   *
   *   也就是说，将来换 Gillespie 的第一道坎不在 engine.ts，而在这里：
   *   需要给每条 reaction 补一份 stoichiometry（consumed / produced 及系数），
   *   或者写一张「effect → 计量式」的翻译表。
   *
   *   现在不写，是因为写了也没人用，还会和 ④ KINETICS 的骰子参数打架。
   *   等真要做 Gillespie 求解器时，这里加字段，④ 整个换成 kinetics/gillespie.ts，
   *   ②③⑤⑥ 全部原样复用 —— 文件夹结构就是为这一天留的。
   */
  reactions: {
    r1: { from: 'NO',         to: 'sGC',  effect: 'activate' },
    r2: { from: 'sGC',        to: 'cGMP', effect: 'produce'  },
    r3: { from: 'cGMP',       to: 'PKG',  effect: 'activate' },
    r4: { from: 'PKG',        to: 'MLCP', effect: 'activate' },
    r5: { from: 'PKG',        to: 'PDE5', effect: 'activate' },
    r6: { from: 'PDE5',       to: 'cGMP', effect: 'consume'  },
  },
};
