/* ============================================================================
 * 自动配平：网格搜索满足全部五种结局的参数组合
 *   node tools/sweep.mjs
 * ==========================================================================*/
import { Simulator, TPS } from '../build/engine.js';
import { LEVEL_NO_CGMP as BASE } from '../build/pathways/nocgmp.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

/** 把一组待测参数写进关卡副本 */
function tweak(t) {
  const L = clone(BASE);
  const find = (id) => L.nodes.find((n) => n.id === id);
  find('sGC').band = [0, t.sgcBand];
  find('cGMP').baseDecay = t.cgmpDecay;
  L.reactions.find((r) => r.id === 'r2').amplify = t.amplify;
  L.reactions.find((r) => r.id === 'r6').slots = t.slots;
  return L;
}

function runOnce(L, plan, seed, maxTicks = 950) {
  const sim = new Simulator(L, { seed });
  let minCa = 999, maxG = 0;
  for (let i = 0; i < maxTicks; i++) {
    for (const [at, d] of plan) if (i === at) sim.applyDrug(d);
    sim.tick();
    if (sim.outcome) break;
    if (sim.metrics.Ca < minCa) minCa = sim.metrics.Ca;
    const g = sim.node('cGMP').count;
    if (g > maxG) maxG = g;
  }
  return {
    reason: sim.outcome ? sim.outcome.reason : 'timeout',
    time: sim.time,
    minCa, maxG,
    gtp: sim.pools.GTP,
  };
}

const SEEDS = [11, 20260904, 777];
const multi = (L, plan) => SEEDS.map((s) => runOnce(L, plan, s));

/* 期望的结局契约 */
const CONTRACT = [
  { key: 'idle', label: '不干预', plan: [], want: (r) => r.reason === 'timeout' && r.minCa > 54 },
  { key: 'sild', label: '西地那非@25s', plan: [[250, 'sildenafil']], want: (r) => r.reason === 'homeostasis' && r.time < 70 },
  { key: 'ntg', label: '硝酸甘油×3', plan: [[100, 'ntg'], [180, 'ntg'], [260, 'ntg']], want: (r) => r.reason === 'starvation' },
  { key: 'tox', label: '西地+硝甘', plan: [[120, 'sildenafil'], [140, 'ntg'], [220, 'ntg'], [300, 'ntg']], want: (r) => r.reason === 'toxicity' },
  { key: 'odq', label: 'ODQ 沉默', plan: [[100, 'odq']], want: (r) => r.reason === 'timeout' && r.minCa > 54 },
];

function score(L, verbose = false) {
  let pass = 0;
  const detail = [];
  for (const c of CONTRACT) {
    const rs = multi(L, c.plan);
    const ok = rs.filter(c.want).length;
    const need = Math.ceil(SEEDS.length * 0.66); // 至少 2/3 种子满足
    const good = ok >= need;
    if (good) pass += 1;
    detail.push({ c, ok, good, rs });
  }
  if (verbose) {
    for (const d of detail) {
      const r0 = d.rs[0];
      console.log(
        `  ${d.good ? '✔' : '✖'} ${d.c.label.padEnd(14)} 满足 ${d.ok}/${SEEDS.length}` +
        `  结局=${r0.reason.padEnd(12)} 最低Ca=${r0.minCa.toFixed(1).padStart(5)}` +
        ` 峰值cGMP=${r0.maxG.toFixed(0).padStart(4)} GTP余=${r0.gtp.toFixed(0).padStart(5)} 用时=${r0.time.toFixed(0)}s`
      );
      if (!d.good) {
        console.log('     各种子: ' + d.rs.map((r) => `${r.reason}(Ca${r.minCa.toFixed(0)},G${r.maxG.toFixed(0)},T${r.time.toFixed(0)})`).join('  '));
      }
    }
  }
  return { pass, detail };
}

const grid = [];
for (const sgcBand of [45, 60, 75, 90])
  for (const amplify of [10, 14, 18, 24])
    for (const slots of [3, 4.5, 6, 8, 11])
      for (const cgmpDecay of [0.014, 0.02, 0.03, 0.045])
        grid.push({ sgcBand, amplify, slots, cgmpDecay });

console.log(`扫描 ${grid.length} 组参数 × ${CONTRACT.length} 场景 × ${SEEDS.length} 种子 …\n`);

const results = [];
for (const t of grid) {
  const L = tweak(t);
  const { pass, detail } = score(L);
  results.push({ t, pass, detail });
}

results.sort((a, b) => b.pass - a.pass);
console.log('最优组合：\n');
for (const r of results.slice(0, 5)) {
  console.log(
    `── 通过 ${r.pass}/${CONTRACT.length}  sgcBand=${r.t.sgcBand}  amplify=${r.t.amplify}` +
    `  slots=${r.t.slots}  cgmpDecay=${r.t.cgmpDecay}`
  );
  score(tweak(r.t), true);
  console.log('');
}

const best = results[0];
console.log('最佳参数建议:', JSON.stringify(best.t));
