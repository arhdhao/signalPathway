/* ============================================================================
 * Level 01 — NO / sGC / cGMP / PKG / PDE5  血管舒张通路
 * ----------------------------------------------------------------------------
 * 对照 KEGG map04022（cGMP-PKG 通路）+ 临床经典案例：西地那非竞争性抑制 PDE5。
 * ==========================================================================*/

/* ╔═══════════════════════════════════════════════════╗
 * ║  这个文件怎么读 —— 六层数据 + 一个组装车间              ║
 * ╚═══════════════════════════════════════════════════╝
 *
 *  ① VIEW        屏幕上长什么样   画布尺寸 / 坐标 / 配色 / 连线样式
 *  ② BIOLOGY     谁是谁、谁影响谁  分子档案 + 反应关系（⚠️ 这一层没有数字）
 *  ③ INTERACTION 谁能和谁碰撞      标签密码表
 *  ④ KINETICS    多强、多快、多少  半饱和 / 衰减 / 频段 / 放大 / 槽位
 *  ⑤ GAME        玩家怎么玩        关卡规则 / 宏观指标 / 药物 / 可调参数白名单
 *  ⑥ COPY        文案              简报 / 提示 / 结算小知识
 *
 *  文件末尾的「组装车间」把上面六层按 id 拼成引擎认识的 NODES / REACTIONS，
 *  它自己不含任何数据 —— 只是查表、合并、排序。
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  为什么要把一个节点拆成六处？
 * ───────────────────────────────────────────────────────────────────────────
 *  以前 NO 的全部信息挤在一个对象里：名字、坐标、颜色、标签、衰减率、可调参数
 *  全写在一起。问题是「改布局」和「改平衡」是两种完全不同的动机，却被绑在同一段
 *  代码上 —— 想统一挪动七个节点，得在几十行里翻找 x / y；想换配色，得小心别
 *  手滑改到 baseDecay。
 *
 *  现在按「变化的理由」切分：改颜色只会碰 VIEW，改手感只会碰 KINETICS。
 *  改坐标不可能影响模拟结果，改衰减率也不可能让画面歪掉。
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  看到一个参数，问自己一句话，就知道它该放哪层
 * ───────────────────────────────────────────────────────────────────────────
 *    「谁影响谁？」                 → ② BIOLOGY      例：PKG → PDE5
 *    「谁有资格和谁碰？」            → ③ INTERACTION  例：PDE_Target 标签
 *    「影响有多强、多快、多容易？」   → ④ KINETICS     例：hill = 1.4 / decay = 0.05
 *    「玩家怎么玩、怎样算赢？」       → ⑤ GAME         例：Ca 目标 45 / 药物 4 种
 *    「屏幕上长什么样？」            → ① VIEW         例：x = 630 / 紫色
 *    「界面上写什么字？」            → ⑥ COPY
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  想调什么 → 去哪一层
 * ───────────────────────────────────────────────────────────────────────────
 *    画面歪了 / 想换配色 / 改连线文字    → ① VIEW
 *    加一个分子 / 加一条反应 / 改机制    → ② BIOLOGY（先改这里，再去 ④ 补数字）
 *    让两个分子不再互相碰撞              → ③ INTERACTION（删标签比删反应边更符合机制本意）
 *    太难 / 太简单 / 时间不够            → ⑤ GAME.outcome（胜负配方）
 *    分子动力学、反应强度                → ④ KINETICS
 *    药物剂量、机制、数量                → ⑤ GAME.drugs
 *    玩家能调哪些滑块                    → ⑤ GAME.editable
 *    指标怎么算 / 曲线画什么              → ⑤ GAME.metrics / chart
 *    结算弹窗写什么话                    → ⑥ COPY.outcomeText
 *    改教学文案                          → ⑥ COPY
 *
 *    ⚠️ 引擎手感（Buff 衰减倍率、随机抖动、激活阈值等）不在本文件，
 *       它们在 src/engine.js 顶部的 TUNING —— 而且改了会影响所有关卡。
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  ⚠️ 本次改动只挪位置，不挪数字
 * ───────────────────────────────────────────────────────────────────────────
 *  这次重构的要求是「架构改变 ≠ 模拟规则改变」。改完后两件事应当完全一致：
 *    node tools/balance.mjs sweep     ← 10 个随机种子的结局分布
 *    node tools/balance.mjs           ← 5 个标准场景的推演过程
 *  如果数字变了，说明组装车间漏搬了字段，回去查 NODE_ORDER / REACTION_ORDER。
 *  改完请务必跑：
 *    node tools/build.js && node tools/smoke.mjs
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  做第二关的正确姿势
 * ───────────────────────────────────────────────────────────────────────────
 *  复制本文件改数据即可。引擎 / 渲染器 / UI 都不用动：
 *    · 分子与拓扑       → ② BIOLOGY + ③ INTERACTION + ④ KINETICS
 *    · 指标怎么算       → ⑤ METRICS 里挑 kind（driven / mirror / derived）
 *    · 判胜判负         → ⑤ OUTCOME（换指标、换分子、换阈值都在这一张表）
 *    · 结算文案         → ⑥ COPY.outcomeText
 *    · 曲线画什么       → ⑤ CHART.series
 *  这样第二关消耗 ATP 而不是 GTP、判的是别的分子、死法也完全不同，都不用改 engine.js。
 */

/* ══════════════════════════════════════════════════════════════════════════
 * ① VIEW —— 屏幕呈现层
 *    纯视觉。这一层的任何改动都不可能影响模拟结果，可以放心大胆地调。
 * ══════════════════════════════════════════════════════════════════════════*/

import type {
  LevelConfig,
  MoleculeTemplateConfig,
  ReactionConfig,
  MetricConfig,
  DrugConfig,
  OutcomeConfig,
  ChartSeries,
} from '../engine.js';

/* ---------------------------------------------------------------------------
 * 层类型别名 —— 六层各存一份「只属于自己的字段子集」。
 * 用引擎的类型约束每层字面量，既保留字面量（role/effect/drive 不会被拓宽成 string），
 * 又让「组装车间」能按字符串索引而不报 TS7053，还让每层的键/取值都受编译期校验。
 * --------------------------------------------------------------------------- */
type NodeLayout = Pick<MoleculeTemplateConfig, 'x' | 'y'>;                    // ① VIEW 坐标
type NodeBio = Pick<MoleculeTemplateConfig, 'name' | 'cn' | 'role' | 'kind' | 'desc'>; // ② BIOLOGY 档案
type NodeKin = Partial<Omit<MoleculeTemplateConfig, 'id' | 'name'>>;          // ④ KINETICS 分子动力学
type RxBio = Pick<ReactionConfig, 'from' | 'to' | 'effect'>;                  // ② BIOLOGY 反应拓扑
type RxKin = Partial<Omit<ReactionConfig, 'from' | 'to' | 'effect'>>;         // ④ KINETICS 反应动力学
type RxView = Partial<Pick<ReactionConfig, 'label' | 'negate' | 'waypoints'>>; // ① VIEW 连线样式

const VIEW: {
  canvas: { w: number; h: number };
  layout: Record<string, NodeLayout>;
  colors: Record<string, string>;
  edges: Record<string, RxView>;
} = {
  /** 设计稿逻辑坐标。渲染层会按容器实际尺寸自动缩放，所以这里填设计稿尺寸即可。 */
  canvas: { w: 1000, h: 400 },

  /**
   * 节点在画布上的位置（设计稿坐标，不是像素）。
   * 布局思路：主干 NO → sGC → cGMP → PKG → MLCP 横排一行（y = 95）；
   *           负反馈支路 PDE5 与药物西地那非放在下方（y = 290）。
   * 想整体挪动或重排，改这里七行就够了 —— 不用去别的层里一个个找 x / y。
   */
  layout: {
    NO:         { x: 215, y: 95 },
    sGC:        { x: 350, y: 95 },
    cGMP:       { x: 490, y: 95 },
    PKG:        { x: 630, y: 95 },
    MLCP:       { x: 770, y: 95 },
    PDE5:       { x: 490, y: 290 },
    Sildenafil: { x: 300, y: 290 },
  },

  /**
   * 节点配色 —— 语义色，不是随便挑的：
   *   蓝青  信使分子（NO / sGC / cGMP）
   *   紫    激酶（PKG）
   *   黄    效应器（MLCP）
   *   红    负反馈与红线相关（PDE5）
   *   粉    药物（西地那非）
   * 画布上的节点与右侧道具栏的按钮共用这里的色值，改一处两边同步。
   */
  colors: {
    NO: '#8fd3ff',
    sGC: '#4dd0c7',
    cGMP: '#5ee0c8',
    PKG: '#b39dff',
    MLCP: '#ffd479',
    PDE5: '#ff7a6b',
    Sildenafil: '#ff9de2',
  },

  /**
   * 反应边的显示样式（不填就是默认的实线 + 普通箭头）。
   * 为什么连线文字放这里而不是 BIOLOGY：
   *   BIOLOGY 里的「PKG → PDE5 + activate」已经把生物学事实说清楚了；
   *   画布上那句「旁路唤醒」是给玩家看的游戏化短标签，属于呈现。
   *   negate   true 画成抑制样式（虚线 + ⊥ 形封口）
   *   label    连线上显示的文字
   *   waypoints 折线拐点
   */
  edges: {
    r1: { label: '密码匹配' },
    r2: { label: 'GTP → cGMP' },
    r3: { label: '数量淹没' },
    r4: { label: '磷酸化' },
    // 这条要绕行，否则箭头会穿过主干那一排节点
    r5: {
      label: '旁路唤醒',
      waypoints: [{ x: 630, y: 200 }, { x: 630, y: 290 }],
    },
    r6: { label: '槽位降解', negate: true },
  },
};

/* ══════════════════════════════════════════════════════════════════════════
 * ② BIOLOGY —— 生物学事实层
 *    ⚠️ 这一层【一个数字都不能有】。
 *    它只回答「谁是谁」和「谁影响谁」。至于影响多强、多快，那是 ④ KINETICS 的事。
 *
 *    这样分的好处：以后查到真实文献数据（比如 NO 的半衰期），
 *    改的是 KINETICS 里的 baseDecay，而「NO 激活 sGC」这个生物学事实纹丝不动。
 * ══════════════════════════════════════════════════════════════════════════*/

const BIOLOGY: {
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
   * 想加一条新通路：这里加一行 → ③ 给两端配好标签 → ④ 补动力学数字。
   * 想「切断」一条通路：优先去 ③ 把共享标签摘掉，而不是删这行 ——
   * 删行等于这个生物学关系不存在了，摘标签只是让它碰不上，后者更符合引擎机制的本意。
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

/* ══════════════════════════════════════════════════════════════════════════
 * ③ INTERACTION —— 碰撞资格层（标签密码表）
 *
 *    这一层回答「谁有资格和谁发生作用」。它既不是纯生物学（密码是我们抽象出来的
 *    游戏机制），也不是动力学（这里依然没有数字），所以单独占一层。
 *
 *    规则：两个分子只要【共享至少一个标签】，就可能发生碰撞。
 *
 *    NO_Signal    NO 与 sGC 的对接密码
 *    cGMP_like    cGMP 与 PKG 的结合口袋
 *    PKG_dock     PKG 的底物识别位点（MLCP 与 PDE5 共享 → 旁路串扰的来源）
 *    PDE_Target   PDE5 的降解识别标签（cGMP 与西地那非共享 → 竞争抑制的来源）
 *
 *    「共享标签」是刻意设计，不是偷懒：
 *      · MLCP 与 PDE5 共享 PKG_dock  → 制造了负反馈（PKG 一手救火一手点火）
 *      · cGMP 与西地那非共享 PDE_Target → 制造了竞争抑制（两个底物抢同一批槽位）
 *    想让 PDE5 不再误伤 cGMP，改标签比改反应边更符合这套机制的本意。
 * ══════════════════════════════════════════════════════════════════════════*/

const TAGS: Record<string, string[]> = {
  NO:         ['NO_Signal'],
  sGC:        ['NO_Signal', 'receptor_sGC'],
  cGMP:       ['cGMP_like', 'PDE_Target'],
  PKG:        ['cGMP_like', 'PKG_dock'],
  MLCP:       ['PKG_dock', 'effector'],
  PDE5:       ['PKG_dock', 'PDE5'],
  Sildenafil: ['PDE_Target'],
};

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
 * ══════════════════════════════════════════════════════════════════════════*/

const KINETICS: {
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

/* ══════════════════════════════════════════════════════════════════════════
 * ⑤ GAME —— 游戏层
 *    「玩家怎么玩」的一切：时长、胜负、红线、资源、药物、可调参数。
 *    同一套生物学模型，换一套 GAME 就能变成另一个难度 / 另一种玩法。
 * ══════════════════════════════════════════════════════════════════════════*/

/**
 * 关卡规则。调难度主要动这一块。
 */
const RULES = {
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
   * 调参血泪史（详见 .workbuddy/memory/2026-09-04.md 与 gifts/ 里的 Gemini 评审）：
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
 * 引擎只剩「四类判定形状」的通用代码，做第二关复制本文件改数据即可。
 *
 *   取值引用统一写法（引擎的 _readValue 认这三种）：
 *     { kind: 'node',   id: 'cGMP', prop: 'count' | 'activation' }
 *     { kind: 'metric', id: 'Ca' }
 *     { kind: 'pool',   id: 'GTP' }
 */
const OUTCOME: OutcomeConfig = {
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
const METRICS: MetricConfig[] = [
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
 *             取值来源三选一（与引擎 _readValue 的约定一致）：
 *               { kind:'node',   id:'cGMP', prop:'count' | 'activation' }
 *               { kind:'metric', id:'Ca' }
 *               { kind:'pool',   id:'GTP' }
 *   想多画一条曲线（比如把 GTP 也画上去），往 series 里加一行即可，
 *   采样和绘制会同时生效，不用改 engine.js 或 render.js。
 */
const CHART: { max: number; series: ChartSeries[] } = {
  max: 160,
  series: [
    { key: 'Ca', label: 'Ca²⁺', color: '#ff7a6b', kind: 'metric', id: 'Ca' },
    { key: 'cGMP', label: 'cGMP', color: '#4dd0c7', kind: 'node', id: 'cGMP', prop: 'count' },
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
const DRUGS: DrugConfig[] = [
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
const EDITABLE: Record<string, string[]> = {
  NO:         ['baseDecay'],
  sGC:        ['band', 'decay'],
  cGMP:       ['baseDecay', 'K'],
  PKG:        ['decay'],
  MLCP:       ['decay'],
  PDE5:       ['decay'],
  Sildenafil: ['metabolism'],
};

/* ══════════════════════════════════════════════════════════════════════════
 * ⑥ COPY —— 文案层
 *    纯文本，改这里不影响任何逻辑。
 * ══════════════════════════════════════════════════════════════════════════*/

const COPY = {
  /** 关卡简报：开场弹窗与检查器默认页显示 */
  brief:
    '内皮细胞脉冲释放 NO，激活 sGC 大量合成 cGMP，cGMP 激活 PKG 后降低钙离子浓度、使平滑肌舒张。' +
    '但 PKG 会旁路唤醒 PDE5，反过来降解 cGMP —— 一个典型的负反馈自限环路。' +
    '你的任务：让钙离子浓度降到 45 以下并稳定维持 3 秒。',

  /** 开场提示：引导玩家先观战再动手 */
  hint:
    '先别急着给药，观战一会儿。你会看到 cGMP 冲高、PKG 亮起、钙离子开始下降……然后 PDE5 苏醒，一切反弹回去。',

  /** 结算窗里展示的关卡小知识（教学点） */
  lessons: [
    '负反馈不是 bug，是细胞防止信号过载的保护机制。PDE5 的存在让血管不会一直舒张下去。',
    '西地那非并不「增强」任何东西 —— 它只是让 PDE5 的算力被无效占用。竞争性抑制的本质是抢占。',
    'NO 供体（硝酸甘油）让信号更强，但 cGMP 合成要消耗 GTP。推得太猛，细胞会被自己的代谢拖垮。',
    '临床上西地那非与硝酸甘油绝对禁忌联用，正是因为它们叠加会造成顽固性低血压 —— 这一关里这就是「死法 B」。',
  ],

  /**
   * 四种结局的标题与详情文案。
   * 以前这些句子硬编码在 engine.js 里，还带着 cGMP / GTP / 2000 秒这样的具体数值 ——
   * 引擎为了说一句话，就得认识这些名字。现在文案回到关卡，运行时数值用 {占位符} 注入，
   * 引擎只管填，不管内容。
   *
   * 可用占位符（由 engine.js 的 _judge() 提供）：
   *   homeostasis  {metric} 核心指标显示名   {value} 达标时的当前值
   *   starvation   {pool}   被抽干的资源池名
   *   toxicity     {node} 越线分子名         {redline} 红线值
   *   timeout      {seconds} 总时长（秒）     {metric} 核心指标显示名
   * 键名必须对应 _judge() 里的 reason：homeostasis / starvation / toxicity / timeout。
   */
  outcomeText: {
    homeostasis: {
      title: '稳态恢复',
      detail: '{metric}稳定在 {value}，平滑肌充分舒张。你在不摧毁网络的前提下切断了负反馈。',
    },
    starvation: {
      title: '能量枯竭',
      detail: '{pool} 池被抽干，依赖它的合成反应全部停摆，细胞进入静默。你给药过猛，把细胞的代谢底物烧光了。',
    },
    toxicity: {
      title: '脱靶毒性',
      detail: '{node} 浓度突破 {redline} 红线并居高不下。{node} 过量引发顽固性低血压，系统崩溃。',
    },
    timeout: {
      title: '干预失效',
      detail: '{seconds} 秒内 {metric} 从未进入安全区间。负反馈牢牢锁死了这条通路。',
    },
  },
};

/* ══════════════════════════════════════════════════════════════════════════
 * 组装车间 —— 按 id 把上面六层查表合并，拼成引擎认识的扁平结构
 *
 *  这里唯一的「逻辑」是两次 map：按 id 去各层取该节点 / 该反应的那一份，
 *  摊平成一个对象。它不含任何数据，也不做任何计算。
 *
 *  ⚠️ 两个 ORDER 数组的顺序是有意义的，不要随手重排：
 *    · NODE_ORDER     决定画布的绘制顺序（后面的盖在前面的上面）
 *    · REACTION_ORDER 决定每个 tick 里反应的结算顺序，而结算会消耗随机数 ——
 *                     顺序一变，整局推演的结果就变了（哪怕参数一个没改）
 *
 *  clean() 的作用：把「这一层没写」的字段整个删掉，而不是塞一个 undefined 进去。
 *  因为引擎里 MoleculeTemplate / Reaction 是用 Object.assign(默认值, 配置) 建的，
 *  如果配置里带了 undefined，会把默认值覆盖成 undefined，渲染时可能炸。
 * ══════════════════════════════════════════════════════════════════════════*/

const NODE_ORDER = ['NO', 'sGC', 'cGMP', 'PKG', 'MLCP', 'PDE5', 'Sildenafil'];
const REACTION_ORDER = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];

/** 去掉值为 undefined 的键，好让引擎里的类默认值正常生效 */
const clean = <T extends object>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

const NODES: MoleculeTemplateConfig[] = NODE_ORDER.map((id) => clean({
  id,
  ...BIOLOGY.nodes[id],   // name / cn / role / kind / desc   ← ②
  ...VIEW.layout[id],     // x / y                            ← ①
  color: VIEW.colors[id], // 配色                             ← ①
  tags: TAGS[id],         // 标签密码                          ← ③
  ...KINETICS.nodes[id],  // drive / K / decay / baseDecay / … ← ④
  editable: EDITABLE[id], // 玩家可调白名单                    ← ⑤
}));

const REACTIONS: ReactionConfig[] = REACTION_ORDER.map((id) => clean({
  id,
  ...BIOLOGY.reactions[id],  // from / to / effect                          ← ②
  ...KINETICS.reactions[id], // band / hill / power / amplify / slots / …    ← ④
  ...VIEW.edges[id],         // label / negate / waypoints                   ← ①
}));

/* ───────────────────────────────────────────────────────────────────────────
 * 最终导出：这就是引擎拿到的关卡对象
 *
 * 注意底下这三个字段是【派生】的，不是新数据：
 *   goal / redline / timeout 由 OUTCOME 反推出来，只为了让 ui.js 和 render.js
 *   继续用它们原来的写法（仪表盘要画目标线、说明窗要写"突破 XX 红线"）。
 *   真正的唯一数据源是 OUTCOME —— 改胜负条件请去改它，别改这三个。
 *   等哪天把 ui.js / render.js 也改成直接读 outcome，这三个就可以删掉了。
 * ───────────────────────────────────────────────────────────────────────────*/
export const LEVEL_NO_CGMP: LevelConfig = {
  id: 'no-cgmp',
  name: '第一关 · 血管舒张',
  subtitle: 'NO – sGC – cGMP – PKG – PDE5',

  canvas: VIEW.canvas,

  ...RULES,
  timeout: OUTCOME.timeout.ticks,
  goal: {
    metric: OUTCOME.win.metric,
    target: OUTCOME.win.below,
    hold: OUTCOME.win.hold,
  },
  // 键名用 OUTCOME.toxicity.id，这样红线的名字也只有一个来源
  redline: { [OUTCOME.toxicity.id]: OUTCOME.toxicity.above },

  metrics: METRICS,
  nodes: NODES,
  reactions: REACTIONS,
  drugs: DRUGS,

  chart: CHART,
  outcome: OUTCOME,

  ...COPY,
};

export default LEVEL_NO_CGMP;
