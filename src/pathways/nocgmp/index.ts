/* ══════════════════════════════════════════════════════════════════════════
 * 组装车间 —— 按 id 把六层查表合并，拼成引擎认识的扁平结构
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

import type {
  LevelConfig,
  MoleculeTemplateConfig,
  ReactionConfig,
} from '../../engine.js';
import { VIEW } from './01view.js';
import { BIOLOGY } from './02biology.js';
import { TAGS } from './03interaction.js';
import { KINETICS } from './04kinetics.js';
import { RULES, OUTCOME, METRICS, CHART, DRUGS, EDITABLE } from './05game.js';
import { COPY } from './06copy.js';

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
