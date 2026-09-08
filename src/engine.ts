/* ============================================================================
 * Signaling Pathway Simulator — Core Engine
 * ----------------------------------------------------------------------------
 * 纯逻辑层：不依赖任何 DOM / Canvas API，可同时在 Node（配平与回归测试）
 * 与浏览器中运行。渲染层只读这里的状态，不反向写入。
 *
 * 结算四步：  匹配标签(tags) → 掷骰子(band) → 挂 Buff(activation/timer) → 乘数增量(amplify)
 * 时间基准：  逻辑 10 Hz（TICK_MS = 100），渲染 60 fps，二者解耦。
 * ==========================================================================*/

/* 【如何读这个文件 —— 给非程序员的导读】
 * 整个引擎本质上是一个「状态机」：每 100 毫秒走一步，把所有节点的激活度、
 * 分子数量、Buff 倒计时推进一步。这文件从下到上分六块：
 *
 *   ① TUNING            —— 引擎机制常量：Buff 衰减倍率、抖动幅度、各种上限
 *   ② RNG（伪随机数）   —— 让模拟既像游戏又像实验：相同种子下每次跑都一样
 *   ③ MoleculeTemplate  —— 节点的"出厂设定"：标签、命中频段、放大倍数等
 *   ④ Molecule          —— 节点的运行时实例：当前激活度、Buff 剩余时间等
 *   ⑤ Reaction          —— 节点之间的"反应边"：激活 / 沉默 / 产出 / 槽位降解
 *   ⑥ Simulator         —— 整个模拟的大脑：主循环、药物投放、胜负判定
 *
 * 【本文件最重要的原则：引擎不认识任何具体的分子名】
 * 这个文件里不该出现 'NO' / 'cGMP' / 'GTP' / 'Ca' 这类关卡专属的名字，
 * 也不该出现「cGMP 超过 190 判负」这种关卡规则。它们全都在
 * src/pathways/*.js 里。判断标准只有一句话：
 *
 *     换一个关卡，这个数字 / 这个名字会不会跟着变？
 *       会   → 它是关卡内容，放进 pathways/*.js
 *       不会 → 它是引擎机制，留在 TUNING
 *
 * 引擎只提供四种"判定形状"（指标怎么算 / 怎么算赢 / 怎么算三种死法 / 曲线采什么），
 * 具体判谁、判多少、说什么话，一律由关卡填表。
 * 好处：做第二关时复制关卡文件改数据即可，引擎一行都不用动。
 *
 * 关键概念：
 *   · "标签密码"  决定两个分子能不能碰撞。每个分子挂几个标签 (tags)，
 *                 只有共享至少一个标签的分子对才会发生反应。这是 PDF 设计的核心。
 *   · "四步结算"  每个 tick 对每条反应边执行：匹配标签 → 掷骰子 → 挂 Buff → 乘数增量。
 *   · "槽位竞争"  降解酶的处理能力按数量瓜分给所有可降解底物。不可降解的诱饵靠
 *                 "占座不退出"把真正的底物保护下来 —— 这就是竞争性抑制在代码里的表达。
 *   · "双缓冲"    Simulator.tick() 里所有反应"读 this 快照、写 next 缓冲"，末尾一次性提交。
 *                 保证信号传播严格 1 tick 延迟，消除遍历顺序带来的"幽灵先手"——
 *                 反馈回路密集的通路尤其依赖它（见 gifts/ 里 Gemini 评审第二条）。
 *   · "三种失败"  能量枯竭 / 脱靶毒性 / 无响应超时，加上"成功"共四种结局。
 *                 判定配方在关卡的 OUTCOME 里，判定引擎在 _judge() 里。
 *
 * 如果你只想读懂一个函数，从 Simulator.tick() 开始；它就是每 100ms 发生一次的"心跳"。
 */

export const TICK_MS = 100; // 每个 tick 100ms
export const TPS = 1000 / TICK_MS; // 每秒逻辑帧数 = 10 ，每秒 10 个 tick

/* ==========================================================================
 * TUNING —— 引擎机制常量
 * --------------------------------------------------------------------------
 * 【这一块和关卡数据有什么区别？判断标准只有一条】
 *
 *   换一个关卡（比如做一条全新的通路），这个数字会不会跟着变？
 *     · 会  → 它是关卡内容，应该放进 src/pathways/*.js
 *     · 不会 → 它是引擎机制，属于这里
 *
 * 举例：「Buff 期内衰减放慢到 35%」是引擎的通用规则，第二关、第三关也一样，
 * 所以它在这里；而「cGMP 超过 190 判负」「GTP 池见底算饿死」是第一关的
 * 关卡设计，所以它们在 nocgmp.js 的 OUTCOME 里。
 *
 * 这里的数字以前是直接写在代码里的裸数字（所谓魔法数字），现在提上来并命名：
 * 好处是调引擎手感时只改这一处，而且看名字就知道它在管什么。
 * ⚠️ 改动这些值会影响【所有关卡】，改完要跑 tools/balance.mjs 与 tools/smoke.mjs。
 * ==========================================================================*/
export const TUNING = {
  /** 激活度的满值。激活度是一个 0–100 的抽象刻度，不是真实浓度 —— 别当物理单位看。 */
  activationMax: 100,

  /** Buff 生效期内，激活度衰减放慢到的倍率（模拟"被化学修饰后状态更稳定"）。 */
  buffDecayScale: 0.35,
  /** Buff 过期后，激活度衰减加速到的倍率（模拟"修饰被移除，迅速回落"）。 */
  spentDecayScale: 2.0,

  /** 被沉默（抑制）时，激活度每 tick 乘以的系数 —— 越接近 1 崩塌越慢。 */
  muteCollapse: 0.90,
  /** 激活度 ≥ 此值，节点对外显示为「激活中」（决定发光强度）。 */
  activeThreshold: 55,

  /** 每次命中 / 产出的随机抖动区间，让模拟不至于像一条死板的曲线。 */
  hitJitter: [0.85, 1.15],

  /** 脉冲周期的下限（tick）。防止关卡把 period 配得过小导致每 tick 都喷发。 */
  pulsePeriodFloor: 3,

  /** 同类增益型药物【连续投放】时，放大倍数的累乘增量（不是覆盖，是叠加 ——
   *  这正是"叠加用药出事"的机制来源，见 applyDrug 的 boostPulse 分支）。 */
  boostStackBonus: 0.7,

  /** 命中闪光每 tick 的衰减量，纯视觉。 */
  flashFade: 0.12,

  /** 折线图最多保留多少帧快照（超出后丢弃最旧的）。 */
  historyCap: 1200,
  /** 每 N 个 tick 存一条折线图快照。 */
  snapshotEvery: 2,
  /** 事件流水最多保留多少条。 */
  eventCap: 60,
};

/**
 * 极简模板填充：把字符串里的 {name} 换成 vars 里对应的值。
 * 找不到对应值就原样保留 {name}，方便一眼看出漏传了什么。
 *
 * 为什么需要它：结算文案里有「cGMP 突破 190 红线」这种带运行时数字、
 * 又提到关卡分子名的句子。文案属于关卡（COPY），数字属于运行时，
 * 用占位符把两边接起来，引擎就不用再拼字符串、也不用认识 cGMP 是什么了。
 */
export function fillTemplate(tpl: string, vars: Record<string, string | number>): string {
  return String(tpl).replace(/\{\s*(\w+)\s*\}/g, (all, key) =>
    key in vars ? String(vars[key]) : all
  );
}

/** 夹在 [lo, hi] 之间的小工具，_updateMetrics 里约束指标上下限用 */
const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/* ---------------------------------------------------------------- 随机数 */
/** mulberry32：可复现的伪随机源，便于关卡回放与参数敏感性分析 */
export class RNG {
  /** 触发种子（无符号整数） */
  seed: number;
  /** mulberry32 内部状态 */
  s: number;

  constructor(seed = 20260904) {
    this.seed = seed >>> 0 || 1;
    this.s = this.seed;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + this.next() * (b - a); }
  /** 掷一枚 0–100 的骰子 */
  roll(): number { return this.next() * 100; }
  reseed(seed: number): void { this.seed = seed >>> 0 || 1; this.s = this.seed; }
}

/* ---------------------------------------------------------------- 状态枚举 */
/** 节点运行状态。Molecule.status 只取这三个值之一。 */
export type MoleculeStatus = 'Inactive' | 'Active' | 'Muted';

export const Status: Record<string, MoleculeStatus> = {
  INACTIVE: 'Inactive', // 未激活 / 休眠
  ACTIVE: 'Active',     // 激活（挂载增益 Buff）
  MUTED: 'Muted',       // 沉默 / 被抑制
};
export const STATUS_INACTIVE = Status.INACTIVE as MoleculeStatus;
export const STATUS_ACTIVE = Status.ACTIVE as MoleculeStatus;
export const STATUS_MUTED = Status.MUTED as MoleculeStatus;

/* ---------------------------------------------------------- 领域类型定义 */
/* 这些接口把 PDF「关卡 = 数据」的理念落成类型：引擎只认识这些形状，
 * 关卡文件（pathways/*.ts）只要让导出对象满足 LevelConfig，字段拼错 /
 * 缺字段 / 类型不对都会在编译期被 tsc 当场拦住，而不是等到跑起来才炸。 */

/** 驱动方式：激活度 / 数量 / 外部脉冲 */
export type DriveKind = 'activation' | 'count' | 'pulse';
/** 反应效应：激活 / 沉默 / 产出 / 槽位降解 */
export type EffectKind = 'activate' | 'inhibit' | 'produce' | 'consume';
/** 分子分类标记（决定画布与检查器的图标样式） */
export type NodeRole = 'source' | 'messenger' | 'receptor' | 'amplifier' |
  'kinase' | 'effector' | 'decoy' | 'donor' | 'generic';
/** 指标算法通式 */
export type MetricKind = 'driven' | 'mirror' | 'derived';

/** 命中频段 [lo, hi]，骰子落在此区间才算命中 */
export type Band = [number, number];

/** 关卡里"取某个量"的统一引用（引擎 _readValue 认这三种） */
export interface ValueRef {
  kind: 'node' | 'metric' | 'pool';
  id: string;
  /** node 引用时读取 count 还是 activation（默认 count） */
  prop?: 'count' | 'activation';
}

/** 分子模板的"出厂设定" —— MoleculeTemplate 由一份部分配置补齐默认值而成 */
export interface MoleculeTemplateConfig {
  id: string;
  name: string;
  cn?: string;
  kind?: 'node' | 'drug';
  role?: NodeRole;
  tags?: string[];
  x?: number; y?: number;
  band?: Band;
  K?: number;
  hill?: number;
  amplify?: number;
  decay?: number;
  baseDecay?: number;
  buffTicks?: number;
  drive?: DriveKind;
  degradable?: boolean;
  editable?: string[];
  desc?: string;
  color?: string;
  /** 分子实例初始值（关卡里通过它设 count / activation） */
  initialCount?: number;
  initialActivation?: number;
  metabolism?: number;
}

/** 单条反应边的配置（引擎再补 id 等默认值成 Reaction） */
export interface ReactionConfig {
  id?: string;
  from: string;
  to: string;
  effect: EffectKind;
  band?: Band;
  hill?: number;
  power?: number;
  amplify?: number;
  gtpCost?: number;
  slots?: number;
  slotTag?: string;
  costPool?: string;
  negate?: boolean;
  label?: string;
  waypoints?: { x: number; y: number }[];
}

/** Buff 条目 —— 挂在分子身上的带倒计时状态标签 */
export interface Buff {
  id: string;
  name: string;
  kind: 'mute' | string;
  timer: number;
  source: string;
}

/** 宏观指标配置 —— 指标怎么算（kind + 参数）由关卡声明 */
export interface MetricConfig {
  id: string;
  name?: string;
  unit?: string;
  kind?: MetricKind;
  /** driven / mirror 用：读哪个分子 */
  driver?: string;
  base?: number;
  /** driven：每 tick 被效应器抽走的量 */
  drain?: number;
  /** driven：向 base 回归的速率 */
  restore?: number;
  /** driven：min/max 约束区间 */
  min?: number;
  max?: number;
  /** derived：由哪个指标换算 */
  from?: string;
  /** derived：换算函数 */
  transform?: (v: number) => number;
  color?: string;
}

/** 折线图一条曲线 */
export interface ChartSeries {
  key: string;
  label?: string;
  color?: string;
  /** 线型（canvas setLineDash 的数组）。不填 = 实线。
   *  同图曲线多了以后只靠颜色不够分（尤其色觉障碍），线型是第二重区分。 */
  dash?: number[];
  kind: 'node' | 'metric' | 'pool';
  id: string;
  prop?: 'count' | 'activation';
}

/** 关卡结算文案模板 */
export interface OutcomeText {
  title: string;
  detail: string;
}

/** 关卡完整结构 —— nocgmp.ts 导出的 LEVEL 必须满足它 */
export interface LevelConfig {
  id: string;
  name: string;
  subtitle?: string;
  canvas: { w: number; h: number };
  /** 外部信号源脉冲 */
  pulse: { node: string; period: number; amount: number; cap: number };
  pools: Record<string, number>;
  poolsRegen?: Record<string, number>;
  /** 关卡给玩家看的超时秒数（由 OUTCOME 反推） */
  timeout: number;
  goal: { metric: string; target: number; hold: number };
  /** 红线：指标名 -> 阈值 */
  redline?: Record<string, number>;
  /** 分子模板列表 */
  nodes: MoleculeTemplateConfig[];
  /** 反应边列表 */
  reactions: ReactionConfig[];
  drugs: DrugConfig[];
  metrics: MetricConfig[];
  chart: { max: number; series: ChartSeries[] };
  /** 四个结局的判定配方 */
  outcome: OutcomeConfig;
  /** 结算文案 */
  brief: string;
  hint: string;
  lessons?: string[];
  outcomeText: Record<string, OutcomeText>;
}

/** 药物可投放配置 */
export interface DrugEffect {
  kind: 'spawn' | 'mute' | 'boostPulse' | 'restore';
  target?: string;
  amount?: number;
  metabolism?: number;
  ticks?: number;
  factor?: number;
  periodScale?: number;
  pool?: string;
}

export interface DrugConfig {
  id: string;
  name: string;
  en?: string;
  charges: number;
  hotkey: string;
  color: string;
  icon: string;
  desc: string;
  effects: DrugEffect[];
}

/** 四结局判定配方 —— 由关卡 OUTCOME 提供，引擎只执行"判定形状" */
export interface OutcomeConfig {
  win: {
    metric: string;
    below: number;
    hold: number;
    slipPerTick: number;
    safe: SafeCondition[];
  };
  starve: { pool: string; emptyBelow: number; sustainTicks: number };
  toxicity: ValueRef & { above: number; sustainTicks: number };
  timeout: { ticks: number };
}

/** 一条"安全前置条件"（win.safe 里的元素） */
export interface SafeCondition extends ValueRef {
  /** pool 用：当前量 > 池容 × aboveRatio */
  aboveRatio?: number;
  /** node/metric 用：当前值 < below */
  below?: number;
}
export interface Outcome {
  result: 'win' | 'lose';
  reason: string;
  title: string;
  detail: string;
  time: number;
}

/* ------------------------------------------------------- Molecule 模板 */
/**
 * 所有信号分子 / 药物的抽象模板。运行时实例由 Simulator 从此模板生成。
 * 关键字段（与 PDF 设计一一对应）：
 *   tags      —— 三维结构密码，只有标签相交才允许碰撞
 *   band      —— 命中频段 [lo, hi]，骰子落在此区间才算命中
 *   K         —— 半饱和常数：多少个上游分子能把推动力推到 50%
 *   hill      —— 协同系数，>1 表示需要多个分子协同才能激活（S 形响应）
 *   amplify   —— 放大乘数，激活后每 tick 批量产出下游分子的基数
 *   decay     —— 激活度每 tick 的衰减比例
 *   buffTicks —— 一次命中后增益 Buff 持续的 tick 数
 */
export class MoleculeTemplate {
  id: string;
  name: string;
  cn: string;
  kind: 'node' | 'drug';
  role: NodeRole;
  tags: string[];
  x: number; y: number;
  band: Band;
  K: number;
  hill: number;
  amplify: number;
  decay: number;
  baseDecay: number;
  buffTicks: number;
  drive: DriveKind;
  degradable: boolean;
  editable: string[];
  desc: string;
  color: string;

  constructor(cfg: MoleculeTemplateConfig) {
    Object.assign(this, {
      id: 'mol',
      name: 'Molecule',
      cn: '',
      kind: 'node',          // node | drug
      role: 'generic',       // source|messenger|receptor|amplifier|kinase|effector|decoy|donor
      tags: [],
      x: 0, y: 0,            // 拓扑图坐标
      band: [0, 30],         // 命中频段
      K: 100,                // 半饱和常数
      hill: 1,               // 协同系数
      amplify: 1,            // 放大乘数
      decay: 0.05,           // 激活度衰减
      baseDecay: 0,          // 物质自然降解（信使分子）
      buffTicks: 25,         // Buff 持续 tick
      drive: 'activation',   // activation | count | pulse
      degradable: true,      // 是否可被降解酶清除（西地那非 = false）
      editable: [],          // 允许玩家在侧边栏调节的参数白名单
      desc: '',
      color: '#4dd0c7',
    }, cfg);
  }
}

/* ------------------------------------------------------- Molecule 实例 */
export class Molecule {
  tpl: MoleculeTemplate;
  id: string;
  count: number;
  activation: number;
  nextCount: number;
  nextActivation: number;
  status: MoleculeStatus;
  timer: number;
  muteTimer: number;
  buffs: Buff[];
  flash: number;
  lastGain: number;
  lastHit: boolean;
  metabolism: number;

  constructor(tpl: MoleculeTemplate) {
    this.tpl = tpl;
    this.id = tpl.id;
    this.count = 0;           // 分子数量（信使 / 药物）
    this.activation = 0;      // 激活度 0–100（酶 / 受体）
    // 双缓冲：本 tick 反应写入的"下一帧"状态。tick() 开头从当前快照拷入，
    // 所有反应只读 this.*（快照）、只写 next.*（缓冲），末尾一次性提交。
    // 这是消除"遍历顺序幽灵先手"的关键，也让反馈回路获得严格的 1 tick 传播延迟。
    this.nextCount = 0;
    this.nextActivation = 0;
    this.status = Status.INACTIVE;
    this.timer = 0;           // Buff 倒计时
    this.muteTimer = 0;       // 沉默倒计时
    this.buffs = [];          // { id, name, kind, timer, source }
    this.flash = 0;           // 命中闪光，渲染层读取
    this.lastGain = 0;        // 本 tick 产量，粒子系统读取
    this.lastHit = false;     // 本 tick 是否掷骰命中
    this.metabolism = 0;      // 药物代谢清除速率
  }

  get isDrug(): boolean { return this.tpl.kind === 'drug'; }
  get isMuted(): boolean { return this.muteTimer > 0; }

  /** 对下游的推动力 0–1 —— 相当于连续模型里的「有效浓度」
   *
   * 关键设计：用「饱和曲线」替代米氏方程。
   *   drive = count / (count + K)         // 标准饱和（count 驱动）
   *   drive = activation / 100            // 酶激活度直接当推动力（activation 驱动）
   * 数学含义：分子越多 → 推动力越大，但越接近上限越难继续涨。
   * 这就是「信号传导有天花板」的代码表达 —— 没有这个上限，任意放大器都会失控。
   */
  get drive() {
    if (this.isMuted) return 0;
    const t = this.tpl;
    if (t.drive === 'count') return this.count / (this.count + t.K);
    if (t.drive === 'pulse') return this.count > 1 ? 1 : this.count;
    return this.activation / TUNING.activationMax;
  }

  /** 状态饱和度 0–1，供渲染层决定发光强度 */
  get saturation() {
    const t = this.tpl;
    if (t.drive === 'count' || t.drive === 'pulse') {
      return Math.min(1, this.count / (t.K * 2));
    }
    return this.activation / TUNING.activationMax;
  }

  /** 挂 Buff —— 第三步：化学修饰 → 带倒计时的状态标签
   *  双缓冲：写入 nextActivation（不是 this.activation）。增益的"天花板"仍用
   *  当前快照 this.activation 计算 room，保证同一 tick 内的多次激活不会自我叠加放大。 */
  applyActivation(delta: number, ticks: number): number {
    if (this.isMuted) return 0;
    const before = this.nextActivation;
    // 饱和趋近：越接近满值越难继续上升，避免无限堆叠
    const room = 1 - this.activation / TUNING.activationMax;
    const gain = delta * Math.max(0, room);
    this.nextActivation = clamp(
      this.nextActivation + gain, 0, TUNING.activationMax
    );
    if (gain > 0 && ticks > 0) this.timer = Math.max(this.timer, ticks);
    return this.nextActivation - before;
  }

  addBuff(buff: Buff): Buff {
    const exist = this.buffs.find((b) => b.id === buff.id);
    if (exist) { exist.timer = Math.max(exist.timer, buff.timer); return exist; }
    this.buffs.push({ ...buff });
    return buff;
  }

  mute(ticks: number, source = '') {
    this.muteTimer = Math.max(this.muteTimer, ticks);
    this.status = Status.MUTED;
    this.addBuff({ id: 'muted', name: '沉默', kind: 'mute', timer: ticks, source });
  }

  /** 每个逻辑帧调用 —— 消耗资源、倒计时递减 */
  onTick() {
    if (this.muteTimer > 0) {
      this.muteTimer -= 1;
      this.activation *= TUNING.muteCollapse; // 沉默期激活度快速崩塌
      if (this.muteTimer === 0) this.status = Status.INACTIVE;
    }
    this.timer = Math.max(0, this.timer - 1);
    this.buffs = this.buffs.filter((b) => (b.timer -= 1) > 0);

    // Buff 期内衰减慢，Buff 过期后加速回落 —— 这就是「激活状态有持续时间」
    const d = this.tpl.decay
      * (this.timer > 0 ? TUNING.buffDecayScale : TUNING.spentDecayScale);
    this.activation = Math.max(0, this.activation * (1 - d));

    if (this.tpl.baseDecay > 0) {
      this.count = Math.max(0, this.count * (1 - this.tpl.baseDecay));
    }
    if (this.metabolism > 0) {
      this.count = Math.max(0, this.count * (1 - this.metabolism));
    }
    this.flash = Math.max(0, this.flash - TUNING.flashFade);

    if (!this.isMuted) {
      this.status = this.activation >= TUNING.activeThreshold
        ? Status.ACTIVE : Status.INACTIVE;
    }
  }
}

/* ------------------------------------------------------------- Reaction */
/**
 * 一条反应边。effect 类型：
 *   activate —— 掷骰命中后给目标挂激活 Buff
 *   inhibit  —— 掷骰命中后给目标挂沉默 Buff
 *   produce  —— 掷骰命中后按放大乘数批量生成分子（消耗 GTP）
 *   consume  —— 槽位竞争降解：按数量比例瓜分酶的处理槽位
 */
export class Reaction {
  id: string;
  from: string;
  to: string;
  effect: EffectKind;
  band: Band;
  hill: number;
  power: number;
  amplify: number;
  gtpCost: number;
  slots: number;
  slotTag: string;
  costPool: string;
  negate: boolean;
  label: string;
  waypoints: { x: number; y: number }[];

  constructor(cfg: ReactionConfig) {
    Object.assign(this, {
      id: '', from: '', to: '',
      effect: 'activate',
      band: [0, 30],
      hill: 1,
      power: 20,       // activate/inhibit 的力度
      amplify: 0,      // produce 的放大乘数
      gtpCost: 0,      // 每次产出消耗的 GTP
      slots: 0,        // consume：酶的处理槽位
      slotTag: '',     // consume：识别底物的标签
      costPool: 'GTP', // produce：这次合成消耗哪个资源池（第二关要换 ATP 就配这里）
      negate: false,   // 渲染用：是否画成抑制箭头
      label: '',
      waypoints: [],   // 渲染用：折线拐点
    }, cfg);
    if (!this.id) this.id = `${this.from}->${this.to}`;
  }
}

/* ------------------------------------------------------------ Simulator */
export class Simulator {
  /** 关卡配置（引擎不认识具体分子名，一切内容都来自这里） */
  level: LevelConfig;
  rng: RNG;

  tickCount: number;
  time: number;
  /** 分子运行实例表 id -> Molecule */
  nodes: Map<string, Molecule>;
  /** Reaction 实例列表（由关卡 reactions 配置生成） */
  reactions: Reaction[];
  /** 资源池当前量 id -> number */
  pools: Record<string, number>;
  /** 资源池上限（= 初始值，仅消耗不涨过它） */
  poolsMax: Record<string, number>;
  /** 宏观指标当前值 id -> number */
  metrics: Record<string, number>;

  /** 药物投放状态 id -> { uses, active } */
  drugState: Map<string, { uses: number; active: boolean }>;

  holdTicks: number;
  dangerTicks: number;
  starveTicks: number;
  /** null 或已决出的结局 */
  outcome: Outcome | null;
  /** 折线图快照历史（每行含 t 与各系列键） */
  history: Record<string, number>[];
  /** 事件流水（log 写入，UI 展示） */
  events: { t: string; text: string; kind: string }[];
  selected: string | null;
  paused: boolean;
  speed: number;
  /** 副产物/脉冲内部状态（被 boostPulse 等修改） */
  _pulseClock: number;
  _ntgBoost: number;
  _ntgFactor: number;
  _ntgPeriod: number;

  constructor(level: LevelConfig, opts: { seed?: number } = {}) {
    this.level = level;
    this.rng = new RNG(opts.seed ?? 20260904);
    this.reset();
  }

  reset(seed?: number): void {
    const L = this.level;
    if (seed !== undefined) this.rng.reseed(seed);

    this.tickCount = 0;
    this.time = 0;                 // 秒
    this.nodes = new Map();
    this.reactions = L.reactions.map((r) => new Reaction(r));
    this.pools = { ...L.pools };
    this.poolsMax = { ...L.pools };
    this.metrics = {};
    for (const m of L.metrics) this.metrics[m.id] = m.base ?? 0;

    for (const tpl of L.nodes) {
      const m = new Molecule(new MoleculeTemplate(tpl));
      m.count = tpl.initialCount ?? 0;
      m.activation = tpl.initialActivation ?? 0;
      this.nodes.set(m.id, m);
    }

    this.drugState = new Map(); // drugId -> { uses, active:boolean }
    for (const d of L.drugs) this.drugState.set(d.id, { uses: 0, active: false });

    this.holdTicks = 0;
    this.dangerTicks = 0;
    this.starveTicks = 0;
    this.outcome = null;        // null | {result:'win'|'lose', reason, title, detail}
    this.history = [];          // 折线图数据
    this.events = [];           // 事件流水
    this.selected = null;
    this.paused = false;
    this.speed = 1;
    this._pulseClock = 0;
    this._ntgBoost = 0;
    this._ntgFactor = 1;
    this._ntgPeriod = 1;
  }

  get nodeList(): Molecule[] { return [...this.nodes.values()]; }
  node(id: string): Molecule | undefined { return this.nodes.get(id); }

  log(text: string, kind = 'info'): void {
    this.events.unshift({ t: this.time.toFixed(1), text, kind });
    if (this.events.length > TUNING.eventCap) this.events.pop();
  }

  /* ---------------------------------------------------------- 投放药物 */
  applyDrug(drugId: string): boolean {
    const drug = this.level.drugs.find((d) => d.id === drugId);
    if (!drug) return false;
    const st = this.drugState.get(drugId);
    if (!st || st.uses >= drug.charges) return false;

    st.uses += 1;
    st.active = true;

    for (const eff of drug.effects) {
      if (eff.kind === 'spawn') {
        // 底物 / 竞争性类似物：直接投放分子实体进入战场
        const m = this.node(eff.target!);
        if (!m) continue;
        m.count += eff.amount ?? 0;
        m.metabolism = eff.metabolism ?? 0;
      } else if (eff.kind === 'mute') {
        const m = this.node(eff.target!);
        m?.mute(eff.ticks ?? 0, drug.name);
      } else if (eff.kind === 'boostPulse') {
        // 连续给药会累乘放大，而不是简单覆盖 —— 这正是「叠加用药出事」的机制来源
        this._ntgFactor = this._ntgBoost > 0
          ? this._ntgFactor + TUNING.boostStackBonus
          : (eff.factor ?? 2);
        this._ntgPeriod = Math.min(
          this._ntgBoost > 0 ? this._ntgPeriod : 1,
          eff.periodScale ?? 1
        );
        this._ntgBoost = Math.max(this._ntgBoost, eff.ticks ?? 0);
      } else if (eff.kind === 'restore') {
        const pool = eff.pool;
        if (pool && this.pools[pool] !== undefined) {
          this.pools[pool] = Math.min(
            this.poolsMax[pool] ?? this.pools[pool],
            this.pools[pool] + (eff.amount ?? 0)
          );
        }
      }
    }
    this.log(`投放 ${drug.name} ×${st.uses}`, 'drug');
    return true;
  }

  /* ------------------------------------------------------------ 主循环 */
  /** 整个引擎的「心跳」 —— 每 100 毫秒被主循环调一次。
   * 一个 tick 内的严格顺序（双缓冲贯穿其中）：
   *   快照 → 脉冲(写 next) → 四步结算(读 this / 写 next) → 提交(next→this)
   *        → 自身衰减 → 资源再生 → 宏观指标 → 判定
   * 这是整局游戏唯一的"时钟源"。所有粒子动画都是这个 tick 的视觉延伸。
   */
  tick() {
    if (this.outcome || this.paused) return;
    const L = this.level;

    // —— 双缓冲：把当前状态快照到 next 缓冲区 ——
    // 之后所有反应都是"读 this（本 tick 开始的快照）、写 next（下一帧）"，
    // 这样无论 reactions 数组怎么排序、通路里有没有反馈环，信号传播都严格 1 tick 延迟，
    // 不再有"遍历顺序导致的幽灵先手"（详见 gifts/ 里 Gemini 评审的第二条）。
    for (const m of this.nodes.values()) {
      m.nextActivation = m.activation;
      m.nextCount = m.count;
    }

    /* --- 阶段 0：外部信号源脉冲释放（写入 next） --- */
    this._pulseClock += 1;
    const pulsePeriod = Math.max(
      TUNING.pulsePeriodFloor,
      Math.round(L.pulse.period * (this._ntgBoost > 0 ? this._ntgPeriod : 1))
    );
    if (this._pulseClock >= pulsePeriod) {
      this._pulseClock = 0;
      const src = this.node(L.pulse.node);
      if (src && !src.isMuted) {
        const boost = this._ntgBoost > 0 ? this._ntgFactor : 1;
        const [jLo, jHi] = TUNING.hitJitter;
        const jitter = this.rng.range(jLo, jHi);
        // 读取快照 src.count、写入缓冲 src.nextCount
        src.nextCount = Math.min(L.pulse.cap, src.count + L.pulse.amount * boost * jitter);
        src.flash = 1;
        src.lastHit = true;
      }
    }
    if (this._ntgBoost > 0) this._ntgBoost -= 1;

    /* --- 阶段 1–3：四步结算（读 this 快照、写 next 缓冲） --- */
    for (const rx of this.reactions) {
      if (rx.effect === 'consume') { this._resolveConsume(rx); continue; }
      this._resolveReaction(rx);
    }

    // —— 提交双缓冲：next → this，原子切换，下游读取到的永远是本 tick 的终态 ——
    for (const m of this.nodes.values()) {
      m.activation = m.nextActivation;
      m.count = m.nextCount;
    }

    /* --- 阶段 4：各分子自身的时间推进（衰减，作用于已提交的终态） --- */
    for (const m of this.nodes.values()) m.onTick();

    /* --- 资源池再生 --- */
    for (const [k, v] of Object.entries(L.poolsRegen || {})) {
      this.pools[k] = Math.min(this.poolsMax[k], this.pools[k] + v);
    }

    /* --- 宏观指标演化（钙离子 / 舒张度） --- */
    this._updateMetrics();

    /* --- 胜负判定 --- */
    this._judge();

    this.tickCount += 1;
    this.time = this.tickCount / TPS;

    if (this.tickCount % TUNING.snapshotEvery === 0) this._snapshot();
  }

  /* ------------------------------------------------- 单条反应：四步结算 */
  /** 这是引擎的「心法」 —— 把米氏动力学微分方程降维成桌游规则。
   *
   * 步骤对应 PDF 设计的四步：
   *   ① 锁定目标  —— 比对密码标签 (tags)，不相交则根本不发生碰撞（除非产物反应）
   *   ② 命中判定  —— 掷一个 0–100 的骰子，落进 [lo, lo + 宽度 × 推动力^hill] 就算
   *                 这里 hill 系数（协同性）才是控制响应曲线 S 形陡峭度的关键
   *                 —— 不要被直觉骗去改 power，改了会把曲线压扁成开关
   *   ③ 挂 Buff   —— activate 给目标加激活度（带 buffTicks 倒计时的 Buff）
   *                 inhibit 给目标加沉默；degrade 走 _resolveConsume 槽位竞争
   *   ④ 乘数增量  —— produce 按 amplify 批量产出下游分子，并消耗 GTP
   */
  _resolveReaction(rx: Reaction) {
    const from = this.node(rx.from);
    const to = this.node(rx.to);
    if (!from || !to) return;

    // 第一步 [锁定目标]：比对密码标签，不相交则根本不发生碰撞
    const matched = from.tpl.tags.some((t) => to.tpl.tags.includes(t))
      || (rx.effect === 'produce' && true); // 产物由模板自身标签决定
    if (!matched && rx.from !== to.id) { from.lastHit = false; return; }

    const drive = from.drive;
    if (drive <= 0.0001) { from.lastHit = false; return; }

    // 第二步 [命中判定]：微分方程 → 离散概率。骰子必须落进 [lo, lo + 宽度×推动力]
    const lo = rx.band[0];
    const width = rx.band[1] - rx.band[0];
    const chance = width * Math.pow(drive, rx.hill);
    const roll = this.rng.roll();
    const hit = roll >= lo && roll < lo + chance;

    from.lastHit = hit;
    if (!hit) return;

    const intensity = Math.pow(drive, rx.hill);

    // 第三步 [挂 Buff] / 第四步 [乘数增量]
    if (rx.effect === 'activate') {
      to.applyActivation(rx.power * intensity, to.tpl.buffTicks);
      to.flash = 1;
    } else if (rx.effect === 'inhibit') {
      to.mute(Math.round(rx.power * intensity), rx.label || from.tpl.name);
      to.flash = 1;
    } else if (rx.effect === 'produce') {
      // 全局能量限制：资源池见底时合成停滞（死法 A 的物理基础）。
      // 消耗哪个池由反应自己声明（rx.costPool），引擎不认识「GTP」这个名字 ——
      // 第二关想让合成消耗 ATP，在关卡里配 costPool: 'ATP' 即可，引擎不用改。
      const poolName = rx.costPool || 'GTP';
      const budget = this.pools[poolName] ?? 0;
      const supply = budget > 0 ? 1 : 0;
      const [jLo, jHi] = TUNING.hitJitter;
      let made = rx.amplify * intensity * supply * this.rng.range(jLo, jHi);
      // 能量硬约束（Gemini 评审第三条·1）：产量不能超过当前资源池能负担的量，
      // 杜绝"池子只剩 2 点却白嫖 100 个产物"的透支。
      // 以前 GTP 仅作开关（>0 就满产），现在按 budget / gtpCost 封顶，
      // 能量枯竭会表现为产量平滑衰减，而不是断崖后凭空续命。
      if (rx.gtpCost > 0) made = Math.min(made, budget / rx.gtpCost);
      to.nextCount += made;
      to.lastGain = made;
      to.flash = 1;
      this.pools[poolName] = Math.max(0, budget - made * rx.gtpCost);
    }
  }

  /* ------------------------------------ 槽位竞争降解：竞争性抑制的建模 */
  /**
   * 【这是整个游戏最重要的机制 —— 竞争性抑制】
   *
   * 设想一个酶（PDE5）有固定的处理能力 = `slots × 激活度`。
   * 所有带 `slotTag` 标签的分子按数量比例瓜分这个能力。
   *
   * 关键：不可降解的诱饵（如西地那非）照样占座，但不被清除。
   * → 等于把酶的算力全部浪费在"消化西地那非"上，
   *   真正该降解的 cGMP 因此被"保护"下来，浓度反而上升。
   *
   * 这个机制比"给酶挂沉默 debuff"更真实：
   *   - 它不需要为每个抑制剂写特殊规则，机制是涌现的；
   *   - 西地那非的可调参（剂量、代谢率）自然映射到"占座多少"和"占多久"；
   *   - 玩家能推理出"为什么 PDE5 的槽位总是不够用"，而不只是死记"这个药就是抑制 PDE5 的"。
   */
  _resolveConsume(rx: Reaction) {
    const enzyme = this.node(rx.from);
    if (!enzyme || enzyme.isMuted) return;
    const cap = rx.slots * (enzyme.activation / TUNING.activationMax);
    if (cap <= 0) return;

    const subs = this.nodeList.filter(
      (m) => m.tpl.tags.includes(rx.slotTag) && m.count > 0.01
    );
    if (!subs.length) return;

    const total = subs.reduce((s, m) => s + m.count, 0);
    if (total <= 0) return;

    let processed = 0;
    for (const m of subs) {
      const share = (cap * m.count) / total;           // m.count 取快照，读-改分离
      if (!m.tpl.degradable) { processed += share; continue; } // 占座但不被降解
      const removed = Math.min(m.count, share);
      m.nextCount -= removed;                          // 写入下一帧缓冲
      processed += removed;
    }
    enzyme.lastGain = processed;
    if (processed > 0.5) enzyme.flash = 1;
  }

  /* --------------------------------------------------------- 宏观指标 */
  /** 计算"非分子"性质的派生量：钙离子浓度、平滑肌舒张度等。
   * 这些不在网络中流动，而是网络效应的"读数" —— 玩家看的是它们，关卡胜负也由它们判定。
   *
   * 【以前这里写死了一堆 if (m.id === 'Ca') / else if (m.id === 'Relax')】
   * 现在改由关卡在 METRICS 里声明每条指标的 `kind`，引擎只负责执行三种通式：
   *
   *   driven   被效应器抽走 + 向 base 回归
   *            公式：cur + (base - cur) × restore - 激活度 × drain
   *            典型：Ca 浓度 —— 效应器（MLCP）越活，被抽走得越多
   *            需要：driver / base / drain / restore / min / max
   *
   *   mirror   直接镜像某个分子的数量（默认 kind，不写就是它）
   *            典型：cGMP 浓度 —— 指标值就是 cGMP 分子的个数
   *            需要：driver
   *
   *   derived  由另一个指标换算而来
   *            典型：舒张度 = 100 - Ca
   *            需要：from / transform(值) / min / max
   *
   * 好处：引擎不再认识「Ca」「cGMP」这些名字。做第二关时只用在关卡文件里
   * 挑一种 kind、填参数，不用回来给引擎加新的 if 分支。
   */
  _updateMetrics() {
    for (const m of this.level.metrics) {
      const src = m.driver ? this.node(m.driver) : null;

      if (m.kind === 'driven') {
        const eff = src ? src.activation / TUNING.activationMax : 0;
        const cur = this.metrics[m.id];
        const next = cur + ((m.base ?? 0) - cur) * (m.restore ?? 0) - eff * (m.drain ?? 0);
        this.metrics[m.id] = clamp(next, m.min ?? 0, m.max ?? Infinity);
      } else if (m.kind === 'derived') {
        const from = m.from!;
        const v = this.metrics[from] ?? 0;
        const tf = m.transform!;
        this.metrics[m.id] = clamp(tf(v), m.min ?? 0, m.max ?? 100);
      } else {
        this.metrics[m.id] = src ? src.count : 0;
      }
    }
  }

  /* ------------------------------------------------------ 取值小工具 */
  /** 关卡配置里到处都要"取某个分子/指标/资源池的当前数值"，
   *  统一走这里，省得每个判定分支各写一套。
   *    { kind: 'node',   id: 'cGMP', prop: 'count' | 'activation' }
   *    { kind: 'metric', id: 'Ca' }
   *    { kind: 'pool',   id: 'GTP' }
   */
  _readValue(ref: ValueRef): number {
    if (ref.kind === 'pool') return this.pools[ref.id] ?? 0;
    if (ref.kind === 'metric') return this.metrics[ref.id] ?? 0;
    const n = this.node(ref.id);
    if (!n) return 0;
    return ref.prop === 'activation' ? n.activation : n.count;
  }

  /** 指标 id → 显示名，用于往结算文案里填「钙离子浓度」这样的中文名 */
  _metricName(id: string): string {
    return this.level.metrics.find((m) => m.id === id)?.name ?? id;
  }

  /* --------------------------------------------------------- 胜负判定 */
  /** 每个 tick 调一次。四个结局按顺序检查，命中即停。
   *
   *   ① 稳态恢复（win）  核心指标降到 below 以下并持续 hold 个 tick
   *   ② 能量枯竭         资源池见底并持续 starve.sustainTicks
   *   ③ 脱靶毒性         某分子越过红线并持续 toxicity.sustainTicks
   *   ④ 干预失效         跑满 timeout.ticks 仍未进入安全区
   *
   * 【关键改动：这套配方现在整份来自关卡的 OUTCOME 配置】
   * 以前这里写死了「Ca」「cGMP」「GTP」「190」「20」「40」「0.5」「0.1」，还硬编码了
   * 四段带分子名的中文结算文案。结果就是：做第二关必须回来改引擎，而且极易漏改。
   * 现在引擎只认四种"判定形状"，具体判谁、判多少、持续多久、说什么话，全在关卡文件里。
   *
   * 仍在引擎里的两个机制（换关卡也不会变，所以没搬走）：
   *   · 双缓冲（tick 内读写分离）消除遍历顺序"幽灵先手"；
   *   · 生产按资源池能量封顶，杜绝透支。
   * ⚠️ TODO(配平暂缓)：各类阈值尚未结合双缓冲后的新动力学配平，
   *   目前 5 个标准场景的结局分布还没对齐，留待后续专门配平。
   */
  _judge() {
    const O = this.level.outcome;
    const win = O.win;

    /* ——— 结局 ①：稳态恢复 —— ————————————————————————————————————
     * 除了指标达标，还要求处于"绝对安全"状态（关卡配的 safe 前置）：
     *   本关是「cGMP 未越红线」且「GTP 高于池容 10%」。
     * 二者皆满足才累积胜利进度，否则进度回退。这样"乱灌硝酸甘油"即便短暂把 Ca 打下去，
     * 也会因为它正处于能量/毒性危机中而无法抢先判胜。 */
    const value = this.metrics[win.metric];
    const safe = win.safe.every((c) => this._checkSafe(c));

    if (value <= win.below && safe) {
      this.holdTicks += 1;
      if (this.holdTicks >= win.hold) {
        return this._finish('win', 'homeostasis', {
          metric: this._metricName(win.metric),
          value: value.toFixed(1),
        });
      }
    } else {
      // 没达标就往回掉，掉得比涨得快（slipPerTick）—— 抖动着蒙混过关是不行的
      this.holdTicks = Math.max(0, this.holdTicks - win.slipPerTick);
    }

    /* ——— 结局 ②：能量枯竭 ——————————————————————————————————————— */
    const S = O.starve;
    if ((this.pools[S.pool] ?? 1) <= S.emptyBelow) {
      this.starveTicks += 1;
      if (this.starveTicks >= S.sustainTicks) {
        return this._finish('lose', 'starvation', { pool: S.pool });
      }
    } else this.starveTicks = Math.max(0, this.starveTicks - 1);

    /* ——— 结局 ③：脱靶与毒性（红区超载）—————————————————————————— */
    const T = O.toxicity;
    if (this._readValue(T) >= T.above) {
      this.dangerTicks += 1;
      if (this.dangerTicks >= T.sustainTicks) {
        return this._finish('lose', 'toxicity', {
          node: T.kind === 'metric'
            ? this._metricName(T.id)
            : (this.node(T.id)?.tpl.name ?? T.id),
          redline: T.above,
        });
      }
    } else this.dangerTicks = Math.max(0, this.dangerTicks - 1);

    /* ——— 结局 ④：无响应超时 —— ——————————————————————————————————— */
    if (this.tickCount >= O.timeout.ticks) {
      return this._finish('lose', 'timeout', {
        seconds: (O.timeout.ticks / TPS).toFixed(0),
        metric: this._metricName(win.metric),
      });
    }
  }

  /** 判断一条"安全前置条件"是否成立。
   *   池：当前量 > 池容 × aboveRatio
   *   分子/指标：当前值 < below
   */
  _checkSafe(c: SafeCondition): boolean {
    if (c.kind === 'pool') {
      return (this.pools[c.id] ?? 0) > (this.poolsMax[c.id] ?? 0) * (c.aboveRatio ?? 0);
    }
    return this._readValue(c) < (c.below ?? 0);
  }

  /** 结束本局。标题与详情文案由关卡的 outcomeText 提供，
   *  引擎只负责把运行时的数值（当前值 / 红线 / 秒数 / 分子名）填进 {占位符}。
   *  这样第二关换个结局文案，不用碰引擎一行代码。 */
  _finish(result: Outcome['result'], reason: string, vars: Record<string, string | number> = {}): Outcome {
    const text = this.level.outcomeText?.[reason];
    const title = text?.title ?? reason;
    const detail = fillTemplate(text?.detail ?? '', vars);
    this.outcome = { result, reason, title, detail, time: this.time };
    this.log(`${result === 'win' ? '✔' : '✖'} ${title}`, result === 'win' ? 'win' : 'lose');
    return this.outcome;
  }

  /** 折线图快照。画哪些曲线由关卡的 chart.series 决定 ——
   *  引擎不再写死「要采 cGMP 和 Ca」，第二关想画别的曲线改关卡配置就行。 */
  _snapshot(): void {
    const row: Record<string, number> = { t: this.tickCount };
    for (const s of this.level.chart.series) {
      row[s.key] = this._readValue(s);
    }
    this.history.push(row);
    if (this.history.length > TUNING.historyCap) this.history.shift();
  }

  /* ------------------------------------------------- 玩家侧边栏调参接口 */
  /** 只允许修改模板白名单内的参数（PDF 难点二：80% 写死，20% 开放） */
  setParam(nodeId: string, key: string, value: number): boolean {
    const m = this.node(nodeId);
    if (!m) return false;
    if (!m.tpl.editable.includes(key)) return false;
    (m.tpl as unknown as Record<string, unknown>)[key] = value;
    this.log(`调节 ${m.tpl.name}.${key} = ${value}`, 'param');
    return true;
  }
}

/* ============================================================================
 * 速查：玩家可见的玩法，映射到哪个方法
 * ----------------------------------------------------------------------------
 *   玩家行为               代码路径
 *   点节点查看档案         ui.js → renderer.hitTest() → ui.renderInspector()
 *   拖滑块改参数           ui.js → sim.setParam() → 修改 tpl.editable 内的字段
 *   按 1–4 / 点道具栏      ui.js → sim.applyDrug() → 执行 drug.effects
 *   暂停 / 加速            main.js frame() → sim.paused / sim.speed
 *   投放药物后看到流光     sim.applyDrug() 设 _ntgFactor → tick() 用它放大脉冲
 *   通关结算窗             sim._judge() → sim._finish() → ui.showOutcome()
 *
 * ----------------------------------------------------------------------------
 * 想改东西时，先问「这是引擎机制还是关卡内容」：
 * ----------------------------------------------------------------------------
 *   Buff 衰减倍率 / 抖动幅度 / 激活阈值 / 日志上限  → 本文件 TUNING（影响所有关卡）
 *   判胜阈值 / 红线 / 死法时长 / 结算文案 / 曲线    → pathways/nocgmp.js
 * ==========================================================================*/
