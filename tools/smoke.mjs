/* ============================================================================
 * 冒烟测试：在 Node 里用 DOM / Canvas 桩真实执行打包后的 JS
 *   能抓出「元素 id 写错」「方法不存在」「装配顺序错误」这类低级但致命的问题
 *   node tools/smoke.mjs
 * ==========================================================================*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'dist', '信号通路模拟器.html'), 'utf8');
const code = html.match(/<script>([\s\S]*)<\/script>/)[1];

const errors = [];
const noop = () => {};
const drawStats = {};

function makeCtx() {
  const store = {};
  return new Proxy(store, {
    get(t, k) {
      if (k === 'canvas') return { width: 900, height: 400 };
      if (k in t) return t[k];
      return (...a) => { drawStats[k] = (drawStats[k] || 0) + 1; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

const listeners = {};
function makeEl(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    style: {}, dataset: {}, children: [], _html: '', _text: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 400 }),
    addEventListener: noop,
    appendChild(c) { this.children.push(c); return c; },
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    remove: noop,
    focus: noop,
  };
  Object.defineProperty(el, 'innerHTML', { get() { return this._html; }, set(v) { this._html = String(v); } });
  Object.defineProperty(el, 'textContent', { get() { return this._text; }, set(v) { this._text = String(v); } });
  el.parentElement = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 400 }),
  };
  return el;
}

const registry = new Map();
const document = {
  getElementById(id) {
    if (!registry.has(id)) registry.set(id, makeEl());
    return registry.get(id);
  },
  createElement: (t) => makeEl(t),
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  addEventListener: noop,
};
registry.set('pathway', makeEl('canvas'));
registry.set('chart', makeEl('canvas'));

let rafCb = null;
// 虚拟时钟：必须与传给帧回调的时间戳同源，否则 dt 会算成负数
let vnow = 0;
const sandbox = {
  document,
  window: {
    devicePixelRatio: 1,
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
  },
  requestAnimationFrame: (cb) => { rafCb = cb; return 1; },
  performance: { now: () => vnow },
  console,
  Math, Date, JSON, Object, Array, String, Number, Boolean, Map, Set, Error,
  parseFloat, parseInt, isNaN, Infinity, NaN, undefined,
};
sandbox.globalThis = sandbox;
sandbox.window.document = document;

try {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'bundle.js' });
  console.log('  ✔ 装配成功：引擎 / 渲染 / UI 全部初始化，无异常');
} catch (e) {
  console.error('  ✖ 装配失败:', e.message, '\n', e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

// 步进主循环，模拟 60 秒推演
try {
  let frames = 0;
  const FRAME_MS = 1000 / 60;
  while (rafCb && frames < 7200) {
    const cb = rafCb; rafCb = null;
    vnow += FRAME_MS;
    cb(vnow);
    frames += 1;
  }
  console.log(`  ✔ 主循环稳定运行 ${frames} 帧（约 ${(frames / 60).toFixed(0)} 秒推演）`);
} catch (e) {
  console.error('  ✖ 主循环异常:', e.message, '\n', e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

// 验证结算弹窗被正确渲染
const modal = registry.get('modalCard');
if (modal && modal._html.includes('badge')) {
  console.log('  ✔ 结算流程已触发并渲染（检测到结果徽章）');
} else {
  console.log('  · 本次跑动未产生结局（可能仍在推演中）');
}

// 验证道具栏与检查器渲染
const dock = registry.get('dock');
if (dock && dock._html.includes('西地那非')) console.log('  ✔ 道具栏渲染正常（4 种道具）');
else { console.error('  ✖ 道具栏未渲染'); process.exit(1); }

const insp = registry.get('inspector');
if (insp && insp._html.includes('负反馈')) console.log('  ✔ 检查器默认渲染关卡简报');
else { console.error('  ✖ 检查器未渲染'); process.exit(1); }

// 渲染管线体检：确认真的在往画布上画东西，而不是静默空转
const need = { fillText: '分子名称/标签', stroke: '连线与边框', arc: '粒子', fill: '节点填充', setTransform: '画布变换' };
console.log('\n  Canvas 绘制调用统计：');
let drawOk = true;
for (const [fn, what] of Object.entries(need)) {
  const n = drawStats[fn] || 0;
  const ok = n > 0;
  if (!ok) drawOk = false;
  console.log(`   ${ok ? '✔' : '✖'} ${fn.padEnd(13)} ${String(n).padStart(7)} 次   (${what})`);
}
const particleDraws = (drawStats.arc || 0) + (drawStats.fill || 0);
console.log(`   · 粒子/节点绘制合计 ${particleDraws} 次，折线图 fillText ${drawStats.fillText || 0} 次`);
if (!drawOk) { console.error('\n  ✖ 渲染管线未产生绘制调用'); process.exit(1); }

console.log('\n  全部冒烟测试通过。');
