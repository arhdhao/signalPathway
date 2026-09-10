/* ══════════════════════════════════════════════════════════════════════════
 * ⑤ GAME —— 游戏层
 *    「玩家怎么玩」的一切：时长、胜负、红线、资源、药物、可调参数。
 *    同一套生物学模型，换一套 GAME 就能变成另一个难度 / 另一种玩法。
 *
 *    想调什么来这里：
 *      太难 / 太简单 / 时间不够      → OUTCOME（胜负配方）
 *      药物剂量、机制、数量          → DRUGS
 *      玩家能调哪些滑块              → EDITABLE
 *      指标怎么算 / 曲线画什么        → METRICS / CHART
 * ══════════════════════════════════════════════════════════════════════════*/

import type {
  MetricConfig,
  DrugConfig,
  OutcomeConfig,
  ChartSeries,
} from '../../engine.js';
import { VIEW } from './01view.js';

/**
 * 关卡规则。调难度主要动这一块。
 */
export const RULES = {
  /**
   * 外部信号源：内皮细胞脉冲，每 16 tick（约 1.6 秒）喷一发 NO。
   * 这是整个网络唯一的外部驱动，也是负反馈环赖以振荡的能量输入。
   *   node    往哪个分子里喷
   *   period  喷发间隔（tick）
   *   amount  每发数量（会被硝酸甘油的 boostPulse 放大）
   *   cap     堆积上限，防止无限累积
   */
  pulse: { node: 'NO', period: 16, amount: 30, cap: 90 },

  /**
   * 全局能量池 GTP —— 合成 cGMP 的「货币」。上限就是初始值。
   * 调参血泪史（详见 .workbuddy/memory/2026-09-04.md 与 设计资料/外部AI的建议与评价/ 里的 Gemini 评审）：
   *   · 早期试过 600 / 再生 1.2 → 连基础 sGC 本底合成都把池子烧穿，细胞在正常状态下
   *     也会「饿死」，导致任何玩法都通不了关；且 GTP 因能量守恒封顶而停在低位不再触 0，
   *     能量枯竭死法反而失效，已弃。
   *   · 现取 1000 / 3.0：基础合成 ≈ 再生，稳态可持续。
   *     阈值的最终配平暂缓（见 engine.js 中 _judge 上方的 TODO）。
   */
  pools: { GTP: 1000 },     // 初始能量池 GTP
  poolsRegen: { GTP: 3.0 }, // GTP 再生率
};

/**
 * 胜负判定配方 —— 四个结局的「形状」由引擎提供，数值全在这里。
 *
 * 以前这些东西散落在 engine.js 的 _judge() 里，是写死的裸数字和硬编码分子名
 * （'Ca' / 'cGMP' / 'GTP' / 20 / 40 / 0.5 / 0.1）。现在搬到这里，
 * 引擎只剩「四类判定形状」的通用代码，做第二关复制本文件夹改数据即可。
 *
 *   取值引用统一写法（引擎的 _readValue 认这三种）：
 *     { kind: 'node',   id: 'cGMP', prop: 'count' | 'activation' }
 *     { kind: 'metric', id: 'Ca' }
 *     { kind: 'pool',   id: 'GTP' }
 */
export const OUTCOME: OutcomeConfig = {
  /** ── 结局 ①：稳态恢复（win）──────────────────────────────────────────
   *   metric   判哪个宏观指标（id 对应 METRICS）
   *   below    降到该值以下算达标
   *   hold     连续保持多少 tick 才算赢（50 tick = 5 秒）
   *   slipPerTick 没达标时进度回退多少（比 +1 涨得快，抖动着蒙混过关是不行的）
   *   safe     「绝对安全」前置条件，必须【全部满足】才累积胜利进度。
   *            这是为了防止玩家在"过量致死的瞬间"抢先被判胜：
   *              · cGMP 未越红线 —— 不在过量致死的边缘
   *              · GTP 高于池容 10% —— 细胞代谢底物没被烧穿
   */
  win: {
    metric: 'Ca',
    below: 45,
    hold: 50,
    slipPerTick: 2,
    safe: [
      { kind: 'node', id: 'cGMP', prop: 'count', below: 190 },
      { kind: 'pool', id: 'GTP', aboveRatio: 0.1 },
    ],
  },

  /** ── 结局 ②：能量枯竭（死法 A）───────────────────────────────────────
   *   pool          判哪个资源池
   *   emptyBelow    低于这个值算"见底"
   *   sustainTicks  持续见底多少 tick 才判负（20 tick = 2 秒，留一点缓冲避免抖动误判）
   */
  starve: { pool: 'GTP', emptyBelow: 0.5, sustainTicks: 20 },

  /** ── 结局 ③：脱靶毒性（死法 B，红区超载）─────────────────────────────
   *   above         越过这个值算"越线"
   *   sustainTicks  持续越线多少 tick 才判负（40 tick = 4 秒）
   */
  toxicity: { kind: 'node', id: 'cGMP', prop: 'count', above: 190, sustainTicks: 40 },

  /** ── 结局 ④：干预失效（死法 C，超时）─────────────────────────────────
   *   ticks  跑满多少 tick 仍未进入安全区就判负（2000 tick = 200 秒，
   *          留足余量 —— 正解约 40 秒通关）
   */
  timeout: { ticks: 2000 },
};

/**
 * 宏观指标 —— 不在网络中流动，而是网络效应的「读数」。
 * 玩家盯着的是它们，关卡胜负也由它们判定。
 *
 * ⚠️ 注意这里的 100 / 45 都是【游戏数值】，不是 100 nM 这种真实浓度 —— 别当文献数据看。
 *
 *   id        指标标识。胜负判定（OUTCOME）就是按 id 引用它的
 *   name      显示名（结算文案里的 {metric} 会用到）
 *   kind      ★ 这条指标怎么算。引擎只认三种通式，具体参数跟着 kind 走：
 *               driven   被效应器抽走 + 向 base 回归
 *                        cur + (base - cur) × restore − 激活度 × drain
 *                        例：钙离子 —— 效应器越活，被抽走得越多
 *               mirror   直接镜像某个分子的数量（不写 kind 时就是它）
 *                        例：cGMP 浓度就是 cGMP 分子的个数
 *               derived  由另一个指标换算（配 from + transform 函数）
 *                        例：舒张度 = 100 − Ca
 *   driver    driven / mirror 用：读哪个分子
 *   base      基准值 / 初始值
 *   drain     driven 用：每 tick 被效应器抽走的量
 *   restore   driven 用：向 base 回归的速率
 *   min/max   driven 用：指标被夹在什么区间内
 *   color     ○ 仪表配色
 *
 * 以前这三种算法是写死在 engine.js 里的 if (m.id === 'Ca') 分支，
 * 现在改成关卡声明 kind、引擎执行通式 —— 做第二关不用再回引擎加分支。
 */
export const METRICS: MetricConfig[] = [
  {
    id: 'Ca', name: '钙离子浓度', unit: '', kind: 'driven',
    driver: 'MLCP', base: 100, drain: 3.2, restore: 0.045, min: 0, max: 200,
    color: '#ff7a6b',
  },
  {
    id: 'cGMP', name: 'cGMP 浓度', unit: '', kind: 'mirror',
    driver: 'cGMP', base: 0,
    color: '#4dd0c7',
  },
];

/**
 * 折线图配置 —— 决定右下角那张曲线画什么、纵坐标量程是多少。
 * 引擎每 2 个 tick 按 series 采样一条快照，渲染层按同一份配置画线。
 *
 *   max     纵坐标量程（本关 Ca 与 cGMP 共用同一坐标，所以取同一量程）
 *   series  每条曲线一条记录，字段：
 *             key   存在 history 里的键名（ui.js 读峰值时用的是 h.cGMP）
 *             label 图例文字
 *             color 曲线颜色
 *             dash  线型（canvas setLineDash 数组），不填 = 实线
 *             取值来源三选一（与引擎 _readValue 的约定一致）：
 *               { kind:'node',   id:'cGMP', prop:'count' | 'activation' }
 *               { kind:'metric', id:'Ca' }
 *               { kind:'pool',   id:'GTP' }
 *   想多画一条曲线（比如把 GTP 也画上去），往 series 里加一行即可，
 *   采样和绘制会同时生效，不用改 engine.js 或 render.js。
 *
 * 【这三条激活度曲线为什么能直接共用 0–160 的纵轴】
 *   sGC / PDE5 / PKG 取的是 prop:'activation'（0–100 的激活度），
 *   Ca 是 0–100 的指标、cGMP 是分子计数 —— 实测三者同处一个量级，
 *   没必要开第二套纵轴（双轴最容易让人误读大小关系）。
 *   它们靠「颜色 + 线型」两两区分：实线=浓度/分子数，虚线类=激活度 %。
 */
export const CHART: { max: number; series: ChartSeries[] } = {
  max: 160,
  series: [
    { key: 'Ca', label: 'Ca²⁺', color: '#ff7a6b', kind: 'metric', id: 'Ca' },
    { key: 'cGMP', label: 'cGMP', color: '#4dd0c7', kind: 'node', id: 'cGMP', prop: 'count' },
    // ↓ 新增三条激活度曲线。画布上 sGC 是青色、PDE5 是红色，与上面两条撞色，
    //   所以这里另配色（紫/琥珀/粉），并各配一种线型作为第二重区分。
    { key: 'sGC', label: 'sGC(%)', color: '#b39dff', dash: [7, 4], kind: 'node', id: 'sGC', prop: 'activation' },
    { key: 'PDE5', label: 'PDE5(%)', color: '#ffd479', dash: [2, 3], kind: 'node', id: 'PDE5', prop: 'activation' },
    { key: 'PKG', label: 'PKG(%)', color: '#ff9de2', dash: [10, 3, 2, 3], kind: 'node', id: 'PKG', prop: 'activation' },
  ],
};

/**
 * 玩家可投放的药物。
 *   id       药物标识（applyDrug 用这个）
 *   name/en  中文名 / 英文名
 *   charges  可投放次数
 *   hotkey   快捷键
 *   color    ○ 道具栏按钮的图标色（西地那非复用 VIEW.colors，与画布节点同色）
 *   icon     ○ 图标名，对应 ui.js 里的 ICONS（pill|flask|block|bolt）
 *   desc     ○ 道具栏说明文字
 *   effects  生效机制，可叠加多个：
 *              spawn      直接投放分子实体进战场（target / amount / metabolism）
 *              mute       沉默某个分子若干 tick（target / ticks）
 *              boostPulse 放大外部脉冲（ticks / factor / periodScale）
 *              restore    补充资源池（pool / amount）
 */
export const DRUGS: DrugConfig[] = [
  {
    id: 'sildenafil', name: '西地那非', en: 'Sildenafil', charges: 2, hotkey: '1',
    color: VIEW.colors.Sildenafil, icon: 'pill',
    desc: 'PDE5 竞争性抑制剂。不可降解的诱饵，抢占降解槽位，切断负反馈。',
    effects: [{ kind: 'spawn', target: 'Sildenafil', amount: 620, metabolism: 0.006 }],
  },
  {
    id: 'ntg', name: '硝酸甘油', en: 'Nitroglycerin', charges: 3, hotkey: '2',
    color: '#8fd3ff', icon: 'flask',
    desc: 'NO 供体。80 秒内把内皮的 NO 脉冲幅度提升到 2.2 倍 —— 代价是 GTP 消耗剧增。',
    effects: [{ kind: 'boostPulse', ticks: 90, factor: 2.0, periodScale: 0.55 }],
  },
  {
    id: 'odq', name: 'ODQ', en: 'sGC 抑制剂', charges: 1, hotkey: '3',
    color: '#ffd479', icon: 'block',
    desc: '选择性沉默 sGC。用来验证「上游某分子被阻断后，下游会怎样」这个经典问题。',
    effects: [{ kind: 'mute', target: 'sGC', ticks: 70 }],
  },
  {
    id: 'gtp', name: '能量合剂', en: 'GTP Replenisher', charges: 2, hotkey: '4',
    color: '#7ee08a', icon: 'bolt',
    desc: '补充 400 单位 GTP。当细胞代谢底物被抽干时用它续命。',
    effects: [{ kind: 'restore', pool: 'GTP', amount: 400 }],
  },
];

/**
 * 玩家可调参数白名单（80/20 规则里的那 20%）。
 *
 * 为什么它属于 GAME 而不属于 BIOLOGY / KINETICS：
 *   「玩家允许改哪些旋钮」是玩法设计，不是生物学事实，也不是动力学属性。
 *   同一个生物学模型，在「教学模式」下可以全部开放，在「挑战模式」下只开两个 ——
 *   改这张表就行，② 和 ④ 完全不用动。
 *
 * 数组里没写的字段玩家改不了，这是为了保住「负反馈涌现」所必需的网络结构。
 * 滑块的名称 / 取值范围 / 说明文字定义在 ui.js 的 PARAM_META。
 */
export const EDITABLE: Record<string, string[]> = {
  NO:         ['baseDecay'],
  sGC:        ['band', 'decay'],
  cGMP:       ['baseDecay', 'K'],
  PKG:        ['decay'],
  MLCP:       ['decay'],
  PDE5:       ['decay'],
  Sildenafil: ['metabolism'],
};
