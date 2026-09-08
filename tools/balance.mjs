/* ============================================================================
 * 参数配平 / 回归测试
 *   node tools/balance.mjs
 * 验证四个场景能否自然涌现出 PDF 里描述的结局。
 * ==========================================================================*/
import { Simulator, TPS } from '../build/engine.js';
import { LEVEL_NO_CGMP } from '../build/pathways/nocgmp/index.js';

const mk = (seed = 20260904) => new Simulator(LEVEL_NO_CGMP, { seed });

function run(label, plan, seed = 20260904, maxTicks = 1300) {
  const sim = mk(seed);
  const marks = [];
  for (let t = 0; t < maxTicks; t++) {
    for (const [at, drug] of plan) if (t === at) sim.applyDrug(drug);
    sim.tick();
    if (sim.outcome) break;
    if (t % 100 === 99) {
      marks.push({
        s: ((t + 1) / TPS).toFixed(0) + 's',
        Ca: sim.metrics.Ca.toFixed(1),
        cGMP: sim.node('cGMP').count.toFixed(0),
        PKG: sim.node('PKG').activation.toFixed(0),
        MLCP: sim.node('MLCP').activation.toFixed(0),
        PDE5: sim.node('PDE5').activation.toFixed(0),
        GTP: sim.pools.GTP.toFixed(0),
      });
    }
  }
  const minCa = Math.min(...sim.history.map((h) => h.Ca)).toFixed(1);
  const maxG = Math.max(...sim.history.map((h) => h.cGMP)).toFixed(0);
  console.log(`\n═══ ${label} ${'═'.repeat(Math.max(0, 52 - label.length))}`);
  console.table(marks);
  console.log(
    `  结局: ${sim.outcome ? sim.outcome.result.toUpperCase() + ' — ' + sim.outcome.reason : '未结束'}` +
    `  |  最低 Ca=${minCa}  峰值 cGMP=${maxG}  用时=${sim.time.toFixed(1)}s`
  );
  return sim;
}

const mode = process.argv[2] || 'all';

if (mode === 'all' || mode === 'idle') {
  run('场景 1 · 完全不干预（应当卡在负反馈死局）', []);
}

if (mode === 'all' || mode === 'sild') {
  run('场景 2 · 第 25 秒投放西地那非（应当通关）', [[250, 'sildenafil']]);
}

if (mode === 'all' || mode === 'ntg') {
  run('场景 3 · 猛灌硝酸甘油（应当死于 GTP 枯竭）',
    [[100, 'ntg'], [180, 'ntg'], [260, 'ntg']]);
}

if (mode === 'all' || mode === 'tox') {
  run('场景 4 · 西地那非 + 硝酸甘油（应当死于 cGMP 红区）',
    [[120, 'sildenafil'], [140, 'ntg'], [220, 'ntg'], [300, 'ntg']]);
}

if (mode === 'all' || mode === 'odq') {
  run('场景 5 · 只用 ODQ 沉默 sGC（应当通路熄火，Ca 不降）', [[100, 'odq']]);
}

if (mode === 'sweep') {
  // 参数敏感性分析：多随机种子下的结局分布
  const seeds = [1, 7, 42, 99, 256, 1024, 4096, 20260904, 777, 31337];
  const tally = (plan) => {
    const c = {};
    for (const s of seeds) {
      const sim = mk(s);
      for (let t = 0; t < 1300; t++) {
        for (const [at, d] of plan) if (t === at) sim.applyDrug(d);
        sim.tick();
        if (sim.outcome) break;
      }
      const k = sim.outcome ? sim.outcome.reason : 'none';
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  };
  console.log('\n═══ 参数敏感性分析（10 个随机种子）═══');
  console.log('  不干预          ', tally([]));
  console.log('  + 西地那非@25s  ', tally([[250, 'sildenafil']]));
  console.log('  + 西地那非@15s  ', tally([[150, 'sildenafil']]));
  console.log('  + 硝酸甘油×3    ', tally([[100, 'ntg'], [180, 'ntg'], [260, 'ntg']]));
  console.log('  + 西地+硝甘     ', tally([[120, 'sildenafil'], [140, 'ntg'], [220, 'ntg'], [300, 'ntg']]));
}
