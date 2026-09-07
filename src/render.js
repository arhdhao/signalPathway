/* ============================================================================
 * 渲染层 —— Canvas 2D
 *   · 只读 Simulator 的状态，从不反向写入
 *   · 逻辑 10 Hz、渲染 60 fps 解耦：粒子在这里按真实 dt 插值补间
 * ==========================================================================*/

/* 【这个文件做了什么】
 * 把 Simulator 内部的状态画到屏幕上。两个主要对象：
 *
 *   Renderer  —— 通路拓扑图：节点方块、反应箭头、流动的粒子
 *   Chart      —— 右侧折线图：Ca 与 cGMP 随时间变化
 *
 * 关键设计：粒子系统和逻辑时钟解耦。
 *   · 逻辑每 100ms 才推进一次（sim.tick()）
 *   · 浏览器每 ~16ms 调一次 draw()，要画 60 fps 流畅画面
 *   · 解决：每个粒子上有 `t` 字段（0→1 表示从源到目标），
 *           draw() 里按真实经过的 dt 把 t 推进。粒子就"连续飞"了。
 *
 * 输入：Simulator 的状态（只读）
 * 输出：Canvas 上的像素（不写回任何状态）
 */

import { Status } from './engine.js';

const NODE_W = 118;
const NODE_H = 62;

/* ------------------------------------------------------------ 路径工具 */
function edgePoint(node, tx, ty, pad = 8) {
  const dx = tx - node.x, dy = ty - node.y;
  if (dx === 0 && dy === 0) return { x: node.x, y: node.y };
  const hw = NODE_W / 2 + pad, hh = NODE_H / 2 + pad;
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: node.x + dx * s, y: node.y + dy * s };
}

function buildPath(from, to, waypoints = []) {
  const pts = [{ x: from.x, y: from.y }, ...waypoints, { x: to.x, y: to.y }];
  if (pts.length >= 2) {
    pts[0] = edgePoint(from, pts[1].x, pts[1].y);
    const n = pts.length;
    pts[n - 1] = edgePoint(to, pts[n - 2].x, pts[n - 2].y);
  }
  return pts;
}

function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

function pointAt(pts, t) {
  const total = pathLength(pts);
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (d <= seg || i === pts.length - 1) {
      const k = seg === 0 ? 0 : d / seg;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k };
    }
    d -= seg;
  }
  return pts[pts.length - 1];
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* --------------------------------------------------------- 渲染器主体 */
export class Renderer {
  constructor(canvas, level, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.level = level;
    this.sim = sim;
    this.scale = 1;
    this.particles = [];
    this.acc = new Map();
    this.t = 0;
    this.hover = null;
    this.paths = new Map();
    this._buildPaths();
    this.resize();
  }

  _buildPaths() {
    const nodeById = Object.fromEntries(this.level.nodes.map((n) => [n.id, n]));
    for (const rx of this.level.reactions) {
      const from = nodeById[rx.from], to = nodeById[rx.to];
      // 降解反应画成「底物 → 酶」，视觉上表现分子被抽走
      const a = rx.effect === 'consume' ? to : from;
      const b = rx.effect === 'consume' ? from : to;
      const wp = rx.effect === 'consume' ? [] : (rx.waypoints || []);
      this.paths.set(rx.id, buildPath(a, b, wp));
    }
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    // 首帧容器可能还没完成布局，给一个兜底尺寸，避免除零与空白画布
    const w = Math.max(320, rect.width || 900);
    const h = Math.max(200, rect.height || 380);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = w;
    this.viewH = h;
    this.scale = Math.min(w / this.level.canvas.w, h / this.level.canvas.h);
    this.ox = (w - this.level.canvas.w * this.scale) / 2;
    this.oy = (h - this.level.canvas.h * this.scale) / 2;
  }

  /** 容器尺寸变化检测：由主循环低频调用，保证任何时刻都能自愈 */
  autoResize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    if (Math.abs((rect.width || 0) - this.viewW) > 1 || Math.abs((rect.height || 0) - this.viewH) > 1) {
      this.resize();
      return true;
    }
    return false;
  }

  toWorld(px, py) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (px - rect.left - this.ox) / this.scale, y: (py - rect.top - this.oy) / this.scale };
  }

  hitTest(px, py) {
    const w = this.toWorld(px, py);
    for (const n of this.level.nodes) {
      const m = this.sim.node(n.id);
      if (m.isDrug && m.count < 1) continue; // 未投放的药物不可点
      if (Math.abs(w.x - n.x) <= NODE_W / 2 && Math.abs(w.y - n.y) <= NODE_H / 2) return n.id;
    }
    return null;
  }

  /* ---------------------------------------------------------- 粒子发射 */
  /** 把 sim.lastGain / lastHit 翻译成「每帧该吐几个粒子」。
   *
   * 因为渲染按 60 fps 跑而逻辑按 10 Hz 跑，每帧可能该吐好几个粒子 —— 用 `acc` 累加器
   * 把"分数个粒子"攒起来，攒够一个就发一个；防止帧间隔抖动让粒子忽多忽少。
   *
   *   produce 反应  —— 按 sim.lastGain（刚生成的分子数）× 1.1 吐，颜色用 cGMP 绿
   *   consume 反应  —— 按被降解的量 × 1.4 吐，颜色用 PDE5 红（飞向酶）
   *   activate 反应 —— 流速 = 上游推动力 × 26；命中瞬间额外 +10（闪爆发）
   *
   * 上限：每帧最多补 6 个。卡顿回来后也不会雪崩。
   */
  _emit(dt) {
    for (const rx of this.level.reactions) {
      const src = this.sim.node(rx.from);
      if (!src) continue;
      let rate = 0, color = '#4dd0c7', size = 2.4, life = 1.0;

      if (rx.effect === 'produce') {
        rate = src.lastGain * 1.1;
        color = '#5ee0c8'; size = 3.0;
      } else if (rx.effect === 'consume') {
        rate = src.lastGain * 1.4;
        color = '#ff8f7a'; size = 2.4; life = 0.85;
      } else {
        // 激活类：流速正比于上游推动力，命中瞬间额外迸发
        rate = src.drive * 26 + (src.lastHit ? 10 : 0);
        color = src.tpl.color || '#4dd0c7'; size = 2.2;
      }
      if (this.sim.node(rx.from).isMuted) rate = 0;

      const acc = (this.acc.get(rx.id) || 0) + rate * dt;
      let n = Math.floor(acc);
      this.acc.set(rx.id, acc - n);
      n = Math.min(n, 6); // 每帧最多补 6 个，防止卡顿后雪崩
      for (let i = 0; i < n; i++) {
        this.particles.push({ rx: rx.id, t: -i * 0.06, color, size, life });
      }
    }
  }

  _updateParticles(dt) {
    const speed = 0.62;
    for (const p of this.particles) p.t += dt * speed / (p.life || 1);
    this.particles = this.particles.filter((p) => p.t < 1.05);
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
  }

  /* -------------------------------------------------------------- 主绘 */
  /** 每帧被 main.js 调一次。按顺序画：背景网格 → 反应边 → 粒子 → 节点 → 内皮。
   * 顺序很重要 —— 后画的盖在先画的上方。所以节点必须最后画，否则粒子会盖掉节点标签。
   *
   * dt 参数是"自上一帧以来真实经过的秒数 × 倍速"，用于粒子插值。
   * 暂停时传入 0，所以粒子原地"冻住"而不继续飞。
   */
  draw(dt) {
    const ctx = this.ctx;
    this.t += dt;
    if (!this.sim.paused && !this.sim.outcome) { this._emit(dt); this._updateParticles(dt); }

    ctx.clearRect(0, 0, this.viewW, this.viewH);
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(this.scale, this.scale);

    this._drawBackdrop(ctx);
    for (const rx of this.level.reactions) this._drawEdge(ctx, rx);
    this._drawParticles(ctx);
    for (const n of this.level.nodes) this._drawNode(ctx, n);
    this._drawEndothelium(ctx);

    ctx.restore();
  }

  _drawBackdrop(ctx) {
    const { w, h } = this.level.canvas;
    ctx.save();
    // 细胞内的淡淡网格
    ctx.strokeStyle = 'rgba(255,255,255,0.028)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    // 细胞膜
    ctx.strokeStyle = 'rgba(120,200,220,0.16)';
    ctx.lineWidth = 2;
    roundRect(ctx, 14, 14, w - 28, h - 28, 26);
    ctx.stroke();
    ctx.fillStyle = 'rgba(120,200,220,0.30)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('平滑肌细胞 · 胞质', 28, 34);
    ctx.restore();
  }

  _drawEndothelium(ctx) {
    // 左侧内皮细胞：NO 的来源，会随脉冲搏动
    const m = this.sim.node('NO');
    const pulse = Math.max(0, 1 - (this.sim._pulseClock / this.level.pulse.period) * 1.6);
    const glow = m ? Math.min(1, m.count / 55) : 0;
    const x = 62, y = 95;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(143,211,255,0.07)';
    ctx.strokeStyle = `rgba(143,211,255,${0.28 + glow * 0.5})`;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x - 46, y - 40, 92, 80, 18);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(143,211,255,0.85)';
    ctx.font = '12px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('内皮细胞', x, y - 4);
    ctx.fillStyle = 'rgba(143,211,255,0.45)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('NO 脉冲源', x, y + 12);

    // 搏动环
    if (pulse > 0) {
      ctx.globalAlpha = pulse * 0.5;
      ctx.beginPath();
      ctx.arc(x, y, 34 + (1 - pulse) * 16, 0, Math.PI * 2);
      ctx.strokeStyle = '#8fd3ff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawEdge(ctx, rx) {
    const pts = this.paths.get(rx.id);
    if (!pts || pts.length < 2) return;
    const src = this.sim.node(rx.from);
    const dst = this.sim.node(rx.to);
    const active = src && !src.isMuted && (src.drive > 0.02 || src.lastGain > 0.05);
    const isNeg = rx.negate;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);

    ctx.strokeStyle = isNeg
      ? (active ? 'rgba(255,122,107,0.55)' : 'rgba(255,122,107,0.16)')
      : (active ? 'rgba(120,220,210,0.42)' : 'rgba(150,170,190,0.15)');
    ctx.lineWidth = active ? 2 : 1.4;
    if (isNeg) ctx.setLineDash([7, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 抑制末端的「⊥」形封口
    if (isNeg) {
      const e = pts[pts.length - 1], p = pts[pts.length - 2];
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      ctx.translate(e.x, e.y); ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(-6, 0); ctx.lineTo(-6, -7); ctx.moveTo(-6, 0); ctx.lineTo(-6, 7);
      ctx.strokeStyle = active ? 'rgba(255,122,107,0.85)' : 'rgba(255,122,107,0.3)';
      ctx.lineWidth = 2; ctx.stroke();
    } else {
      // 箭头
      const e = pts[pts.length - 1], p = pts[pts.length - 2];
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      ctx.translate(e.x, e.y); ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(-9, -4.5); ctx.lineTo(-9, 4.5); ctx.closePath();
      ctx.fillStyle = active ? 'rgba(120,220,210,0.75)' : 'rgba(150,170,190,0.3)';
      ctx.fill();
    }
    ctx.restore();

    // 反应标签
    if (rx.label) {
      const mid = pointAt(pts, 0.5);
      ctx.save();
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = active ? 'rgba(190,220,235,0.6)' : 'rgba(150,170,190,0.28)';
      ctx.fillText(rx.label, mid.x, mid.y - 8);
      ctx.restore();
    }
  }

  _drawParticles(ctx) {
    ctx.save();
    for (const p of this.particles) {
      if (p.t < 0) continue;
      const pts = this.paths.get(p.rx);
      if (!pts) continue;
      const pos = pointAt(pts, p.t);
      const fade = p.t > 0.85 ? (1.05 - p.t) / 0.2 : 1;
      ctx.globalAlpha = Math.max(0, Math.min(1, fade)) * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawNode(ctx, def) {
    const m = this.sim.node(def.id);
    if (!m) return;
    if (m.isDrug && m.count < 1) return; // 未投放不画

    const sat = m.saturation;
    const muted = m.isMuted;
    const selected = this.sim.selected === def.id;
    const base = def.color || '#4dd0c7';

    // 命中闪光
    const flash = m.flash;
    const alpha = muted ? 0.3 : 0.14 + sat * 0.72;

    ctx.save();
    // 外发光：激活度越高越亮
    if (!muted && sat > 0.02) {
      ctx.shadowColor = base;
      ctx.shadowBlur = 10 + sat * 26 + flash * 14;
    }
    ctx.fillStyle = this._alpha(base, alpha);
    ctx.strokeStyle = selected ? '#ffffff' : this._alpha(base, muted ? 0.35 : 0.55 + sat * 0.45);
    ctx.lineWidth = selected ? 2.4 : 1.5;
    roundRect(ctx, def.x - NODE_W / 2, def.y - NODE_H / 2, NODE_W, NODE_H, 12);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.restore();

    // 文本
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = muted ? 'rgba(230,240,250,0.4)' : '#eaf4ff';
    ctx.font = '600 15px ui-sans-serif, system-ui';
    ctx.fillText(def.name, def.x, def.y - 10);
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = muted ? 'rgba(230,240,250,0.3)' : 'rgba(220,235,250,0.55)';
    ctx.fillText(this._countText(m, def), def.x, def.y + 6);

    // 激活度条
    const bw = NODE_W - 26;
    const bx = def.x - bw / 2, by = def.y + 15;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(ctx, bx, by, bw, 4, 2); ctx.fill();
    ctx.fillStyle = muted ? '#6b7480' : base;
    roundRect(ctx, bx, by, bw * (muted ? 0 : sat), 4, 2); ctx.fill();

    // 状态徽标
    if (muted) {
      ctx.fillStyle = '#ff7a6b';
      ctx.font = '600 9px ui-sans-serif, system-ui';
      ctx.fillText('MUTED', def.x, def.y + 30);
    } else if (m.status === Status.ACTIVE) {
      ctx.fillStyle = this._alpha(base, 0.95);
      ctx.font = '600 9px ui-sans-serif, system-ui';
      ctx.fillText('ACTIVE', def.x, def.y + 30);
    }
    // 命中闪光环
    if (flash > 0.02) {
      ctx.globalAlpha = flash * 0.55;
      ctx.strokeStyle = base;
      ctx.lineWidth = 2;
      roundRect(ctx, def.x - NODE_W / 2 - 5, def.y - NODE_H / 2 - 5, NODE_W + 10, NODE_H + 10, 15);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  _countText(m, def) {
    if (def.drive === 'count' || def.drive === 'pulse') {
      return m.count < 10 ? m.count.toFixed(1) : Math.round(m.count).toString();
    }
    return Math.round(m.activation) + '%';
  }

  _alpha(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
}

/* --------------------------------------------------------- 折线图渲染 */
  /** 画右下角那张 Ca/cGMP 时间曲线。逻辑很简单：
   *   · 拿 sim.history（每 2 个 tick 推一条的快照）
   *   · 把每个值用 `yOf` 函数映射到画布像素
   *   · Ca ≤ 目标值画绿色"安全带"，玩家一眼能看出"什么时候进绿区"
   *
   * 与 Renderer 共享坐标系思路但完全独立的 canvas —— 它单独有自己的 resize 逻辑。
   */
export class Chart {
  constructor(canvas, level, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.level = level;
    this.sim = sim;
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(320, rect.width || 340);
    const h = Math.max(100, rect.height || 124);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
  }

  autoResize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    if (Math.abs((rect.width || 0) - this.w) > 1 || Math.abs((rect.height || 0) - this.h) > 1) {
      this.resize();
      return true;
    }
    return false;
  }

  draw() {
    const ctx = this.ctx, w = this.w, h = this.h;
    const pad = { l: 34, r: 44, t: 12, b: 18 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    ctx.clearRect(0, 0, w, h);

    const hist = this.sim.history;
    const goal = this.level.goal.target;
    // 纵轴量程与要画哪几条曲线，全部由关卡的 chart 配置决定 ——
    // 这里不再写死「画 Ca 和 cGMP」。改关卡的 CHART 即可，本文件不用动。
    const yMax = this.level.chart.max;
    const series = this.level.chart.series;

    // 安全区间带（核心指标 ≤ target 为安全）
    const yOf = (v) => pad.t + ih - (Math.max(0, Math.min(yMax, v)) / yMax) * ih;
    ctx.fillStyle = 'rgba(126,224,138,0.09)';
    ctx.fillRect(pad.l, yOf(goal), iw, pad.t + ih - yOf(goal));
    ctx.strokeStyle = 'rgba(126,224,138,0.45)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, yOf(goal)); ctx.lineTo(pad.l + iw, yOf(goal)); ctx.stroke();
    ctx.setLineDash([]);

    // 刻度：按量程均分四段（量程 160 → 0 / 40 / 80 / 120 / 160）
    const TICKS = 4;
    ctx.fillStyle = 'rgba(139,152,165,0.75)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= TICKS; i++) {
      const v = (yMax / TICKS) * i;
      const y = yOf(v);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + iw, y); ctx.stroke();
      ctx.fillText(String(v), pad.l - 6, y + 3);
    }

    if (hist.length < 2) return;

    const n = hist.length;
    const xOf = (i) => pad.l + (i / Math.max(1, n - 1)) * iw;

    // 端点圆点先统一画，再统一画数值标注 —— 标注要在最后做防重叠，不能被曲线盖住
    for (const s of series) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const y = yOf(hist[i][s.key]);
        i === 0 ? ctx.moveTo(xOf(i), y) : ctx.lineTo(xOf(i), y);
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.8;
      ctx.setLineDash(s.dash || []);   // 线型：不配置就是实线
      ctx.stroke();
      ctx.setLineDash([]);
      const lastY = yOf(hist[n - 1][s.key]);
      ctx.beginPath(); ctx.arc(xOf(n - 1), lastY, 3, 0, Math.PI * 2);
      ctx.fillStyle = s.color; ctx.fill();
    }

    /* 右侧端点标注：每条曲线标自己的真实数值（不走 history ——
       history 是每 2 tick 才存一条的，端点要的是当前实时值）。
       曲线多了以后几个标注会叠在一起，这里按 y 排序后把挨太近的推开，
       整组超出绘图区再整体回推，保证每个数字都读得到。 */
    const marks = series.map((s) => ({
      y: yOf(hist[n - 1][s.key]),
      color: s.color,
      text: this.sim._readValue(s).toFixed(0),
    })).sort((a, b) => a.y - b.y);
    const GAP = 11;
    for (let i = 1; i < marks.length; i++) {
      if (marks[i].y - marks[i - 1].y < GAP) marks[i].y = marks[i - 1].y + GAP;
    }
    const bottom = pad.t + ih;
    const over = marks.length ? marks[marks.length - 1].y - bottom : 0;
    if (over > 0) for (const m of marks) m.y -= over;
    if (marks.length && marks[0].y < pad.t) {
      const up = pad.t - marks[0].y;
      for (const m of marks) m.y = Math.min(bottom, m.y + up);
    }
    ctx.textAlign = 'left';
    ctx.font = '10px ui-monospace, monospace';
    for (const m of marks) {
      ctx.fillStyle = m.color;
      ctx.fillText(m.text, pad.l + iw + 6, m.y + 3);
    }

    // 图例：宽度按实际文字长度累加，放不下就换行（曲线多的时候不会挤成一坨）
    ctx.textAlign = 'left';
    ctx.font = '10px ui-sans-serif, system-ui';
    let lx = pad.l + 4, ly = pad.t + 6;
    for (const s of series) {
      const tw = ctx.measureText(s.label ?? s.key).width;
      if (lx + 12 + tw > pad.l + iw) { lx = pad.l + 4; ly += 13; }
      ctx.fillStyle = s.color;
      ctx.setLineDash(s.dash || []);
      ctx.beginPath(); ctx.moveTo(lx, ly - 1.5); ctx.lineTo(lx + 16, ly - 1.5);
      ctx.lineWidth = 1.8; ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(s.label ?? s.key, lx + 20, ly + 3);
      lx += 20 + tw + 14;
    }
  }
}
