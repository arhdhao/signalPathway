/* ============================================================================
 * 入口 —— 装配引擎 / 渲染 / UI，并驱动双时钟主循环
 *   逻辑 10 Hz（固定步长累加器），渲染 60 fps（requestAnimationFrame）
 * ==========================================================================*/

/* 【这个文件做了什么】
 * 它是整个 app 的"启动器"和"主循环"，不存任何游戏逻辑。
 *
 *   · 顶部：导入 Simulator（逻辑）、Renderer + Chart（画图）、UI（仪表盘），
 *           把它们用 level 实例串起来
 *   · 中部：actions 对象 = 玩家动作的统一入口。UI 想暂停/加速/投放/重置，
 *           都调这里的同名方法；不直接碰 sim 或 renderer
 *   · 底部：frame() 函数 —— 每帧被浏览器调一次（约 16ms 一次，即 60 fps）。
 *           它做两件事：
 *             (a) 推进逻辑：根据「距离上次 tick 过了多少毫秒」决定跑几次 sim.tick()
 *             (b) 重绘画面：renderer.draw() 画粒子和节点，chart.draw() 画折线图
 *
 * 为什么叫"双时钟"：逻辑走自己的固定步长（10 Hz），渲染走浏览器的刷新率（60 fps）。
 * 两者解耦后，无论玩家在不在看、屏幕多大，逻辑推演的"故事"都按同样的速度演。
 */

import { Simulator, TICK_MS } from './engine.js';
import { LEVEL_NO_CGMP } from './pathways/nocgmp.js';
import { Renderer, Chart } from './render.js';
import { UI } from './ui.js';

// 加载关卡 NO – sGC – cGMP – PKG – PDE5
const level = LEVEL_NO_CGMP;
// 初始化模拟器
// 参数：
//   level —— 关卡实例，包含所有逻辑和数据
//   seed  —— 随机种子，用于随机数生成
const sim = new Simulator(level, { seed: (Date.now() % 100000) + 7 });
// 初始化渲染器
// 参数：
//   canvas —— 画布元素，用于绘制粒子和节点
//   level  —— 关卡实例，包含所有逻辑和数据
//   sim    —— 模拟器实例，状态
const renderer = new Renderer(document.getElementById('pathway'), level, sim);
// 初始化图表
// 参数：
//   canvas —— 画布元素，用于绘制折线图
//   level  —— 关卡实例，包含所有逻辑和数据
//   sim    —— 模拟器实例，状态
const chart = new Chart(document.getElementById('chart'), level, sim);

const SPEEDS = [1, 2, 4]; // 模拟器倍速选项
let speedIdx = 0; // 当前倍速索引，0 表示 1 倍速

/*
 * 玩家动作的统一入口
 *   togglePause() —— 切换暂停状态
 *   cycleSpeed()  —— 切换倍速
 *   applyDrug(id) —— 投放药物
 *   reset()       —— 重置模拟器
 */
const actions = {
  sim, level, renderer, chart,
  togglePause() {
    sim.paused = !sim.paused;
    ui.refreshPause(sim.paused);
  },
  cycleSpeed() {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    sim.speed = SPEEDS[speedIdx];
    ui.refreshSpeed(sim.speed);
  },
  applyDrug(id) {
    if (sim.outcome) return;
    sim.applyDrug(id);
  },
  reset() {
    sim.reset((Date.now() % 100000) + 7);
    renderer.particles.length = 0;
    renderer.acc.clear();
    ui.hideOutcome();
    ui._buildDock();
    ui._lastLogLen = -1;
    ui.renderInspector();
    sim.paused = false;
    ui.refreshPause(false);
  },
};

/*
 * 初始化 UI
 *   actions —— 玩家动作的统一入口
 */
const ui = new UI(actions);
ui.refreshSpeed(sim.speed);
ui.refreshPause(false);

/* ---------------- 主循环 ---------------- */
/* 【小白版：它就是 cocos 的 update】
 * Cocos 组件有生命周期函数 update(dt)：引擎每帧自动调用它一次，dt 是这一帧过了多久。
 * 这里的 frame(now) 角色相同，只是"喊它的人"从 Cocos 引擎换成了浏览器 ——
 * 文件末尾的 requestAnimationFrame(frame) 让浏览器每帧（约 60fps）调用一次 frame。
 *
 * 唯一区别：cocos 的 update 每帧直接跑逻辑；而这个模拟器的逻辑是
 * "固定步长，100ms 跳一步"（TICK_MS），不能每帧都跳 —— 否则换台刷新率
 * 不同的设备，模拟跑的速度就不一样了。所以要用累加器把真实流逝的时间
 * 攒起来，攒满 100ms 才跑一次 sim.tick()。渲染则仍按每帧走，画面才顺滑。
 */

/** 累加器用到的四个变量：
 *   last   —— 上一次 frame() 的时刻（毫秒，performance.now() 提供）
 *   acc    —— 自上次 sim.tick() 以来积攒的"逻辑时间"（毫秒）
 *   uiAcc  —— 自上次 ui.update() 以来积攒的"UI 刷新时间"（秒，~20Hz）
 *   frames —— 帧计数，每 30 帧触发一次自动 resize
 */
let last = performance.now();
let acc = 0;
let uiAcc = 0;
let frames = 0;

function frame(now) { 
  // 夹住时间步长：标签页切回来时的巨大间隔、或异常时间戳都不该打乱推演
  // raw 是「真实帧间隔」（秒），限制在 0.25s 内（避免帧率过快）
  const raw = Math.max(0, Math.min(0.25, (now - last) / 1000));
  last = now; // now 是当前时间戳（毫秒，performance.now() 提供）

  if (!sim.paused && !sim.outcome) {
    // 累加器循环：把「真实流逝的毫秒 × 倍速」攒进 acc，每攒满 100ms 就跑一步 tick ——
    // 就像每帧往存钱罐丢硬币，丢满 100 分才花一次；倍速只是让丢钱更快。
    // guard < 12 防止一帧内跑出几百步把浏览器卡死。
    acc += raw * 1000 * sim.speed;
    let guard = 0;
    while (acc >= TICK_MS && guard < 12) {
      sim.tick();
      acc -= TICK_MS;
      guard += 1;
      if (sim.outcome) break;
    }
    if (sim.outcome) {
      ui.showOutcome();
    }
  }

  // 低频自适应：容器尺寸变化（窗口缩放 / 首帧布局未就绪）时重建画布
  if (++frames % 30 === 0) {
    renderer.autoResize();
    chart.autoResize();
  }

  // 注意 raw 用的是「实际帧间隔」而不是 sim.tick 的固定 100ms：
  // 粒子位置要按真实经过的时间插值，看起来才"顺"而不是"跳"
  renderer.draw(raw * (sim.paused ? 0 : sim.speed));
  chart.draw();

  // DOM 仪表盘降到 ~20 Hz 刷新，避免每帧写 DOM
  uiAcc += raw;
  if (uiAcc >= 0.05) { ui.update(); uiAcc = 0; }

  requestAnimationFrame(frame); // 递归调用，实现帧率控制
}
requestAnimationFrame(frame); // 启动主循环

/* ---------------- 调试出口 ---------------- */
/* 打包后每个模块都被包进 IIFE（见 tools/build.js），各文件的顶层 const 不再
 * 暴露到全局 —— 好处是彻底消除命名冲突，代价是浏览器控制台访问不到内部对象了。
 * 这里显式挂一份到 window，把调试能力补回来：
 *   __sim.sim.metrics.Ca           当前钙离子浓度
 *   __sim.sim.node('cGMP')         任意分子的实时状态
 *   __sim.actions.applyDrug('ntg') 手动投放药物做实验
 * 仅在浏览器环境生效；Node 下的配平脚本（tools/*.mjs）走的是 ESM，不会经过这里。 */
if (typeof window !== 'undefined') {
  window.__sim = { sim, level, renderer, chart, actions };
}
