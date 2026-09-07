/* ============================================================================
 * UI 层 —— DOM 绑定与仪表盘
 * ==========================================================================*/

/* 【这个文件做了什么】
 * 这是整个 app 唯一的 DOM 操作层。它把 HTML 模板里的 `<div id="...">` 全部缓存起来，
 * 然后按需更新文本和样式。功能分两块：
 *
 *   · 仪表盘     —— 顶部时间、Ca/cGMP/GTP 三个仪表、事件日志
 *   · 道具栏     —— 右侧四个药物按钮 + 节点检查器（点节点后弹出）
 *
 * 重要原则：UI 只读 Simulator 的状态，写也只写 DOM。
 * 任何想改模拟状态的动作（暂停、加速、投放、调参、重置）都通过 `this.ctx.actions`
 * 转发给 main.js，再由 main.js 调 sim —— 这样职责清晰：UI 不知道 Simulator 的内部结构。
 *
 * 性能上还有一个小心机：仪表盘更新被降到 ~20 Hz（main.js 里 uiAcc 累加），
 * 不会每帧重写 DOM，避免拖慢主循环。
 */

import { Status, TPS } from './engine.js';

export const PARAM_META = {
  band: { label: '命中频段宽度', min: 10, max: 100, step: 1, note: '骰子能落进的区间越宽，越容易被上游撞上' },
  decay: { label: '失活速率', min: 0.005, max: 0.12, step: 0.005, note: '每帧衰减的激活度比例，越大越难维持' },
  baseDecay: { label: '自然降解率', min: 0.005, max: 0.12, step: 0.005, note: '分子在胞质中被自发水解的速率' },
  K: { label: '半饱和常数 K', min: 20, max: 220, step: 5, note: '达到 50% 推动力所需的分子数量' },
  metabolism: { label: '代谢清除率', min: 0.001, max: 0.04, step: 0.001, note: '药物被肝脏清除、退出战场的速率' },
};

const ICONS = {
  pill: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="8" width="20" height="8" rx="4"/><path d="M12 8v8"/><path d="M6.5 11.5c0-1 .6-1.6 1.6-1.6s1.7.6 1.7 1.6-.6 2.1-1.7 2.1-1.6-1.1-1.6-2.1z" fill="currentColor" stroke="none" opacity=".5"/></svg>',
  flask: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3h6M10 3v6L4.6 18a2 2 0 0 0 1.7 3h11.4a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7.5 14h9"/></svg>',
  block: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
};

const $ = (id) => document.getElementById(id);

/**
 * 生成说明窗里那四条「结算规则」。
 * 以前这段文案直接写死在这里（"GTP 池被抽干" / "cGMP 持续突破 190 红线"），
 * 等于关卡规则又抄了一份到 UI 里 —— 改了关卡还得记得回来改这里。
 * 现在全部从 level.outcome 读，标题从 level.outcomeText 读，只有一份数据源。
 */
function briefRules(level) {
  const O = level.outcome;
  const T = level.outcomeText;
  const li = (color, title, body) =>
    `<li><b style="color:${color}">${title}</b>：${body}</li>`;
  return [
    li('#7ee08a', T.homeostasis.title,
      `${metricName(level, O.win.metric)}降到 ${O.win.below} 以下，并稳定维持 ${(O.win.hold / TPS).toFixed(0)} 秒`),
    li('#ff7a6b', T.starvation.title,
      `${O.starve.pool} 池被抽干，细胞代谢停摆`),
    li('#ff7a6b', T.toxicity.title,
      `${nodeName(level, O.toxicity.id)} 持续突破 ${O.toxicity.above} 红线，引发顽固性低血压`),
    li('#ff7a6b', T.timeout.title,
      `${(O.timeout.ticks / TPS).toFixed(0)} 秒内指标从未进入安全区间`),
  ].join('');
}

/** 指标 id → 显示名；找不到就用 id 兜底 */
const metricName = (level, id) =>
  level.metrics.find((m) => m.id === id)?.name ?? id;

/** 分子 id → 显示名；找不到就用 id 兜底 */
const nodeName = (level, id) =>
  level.nodes.find((n) => n.id === id)?.name ?? id;

export class UI {
  constructor(ctx) {
    this.ctx = ctx; // { sim, level, renderer, chart, reset, togglePause, setSpeed }
    this.el = {
      levelName: $('levelName'), clock: $('clock'), clockTotal: $('clockTotal'),
      btnPause: $('btnPause'), btnSpeed: $('btnSpeed'), btnReset: $('btnReset'), btnHelp: $('btnHelp'),
      dock: $('dock'), caVal: $('caVal'), caFill: $('caFill'), caSafe: $('caSafe'),
      caTarget: $('caTarget'), caGoal: $('caGoal'), caHold: $('caHold'),
      relaxVal: $('relaxVal'), relaxFill: $('relaxFill'),
      cgmpVal: $('cgmpVal'), cgmpFill: $('cgmpFill'),
      gtpVal: $('gtpVal'), gtpFill: $('gtpFill'),
      inspector: $('inspector'), inspectorTitle: $('inspectorTitle'),
      log: $('log'), modal: $('modal'), modalCard: $('modalCard'),
      tooltip: $('tooltip'), phaseTag: $('phaseTag'), tickTag: $('tickTag'),
    };
    this._lastLogLen = -1;
    this._bind();
    this._buildDock();
    this.renderInspector();
    this.renderBrief();
  }

  /* ------------------------------------------------------------ 绑定 */
  /** 把 UI 控件的事件挂上对应的动作。
   * 这里你能看到一个 JS 里的常见模式：监听 canvas 上的 mousemove 事件，
   * 根据鼠标坐标调用 renderer.hitTest() 找到下面的节点，再把节点的"档案卡"显示出来。
   */
  _bind() {
    const { level, renderer } = this.ctx;
    const canvas = renderer.canvas;

    this.el.levelName.textContent =
      `${level.name} · ${level.subtitle}`;
    this.el.clockTotal.textContent = `/ ${(level.timeout / TPS).toFixed(0)}s`;
    this.el.caGoal.textContent = level.goal.target;
    this.el.caSafe.style.width = `${(level.goal.target / level.chart.max) * 100}%`;
    this.el.caTarget.style.left = `${(level.goal.target / level.chart.max) * 100}%`;

    // 图表标题跟着 chart.series 走：以后加/删曲线，标题自动同步，不用回来改文案
    const tt = $('trendTitle');
    if (tt) tt.textContent = `浓度动态 · ${level.chart.series.map((s) => s.label ?? s.key).join(' · ')}`;

    this.el.btnPause.onclick = () => this.ctx.togglePause();
    this.el.btnSpeed.onclick = () => this.ctx.cycleSpeed();
    this.el.btnReset.onclick = () => this.ctx.reset();
    this.el.btnHelp.onclick = () => this.renderBrief($('briefModal'));

    canvas.addEventListener('click', (e) => {
      const id = renderer.hitTest(e.clientX, e.clientY);
      this.ctx.sim.selected = id;
      this.renderInspector();
    });

    canvas.addEventListener('mousemove', (e) => {
      const id = renderer.hitTest(e.clientX, e.clientY);
      if (!id) { this.el.tooltip.classList.remove('show'); return; }
      const def = level.nodes.find((n) => n.id === id);
      const m = this.ctx.sim.node(id);
      const rect = canvas.getBoundingClientRect();
      this.el.tooltip.innerHTML =
        `<b>${def.name}</b> <span style="color:#8b98a5">${def.cn}</span>` +
        `<div class="tt-desc">${def.desc}</div>` +
        `<div class="tt-tags">${def.tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div>`;
      this.el.tooltip.classList.add('show');
      const tx = e.clientX - rect.left + 16, ty = e.clientY - rect.top + 14;
      this.el.tooltip.style.left = Math.min(tx, rect.width - 290) + 'px';
      this.el.tooltip.style.top = ty + 'px';
    });
    canvas.addEventListener('mouseleave', () => this.el.tooltip.classList.remove('show'));

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); this.ctx.togglePause(); }
      else if (k === 'r') this.ctx.reset();
      else if (k === 'escape') { $('briefModal').style.display = 'none'; }
      else {
        const d = level.drugs.find((x) => x.hotkey === e.key);
        if (d) { this.ctx.applyDrug(d.id); this._buildDock(); }
      }
    });

    $('briefModal').addEventListener('click', (e) => {
      if (e.target.id === 'briefModal') $('briefModal').style.display = 'none';
    });
    document.querySelectorAll('.modal .btn-close').forEach((b) => {
      b.onclick = () => { $('briefModal').style.display = 'none'; };
    });

    window.addEventListener('resize', () => {
      this.ctx.renderer.resize();
      this.ctx.chart.resize();
    });
  }

  /* ---------------------------------------------------------- 道具栏 */
  /** 根据 level.drugs 数组渲染右侧的药物按钮。
   * 每次投放后都重新调一次（用完的就 disabled），保持与 sim.drugState 一致。
   * 注意：道具按钮的 HTML 是字符串拼接生成的，不是用 createElement —— 因为没有交互逻辑，
   * 用 innerHTML + querySelectorAll 一遍遍历更短。
   */
  _buildDock() {
    const { level, sim } = this.ctx;
    this.el.dock.innerHTML = level.drugs.map((d) => {
      const st = sim.drugState.get(d.id);
      const left = d.charges - st.uses;
      // 右栏是 372px 窄列，道具卡片只留「图标 + 名字 + 快捷键 + 剩余次数」。
      // 完整说明（d.desc）挂到 title 上，hover 可见；投放后画布上也会出现对应节点，
      // 点开节点档案能看到同一段文字 —— 信息没有真的丢，只是换了个地方。
      return `<button class="drug" data-drug="${d.id}"
        title="${d.name}（${d.en}）· 快捷键 ${d.hotkey}\n${d.desc}" ${left <= 0 ? 'disabled' : ''}>
        <span class="dicon" style="background:${d.color}1f;color:${d.color}">${ICONS[d.icon] || ICONS.pill}</span>
        <span class="dname">${d.name}</span>
        <span class="dkey">${d.hotkey}</span>
        <span class="dcount${left <= 0 ? ' out' : ''}">${left}/${d.charges}</span>
      </button>`;
    }).join('');

    this.el.dock.querySelectorAll('.drug').forEach((b) => {
      b.onclick = () => {
        this.ctx.applyDrug(b.dataset.drug);
        this._buildDock();
      };
    });
  }

  /* -------------------------------------------------------- 每帧刷新 */
  /** ~20 Hz 由主循环调一次。把所有"会变的"仪表盘数字、进度条、相位标签刷一遍。
   * 关键优化：日志列表只在长度变化时才重写（_lastLogLen 缓存），
   * 否则即便没有新事件也走一遍字符串拼接挺浪费。
   */
  update() {
    const { sim, level } = this.ctx;
    const Ca = sim.metrics.Ca;
    const goal = level.goal.target;
    // 仪表量程与折线图量程共用同一份配置（level.chart.max），改一处两边同步
    const caMax = level.chart.max;
    const cgmp = sim.node(level.outcome.toxicity.id)?.count ?? 0;

    this.el.clock.textContent = sim.time.toFixed(1) + 's';
    this.el.caVal.textContent = Ca.toFixed(0);
    const good = Ca <= goal;
    this.el.caVal.className = 'gauge-val' + (good ? ' good' : '');
    this.el.caFill.style.width = `${Math.min(100, (Ca / caMax) * 100)}%`;
    this.el.caFill.className = 'gauge-fill' + (good ? ' good' : '');

    const hold = (sim.holdTicks / TPS).toFixed(1);
    this.el.caHold.textContent = `已稳定 ${hold}s / ${(level.goal.hold / TPS).toFixed(1)}s`;

    const relax = Math.max(0, Math.min(100, 100 - Ca));
    this.el.relaxVal.textContent = relax.toFixed(0) + '%';
    this.el.relaxFill.style.width = relax + '%';

    this.el.cgmpVal.textContent = cgmp.toFixed(0);
    this.el.cgmpFill.style.width = `${Math.min(100, (cgmp / (level.redline.cGMP || 320)) * 100)}%`;

    const gtp = sim.pools.GTP ?? 0;
    const gtpMax = sim.poolsMax.GTP || 1;
    this.el.gtpVal.textContent = gtp.toFixed(0);
    this.el.gtpFill.style.width = `${(gtp / gtpMax) * 100}%`;

    // 相位标签
    let tag = '推演中', cls = 'panel-tag';
    if (sim.outcome) {
      tag = sim.outcome.result === 'win'
        ? level.outcomeText.homeostasis.title : '系统崩溃';
      cls += sim.outcome.result === 'win' ? ' good' : ' warn';
    }
    else if (sim.paused) { tag = '已暂停'; }
    else if (cgmp >= (level.redline.cGMP || 320) * 0.8) { tag = 'cGMP 逼近红线'; cls += ' warn'; }
    else if (gtp < gtpMax * 0.15) { tag = '能量告急'; cls += ' warn'; }
    else if (good) { tag = '进入安全区'; cls += ' good'; }
    this.el.phaseTag.textContent = tag;
    this.el.phaseTag.className = cls;
    this.el.tickTag.textContent = sim.speed === 1 ? '10 Hz' : `${10 * sim.speed} Hz`;

    this._renderLog();
    if (this.ctx.sim.selected) this._updateInspectorValues();
  }

  _renderLog() {
    const ev = this.ctx.sim.events;
    if (ev.length === this._lastLogLen) return;
    this._lastLogLen = ev.length;
    this.el.log.innerHTML = ev.slice(0, 30).map((e) =>
      `<div class="log-item k-${e.kind}"><span class="lt">${e.t}s</span><span>${e.text}</span></div>`
    ).join('') || '<div class="log-item"><span style="color:#5c6b7a">等待事件…</span></div>';
  }

  /* ---------------------------------------------------------- 检查器 */
  /** 渲染点中节点后的右侧详情面板。这里会做两件事：
   *   1. 节点档案（desc + 标签徽标 + 当前数值）
   *   2. 列出该节点 `editable` 白名单里的参数，每个参数生成一个 range 滑块
   *
   * 滑块 oninput 时直接调 sim.setParam(id, key, value) —— 见 engine.js 末尾的速查表。
   */
  renderInspector() {
    const { sim, level } = this.ctx;
    const id = sim.selected;
    const def = id ? level.nodes.find((n) => n.id === id) : null;

    if (!def) {
      this.el.inspectorTitle.textContent = '关卡简报';
      this.el.inspector.innerHTML =
        `<div class="hint-box">${level.hint}</div>` +
        `<div class="insp-desc">${level.brief}</div>` +
        level.lessons.map((l) => `<div class="lesson">${l}</div>`).join('') +
        `<div class="insp-desc" style="margin-top:12px;font-size:11px;color:#5c6b7a">
          点击通路图中任意节点，可查看档案并调节它的关键参数。
        </div>`;
      return;
    }

    const m = sim.node(id);
    this.el.inspectorTitle.textContent = `${def.name} · ${def.cn}`;
    const tags = def.tags.map((t) => `<span class="tag" style="font-family:var(--mono);font-size:9.5px;padding:1.5px 5px;border-radius:4px;background:rgba(77,208,199,.12);color:#4dd0c7;border:1px solid rgba(77,208,199,.25)">${t}</span>`).join('');

    const isCount = def.drive === 'count' || def.drive === 'pulse';
    this.el.inspector.innerHTML =
      `<div class="insp-desc">${def.desc}</div>
       <div class="insp-tags">${tags}</div>
       <div class="insp-stats">
         <div class="insp-stat"><div class="k">${isCount ? 'MOLECULES' : 'ACTIVATION'}</div><div class="v" data-f="main">—</div></div>
         <div class="insp-stat"><div class="k">STATUS</div><div class="v" data-f="status" style="font-size:12px">—</div></div>
         <div class="insp-stat"><div class="k">DRIVE (推动力)</div><div class="v" data-f="drive">—</div></div>
         <div class="insp-stat"><div class="k">BUFF 剩余</div><div class="v" data-f="timer">—</div></div>
       </div>
       <div id="params"></div>
       <div class="insp-desc" style="font-size:10.5px;color:#5c6b7a;line-height:1.7">
         白色描边表示当前选中。只有列入白名单的参数可调 —— 其余 80% 的分子参数由引擎写死，
         以保证网络能稳定涌现出负反馈与稳态。
       </div>`;

    const box = $('params');
    for (const key of (def.editable || [])) {
      const meta = PARAM_META[key];
      if (!meta) continue;
      const raw = m.tpl[key];
      const val = Array.isArray(raw) ? raw[1] : raw;
      const wrap = document.createElement('div');
      wrap.className = 'param';
      wrap.innerHTML =
        `<div class="param-row"><span class="pk">${meta.label}</span><span class="pv" data-v="${key}">${val}</span></div>
         <input type="range" min="${meta.min}" max="${meta.max}" step="${meta.step}" value="${val}" data-k="${key}">
         <div class="param-note">${meta.note}</div>`;
      const input = wrap.querySelector('input');
      const out = wrap.querySelector('.pv');
      input.oninput = () => {
        const v = parseFloat(input.value);
        out.textContent = v;
        sim.setParam(id, key, Array.isArray(raw) ? [0, v] : v);
      };
      box.appendChild(wrap);
    }
    this._updateInspectorValues();
  }

  _updateInspectorValues() {
    const { sim, level } = this.ctx;
    const id = sim.selected;
    if (!id) return;
    const m = sim.node(id);
    const def = level.nodes.find((n) => n.id === id);
    if (!m || !def) return;
    const isCount = def.drive === 'count' || def.drive === 'pulse';
    const set = (f, v) => { const e = this.el.inspector.querySelector(`[data-f="${f}"]`); if (e) e.textContent = v; };
    set('main', isCount ? (m.count < 10 ? m.count.toFixed(1) : Math.round(m.count)) : Math.round(m.activation) + '%');
    set('status', m.isMuted ? 'Muted' : m.status);
    set('drive', m.drive.toFixed(2));
    // 原式 Math.round(m.timer / 10 * 10) 等于 Math.round(m.timer) —— 就是剩余帧数
    set('timer', Math.round(m.timer) + 'f');
  }

  /* ---------------------------------------------------------- 结算窗 */
  /** 模拟结束（sim.outcome != null）时被调。把结果摘要填进弹窗。
   * 注意：时间、Ca 终值、峰值 cGMP 都从 sim 直接读取，是"赛后快照"。
   * "再看说明"按钮复用 briefModal 模态框 —— 同一份 HTML 容器塞两种内容。
   */
  showOutcome() {
    const { sim, level } = this.ctx;
    const o = sim.outcome;
    if (!o) return;
    const win = o.result === 'win';
    const node = (id) => sim.node(id);
    this.el.modalCard.innerHTML =
      `<h2>${win ? '稳态恢复' : o.title}
         <span class="badge ${win ? 'win' : 'lose'}">${win ? 'SUCCESS' : 'FAILED'}</span></h2>
       <p class="m-desc">${o.detail}</p>
       <div class="m-stats">
         <div class="m-stat"><div class="k">用时</div><div class="v">${o.time.toFixed(1)}s</div></div>
         <div class="m-stat"><div class="k">终值 Ca²⁺</div><div class="v" style="color:${win ? '#7ee08a' : '#ff7a6b'}">${sim.metrics.Ca.toFixed(0)}</div></div>
         <div class="m-stat"><div class="k">峰值 cGMP</div><div class="v">${Math.max(...sim.history.map((h) => h.cGMP), 0).toFixed(0)}</div></div>
       </div>
       <div class="m-desc" style="font-size:11.5px;color:#6f7f8e">
         终局快照 · cGMP ${(node('cGMP')?.count ?? 0).toFixed(0)} ·
         PKG ${(node('PKG')?.activation ?? 0).toFixed(0)}% ·
         PDE5 ${(node('PDE5')?.activation ?? 0).toFixed(0)}% ·
         GTP 余 ${(sim.pools.GTP ?? 0).toFixed(0)}
       </div>
       <div class="m-actions">
         <button class="btn" onclick="document.getElementById('briefModal').style.display='grid'">再看说明</button>
         <button class="btn primary" id="againBtn">重新推演</button>
       </div>`;
    this.el.modal.hidden = false;
    $('againBtn').onclick = () => { this.el.modal.hidden = true; this.ctx.reset(); };
  }

  hideOutcome() { this.el.modal.hidden = true; }

  /* ---------------------------------------------------------- 说明窗 */
  renderBrief(modal) {
    const { level } = this.ctx;
    const target = modal || $('briefModal');
    $('briefCard').innerHTML =
      `<h2>${level.name}<span class="badge win" style="margin-left:8px">${level.subtitle}</span></h2>
       <p>${level.brief}</p>
       <p style="color:#8b98a5;font-size:12px">${level.hint}</p>
       <p style="margin-top:14px"><b style="color:#4dd0c7">怎么玩</b></p>
       <ul>
         <li>点通路图上的<b>节点</b>可查看档案，并拖动滑块调节它的关键参数</li>
         <li>点<b>道具栏</b>或按 <span class="kbd">1</span>–<span class="kbd">4</span> 投放药物</li>
         <li><span class="kbd">空格</span> 暂停 / 继续 &nbsp; <span class="kbd">R</span> 重置 &nbsp; 右上角可切换 1× / 2× / 4× 推演速度</li>
       </ul>
      <p style="margin-top:14px"><b style="color:#b39dff">结算规则</b></p>
      <ul>
        ${briefRules(level)}
      </ul>
       <div class="m-actions" style="margin-top:20px">
         <button class="btn primary btn-close">开始推演</button>
       </div>`;
    target.style.display = 'grid';
    const btn = document.querySelector('#briefCard .btn-close');
    if (btn) btn.onclick = () => { target.style.display = 'none'; };
  }

  refreshSpeed(speed) { this.el.btnSpeed.textContent = speed + '×'; }
  refreshPause(paused) {
    this.el.btnPause.textContent = paused ? '继续' : '暂停';
    this.el.btnPause.classList.toggle('on', paused);
  }
}
