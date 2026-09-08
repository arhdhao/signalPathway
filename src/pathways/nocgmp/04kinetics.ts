/* ══════════════════════════════════════════════════════════════════════════
 * ④ KINETICS —— 动力学层
 *    回答「这个作用多强、多快、多容易发生」。
 *    ⚠️ 改这里的任何数字都会直接改变模拟行为，改完请跑 tools/balance.mjs 验证。
 *
 *    分成两张小表，因为参数的归属不同：
 *      nodes     属于【分子自身】的属性 —— 它自己衰减多快、多少量算饱和
 *      reactions 属于【这条反应】的属性 —— 命中频段、协同性、力度、产能
 *    举例：sGC 的 decay（酶多久失活）跟着 sGC 走；而 sGC→cGMP 的 amplify
 *    （这条产线多大功率）跟着反应 r2 走。混在一起就会在「调一个酶」时误伤
 *    所有以它为起点的反应。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 这一层的参数语义是【和求解器绑定的】，别把它当成中立的「生物学数值」
 * ─────────────────────────────────────────────────────────────────────────
 *   下面这些字段全部是「骰子求解器」（engine.ts 的 _resolveReaction）的方言：
 *
 *     band      骰子命中区间          ← Gillespie 没有骰子，这个概念不存在
 *     hill      推动力的幂律指数      ← 近似对应协同性，但算法完全不同
 *     power     一次命中加多少激活度  ← 桌面游戏刻度，无文献单位
 *     amplify   每 tick 最多产多少    ← 对应 Vmax，但量纲不同
 *     slots     酶的处理槽位总额      ← 对应酶浓度 × kcat，但被离散成整数
 *
 *   换成 Gillespie / ODE 时，这一整个文件要【重写一套】，而不是做字段映射：
 *     kinetics.ts         （现在）骰子：band / hill / power / amplify / slots
 *     kinetics/gillespie.ts（将来）随机模拟：每个反应的速率常数 k + 化学计量
 *     kinetics/ode.ts      （将来）微分方程：Vmax / Km / kcat / kdeg
 *
 *   到那一步时，②③⑤⑥ 四层原样复用，只有这一层整体替换 ——
 *   这也是把关卡拆成文件夹（而不是塞进一个 41KB 大文件）的主要理由之一。
 * ══════════════════════════════════════════════════════════════════════════*/

import type {
  MoleculeTemplateConfig,
  ReactionConfig,
} from '../../engine.js';

/** ④ KINETICS 分子自身的动力学参数 */
export type NodeKin = Partial<Omit<MoleculeTemplateConfig, 'id' | 'name'>>;
/** ④ KINETICS 单条反应的动力学参数 */
export type RxKin = Partial<Omit<ReactionConfig, 'from' | 'to' | 'effect'>>;

export const KINETICS: {
  nodes: Record<string, NodeKin>;
  reactions: Record<string, RxKin>;
} = {
  /** ── 分子自身的动力学参数 ──────────────────────────────────────────────
   *   drive       推动力来源：count 数量驱动 | activation 激活度驱动 | pulse 脉冲
   *   K           半饱和常数：多少个分子能把推动力推到 50%
   *   band        命中频段 [lo, hi]（节点级，见下方 ⚠️）
   *   decay       激活度每 tick 的衰减比例（酶 / 激酶用）
   *   baseDecay   物质自然降解速率（信使分子 / 药物用）
   *   buffTicks   一次命中后增益 Buff 持续的 tick 数
   *   degradable  是否可被降解酶清除（默认 true）
   *   metabolism  药物被机体清除、退出战场的速率
   */
  nodes: {
    NO: {
      drive: 'count', K: 30, baseDecay: 0.115,
    },
    sGC: {
      drive: 'activation', decay: 0.015, buffTicks: 18,
      // ⚠️ 已知问题（待办，不在本次重构范围内）：
      //    节点级 band 目前【不参与任何计算】—— 引擎只认 ④ KINETICS.reactions
      //    里每条反应自己的 band。所以玩家在 sGC 上拖「命中频段宽度」滑块，
      //    实际不会改变模拟结果。要让它生效，得改 engine.js 的 _resolveReaction，
      //    让它优先取来源节点的 band。这里先原样保留，避免动到平衡。
      band: [0, 85],
    },
    cGMP: {
      drive: 'count', K: 62, baseDecay: 0.022, // `baseDecay``0.022`自然降解率—— 每个 tick 自动消失 2.2%。
    },
    PKG: {
      drive: 'activation', decay: 0.05, buffTicks: 20,
    },
    MLCP: {
      drive: 'activation', decay: 0.085, buffTicks: 12,
    },
    PDE5: {
      drive: 'activation', decay: 0.03, buffTicks: 26,
    },
    Sildenafil: {
      drive: 'count', K: 200,
      // degradable: false 是这关全部玩法的支点：西地那非照样占 PDE5 的槽位，
      // 但占完不被清除 → 酶的算力被永久浪费。它表面是个动力学开关，
      // 实际决定了「竞争性抑制」能否成立（跨层的典型例子，改这里要三思）。
      degradable: false,
      metabolism: 0.006,
    },
  },

  /** ── 每条反应的动力学参数 ──────────────────────────────────────────────
   *   band     命中频段 [lo, hi]，骰子落进 [lo, lo + 宽度 × 推动力^hill] 才算命中
   *   hill     协同系数，> 1 表示需要多个分子协同（S 形响应）
   *            ⚠️ 想改响应曲线的陡峭度改 hill，不要去改 power ——
   *               改 power 只会把曲线整体压扁成「开关」，协同性就丢了
   *   power    activate / inhibit 的力度
   *   amplify  produce 的放大乘数（每 tick 最多产出多少）
   *   gtpCost  每次产出消耗的资源量（0 = 不耗能量）
   *   costPool 消耗哪个资源池（'GTP' | 'ATP' | …）。引擎不认识 GTP 这个名字，
   *            它只按这里填的键去 pools 里扣钱 —— 第二关想改用 ATP，改这个字符串即可
   *   slots    consume 专用：酶的处理槽位总量
   *   slotTag  consume 专用：识别底物的标签
   */
  reactions: {
    r1: { band: [0, 58], hill: 1.4, power: 22 },
    r2: { band: [0, 72], hill: 1, amplify: 14, gtpCost: 1.0, costPool: 'GTP' },
    r3: { band: [0, 62], hill: 1.6, power: 42 },
    r4: { band: [0, 78], hill: 1, power: 48 },
    r5: { band: [0, 52], hill: 1.4, power: 30 },
    r6: { slots: 7.5, slotTag: 'PDE_Target' },
  },
};
