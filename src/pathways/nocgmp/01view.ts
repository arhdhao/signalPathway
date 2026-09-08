/* ══════════════════════════════════════════════════════════════════════════
 * ① VIEW —— 屏幕呈现层
 *    纯视觉。这一层的任何改动都不可能影响模拟结果，可以放心大胆地调。
 *
 *    想改什么来这里：
 *      画面歪了 / 想换配色 / 改连线文字    → layout / colors / edges
 * ══════════════════════════════════════════════════════════════════════════*/

import type {
  MoleculeTemplateConfig,
  ReactionConfig,
} from '../../engine.js';

/** ① VIEW 只负责节点坐标 */
export type NodeLayout = Pick<MoleculeTemplateConfig, 'x' | 'y'>;
/** ① VIEW 只负责连线的显示样式 */
export type RxView = Partial<Pick<ReactionConfig, 'label' | 'negate' | 'waypoints'>>;

export const VIEW: {
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
