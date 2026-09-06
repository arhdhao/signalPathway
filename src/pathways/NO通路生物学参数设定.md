/* ══════════════════════════════════════════════════════════════════════════
 * ③ BIOLOGY —— 生物网络
 *    ⚠️ 改这里的任何数字都会直接改变模拟行为，改完请跑 tools/balance.mjs 验证。
 * ══════════════════════════════════════════════════════════════════════════*/
 /**
   * 外部信号源：内皮细胞脉冲，每 16 tick（约 1.6 秒）喷一发 NO。
   * 这是整个网络唯一的外部驱动，也是负反馈环赖以振荡的能量输入。
   *   node    往哪个分子里喷
   *   period  喷发间隔（tick）
   *   amount  每发数量（会被硝酸甘油的 boostPulse 放大）
   *   cap     堆积上限，防止无限累积
   */
  pulse: { node: 'NO', period: 16, amount: 30, cap: 90 },

/* 【标签密码体系】决定谁能和谁碰撞 —— 只有共享至少一个标签的分子对才发生反应。
 *   NO_Signal    NO 与 sGC 的对接密码
 *   cGMP_like    cGMP 与 PKG 的结合口袋
 *   PKG_dock     PKG 的底物识别位点（MLCP 与 PDE5 共享 → 旁路串扰的来源）
 *   PDE_Target   PDE5 的降解识别标签（cGMP 与西地那非共享 → 竞争抑制的来源）
 * 「共享标签」是刻意设计：PKG_dock 制造了负反馈，PDE_Target 制造了竞争抑制。
 * 想切断某条通路，改标签比删反应边更符合这套机制的本意。
 */

/**
 * 宏观指标 —— 不在网络中流动，而是网络效应的「读数」。
 * 玩家盯着的是它们，关卡胜负也由它们判定。
 *   id        指标标识（'Ca' 与 'Relax' 在 engine.js 里有特殊处理逻辑）
 *   driver    由哪个分子驱动
 *   base      基准值 / 初始值
 *   drain     每 tick 被效应器抽走的量（Ca 专用）
 *   restore   向基准值回归的速率（Ca 专用）
 */
const METRICS = [
  { id: 'Ca', name: '钙离子浓度', unit: '', base: 100, driver: 'MLCP', drain: 3.2, restore: 0.045, color: '#ff7a6b' },
  { id: 'cGMP', name: 'cGMP 浓度', unit: '', base: 0, driver: 'cGMP', color: '#4dd0c7' },
];

/**
 * 分子 / 节点 —— 每个节点 = 画布上一个框 + 一套动力学参数。
 *
 * 字段速查（★ = 生物属性，会影响模拟；○ = 视觉 / 文本属性，只影响显示）：
 *
 *   id / name / cn   ○ 标识、显示名、中文全名
 *   role             ○ 分类标记（source|messenger|receptor|amplifier|kinase|effector|decoy|donor）
 *   x / y            ○ 画布坐标，来自上面的 LAYOUT
 *   color            ○ 配色，来自上面的 COLORS
 *   desc             ○ 点开节点后显示的档案卡文案
 *
 *   tags             ★ 标签密码，决定能与谁碰撞
 *   drive            ★ 推动力来源：count 数量驱动 / activation 激活度驱动 / pulse 脉冲
 *   K                ★ 半饱和常数：多少个分子能把推动力推到 50%
 *   hill             ★ 协同系数，> 1 表示需要多个分子协同（S 形响应）
 *   band             ★ 命中频段 [lo, hi]，骰子落进这个区间才算命中
 *   decay            ★ 激活度每 tick 的衰减比例
 *   baseDecay        ★ 物质自然降解速率（信使分子用）
 *   amplify          ★ 放大乘数
 *   buffTicks        ★ 一次命中后增益 Buff 持续的 tick 数
 *   degradable       ★ 是否可被降解酶清除。西地那非 = false —— 这是它能「占座不走」的关键
 *   metabolism       ★ 药物被机体清除、退出战场的速率
 *   editable         ★ 允许玩家在侧边栏调节的参数白名单（80/20 规则里的那 20%）
 */
const NODES = [
  {
    id: 'NO', name: 'NO', cn: '一氧化氮', role: 'messenger',
    ...LAYOUT.NO, color: COLORS.NO,
    tags: ['NO_Signal'],
    drive: 'count', K: 30, baseDecay: 0.115,
    editable: ['baseDecay'],
    desc: '由内皮细胞脉冲释放的气体信使。无视细胞膜地形阻挡，但半衰期极短 —— 它来去如风，靠的是「频率」而不是「存量」。',
  },
  {
    id: 'sGC', name: 'sGC', cn: '可溶性鸟苷酸环化酶', role: 'amplifier',
    ...LAYOUT.sGC, color: COLORS.sGC,
    tags: ['NO_Signal', 'receptor_sGC'],
    drive: 'activation', band: [0, 85], decay: 0.015, buffTicks: 18,
    editable: ['band', 'decay'],
    desc: '放大器。接收频段窄、较难被随机碰撞激活；但一旦与 NO 密码匹配，就以极高的放大倍数把 GTP 批量转化成 cGMP。',
  },
  {
    id: 'cGMP', name: 'cGMP', cn: '环磷酸鸟苷', role: 'messenger',
    ...LAYOUT.cGMP, color: COLORS.cGMP,
    tags: ['cGMP_like', 'PDE_Target'],
    drive: 'count', K: 62, baseDecay: 0.022,
    editable: ['baseDecay', 'K'],
    desc: '次级信使。它不靠单打独斗，而是靠庞大的数量去「淹没」下游分子的结合口袋 —— 数量本身就是它的信号强度。',
  },
  {
    id: 'PKG', name: 'PKG', cn: 'cGMP 依赖性蛋白激酶', role: 'kinase',
    ...LAYOUT.PKG, color: COLORS.PKG,
    tags: ['cGMP_like', 'PKG_dock'],
    drive: 'activation', decay: 0.05, buffTicks: 20,
    editable: ['decay'],
    desc: '调控核心。平时休眠，被 cGMP 激活后执行双线任务：主线磷酸化靶蛋白降低钙离子；旁路则顺手唤醒沉默的 PDE5 —— 这是整个死局的种子。',
  },
  {
    id: 'MLCP', name: '靶蛋白', cn: 'MLCP / 钙离子调控复合体', role: 'effector',
    ...LAYOUT.MLCP, color: COLORS.MLCP,
    tags: ['PKG_dock', 'effector'],
    drive: 'activation', decay: 0.085, buffTicks: 12,
    editable: ['decay'],
    desc: '效应器。被 PKG 磷酸化后主动降低胞内钙离子浓度。它的激活度衰减很快 —— PKG 一旦哑火，钙离子立刻反弹。',
  },
  {
    id: 'PDE5', name: 'PDE5', cn: '5 型磷酸二酯酶', role: 'decoy',
    ...LAYOUT.PDE5, color: COLORS.PDE5,
    tags: ['PKG_dock', 'PDE5'],
    drive: 'activation', decay: 0.03, buffTicks: 26,
    editable: ['decay'],
    desc: '负反馈核心。初始休眠，被 PKG 旁路唤醒后，按固定槽位总额降解所有带 PDE_Target 标签的分子。槽位有限 —— 这正是它的弱点。',
  },
  {
    id: 'Sildenafil', name: '西地那非', cn: 'PDE5 竞争性抑制剂', role: 'decoy',
    ...LAYOUT.Sildenafil, color: COLORS.Sildenafil,
    kind: 'drug',
    tags: ['PDE_Target'],
    drive: 'count', K: 200, degradable: false, metabolism: 0.006,
    editable: ['metabolism'],
    desc: '长得和 cGMP 极像的诱饵：拥有相同的 PDE_Target 密码，能被 PDE5 识别结合，但放大乘数为 0 且不可被降解。它凭数量优势塞满 PDE5 的槽位，让酶的算力全部浪费在它身上。',
  },
];

/**
 * 反应边 —— 连线 / 箭头，按 effect 类型决定触发后做什么。
 *
 *   id          边标识
 *   from / to   起点 / 终点分子 id
 *   effect      activate 激活 | inhibit 沉默 | produce 产出 | consume 槽位降解
 *   band        [lo, hi] 命中频段
 *   hill        协同系数 —— 想改响应曲线的陡峭度改这里，不要去改 power
 *   power       activate / inhibit 的力度
 *   amplify     produce 的放大乘数（每 tick 最多产出多少）
 *   gtpCost     每次产出消耗的 GTP（0 = 不耗能量）
 *   slots       consume 专用：酶的处理槽位总量
 *   slotTag     consume 专用：识别底物的标签
 *   negate      ○ 渲染：true 画成抑制样式（虚线 + ⊥ 形封口）
 *   label       ○ 渲染：连线上显示的文字
 *   waypoints   ○ 渲染：折线拐点，来自上面的 WAYPOINTS
 */
const REACTIONS = [
  {
    id: 'r1', from: 'NO', to: 'sGC', effect: 'activate',
    band: [0, 58], hill: 1.4, power: 22, label: '密码匹配',
  },
  {
    id: 'r2', from: 'sGC', to: 'cGMP', effect: 'produce',
    band: [0, 72], hill: 1, amplify: 14, gtpCost: 1.0, label: 'GTP → cGMP',
  },
  {
    id: 'r3', from: 'cGMP', to: 'PKG', effect: 'activate',
    band: [0, 62], hill: 1.6, power: 42, label: '数量淹没',
  },
  {
    id: 'r4', from: 'PKG', to: 'MLCP', effect: 'activate',
    band: [0, 78], hill: 1, power: 48, label: '磷酸化',
  },
  {
    id: 'r5', from: 'PKG', to: 'PDE5', effect: 'activate',
    band: [0, 52], hill: 1.4, power: 30, label: '旁路唤醒',
    waypoints: WAYPOINTS.r5,
  },
  {
    id: 'r6', from: 'PDE5', to: 'cGMP', effect: 'consume',
    slots: 7.5, slotTag: 'PDE_Target', negate: true, label: '槽位降解',
  },
];