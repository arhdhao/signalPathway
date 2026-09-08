# 第一关 · NO–sGC–cGMP–PKG–PDE5 血管舒张通路

关卡 id `no-cgmp`。对照 KEGG map04022（cGMP-PKG 通路）+ 临床经典案例：西地那非竞争性抑制 PDE5。

## 这个文件夹怎么读 —— 六层数据 + 一个组装车间

| 文件 | 层 | 装什么 | 改了会怎样 |
|---|---|---|---|
| `view.ts` | ① VIEW | 画布尺寸 / 坐标 / 配色 / 连线样式 | 只影响画面 |
| `biology.ts` | ② BIOLOGY | 分子档案 + 反应关系（⚠️ 零数字） | 改变网络拓扑 |
| `interaction.ts` | ③ INTERACTION | 标签密码表，决定谁能碰谁 | 改变碰撞资格 |
| `kinetics.ts` | ④ KINETICS | 半饱和 / 衰减 / 频段 / 放大 / 槽位 | 改变手感与结局 |
| `game.ts` | ⑤ GAME | 规则 / 指标 / 药物 / 胜负 / 可调白名单 | 改变玩法与难度 |
| `copy.ts` | ⑥ COPY | 简报 / 提示 / 结算小知识 | 只影响文案 |
| `index.ts` | — | 组装车间：按 id 把六层拼成 `LevelConfig` | 见下方警告 |

`index.ts` 自己**不含任何数据**——只查表、合并、排序。

### 看到一个参数，问自己一句话，就知道它放哪层

- 「谁影响谁？」 → `biology.ts`　　例：PKG → PDE5
- 「谁有资格和谁碰？」 → `interaction.ts`　　例：PDE_Target 标签
- 「影响有多强、多快、多容易？」 → `kinetics.ts`　　例：hill = 1.4 / decay = 0.05
- 「玩家怎么玩、怎样算赢？」 → `game.ts`　　例：Ca 目标 45 / 药物 4 种
- 「屏幕上长什么样？」 → `view.ts`　　例：x = 630 / 紫色
- 「界面上写什么字？」 → `copy.ts`

### 想调什么 → 去哪个文件

| 目的 | 去哪 |
|---|---|
| 画面歪了 / 换配色 / 改连线文字 | `view.ts` |
| 加一个分子 / 加一条反应 / 改机制 | `biology.ts`（先改这里，再去 `kinetics.ts` 补数字） |
| 让两个分子不再互相碰撞 | `interaction.ts`（删标签比删反应边更符合机制本意） |
| 太难 / 太简单 / 时间不够 | `game.ts` 的 `OUTCOME` |
| 分子动力学、反应强度 | `kinetics.ts` |
| 药物剂量、机制、数量 | `game.ts` 的 `DRUGS` |
| 玩家能调哪些滑块 | `game.ts` 的 `EDITABLE` |
| 指标怎么算 / 曲线画什么 | `game.ts` 的 `METRICS` / `CHART` |
| 结算弹窗写什么话 | `copy.ts` 的 `outcomeText` |

⚠️ **引擎手感**（Buff 衰减倍率、随机抖动、激活阈值等）不在这里，它们在 `src/engine.ts` 顶部的 `TUNING` —— 而且改了会影响**所有**关卡。

## 改动后的验收标准

架构改变 ≠ 模拟规则改变。改完关卡后这两件事应当与改动前完全一致：

```bash
node tools/balance.mjs sweep   # 10 个随机种子的结局分布
node tools/balance.mjs         # 5 个标准场景的推演过程
npm run check                  # 类型检查 + 打包 + 冒烟
```

数字变了，说明 `index.ts` 漏搬了字段，回去查 `NODE_ORDER` / `REACTION_ORDER`。

⚠️ `index.ts` 里两个 ORDER 数组**顺序有意义，不要重排**：

- `NODE_ORDER` 决定画布绘制顺序（后面的盖在前面的上面）
- `REACTION_ORDER` 决定每 tick 的反应结算顺序，而结算要消耗随机数 —— 顺序一变，哪怕参数一个没改，整局推演结果也会变

## 做第二关的正确姿势

**复制整个文件夹改数据即可**，引擎 / 渲染器 / UI 都不用动：

- 分子与拓扑 → `biology.ts` + `interaction.ts` + `kinetics.ts`
- 指标怎么算 → `game.ts` 的 `METRICS` 里挑 kind（driven / mirror / derived）
- 判胜判负 → `game.ts` 的 `OUTCOME`（换指标、换分子、换阈值都在这一张表）
- 结算文案 → `copy.ts` 的 `outcomeText`
- 曲线画什么 → `game.ts` 的 `CHART.series`

这样第二关消耗 ATP 而不是 GTP、判的是别的分子、死法也完全不同，都不用改 `engine.ts`。
改完记得同步 `src/main.js` 里的 import 路径。

## 关于「更换底层模拟方式」

**好消息**：②③⑤⑥ 四层（拓扑 / 标签 / 玩法 / 文案）与求解器无关，换求解器时原样复用。

**坏消息**：`kinetics.ts` 的参数语义是**和求解器绑定的**，不是中立的「生物学数值」。

`band` / `hill` / `power` / `amplify` / `slots` 全是骰子求解器（`engine.ts` 的 `_resolveReaction`）的方言。换 Gillespie 或 ODE 时，这一整个文件要**重写一套**，而不是做字段映射：

```
kinetics.ts            （现在）骰子：band / hill / power / amplify / slots
kinetics/gillespie.ts  （将来）随机模拟：每个反应的速率常数 k + 化学计量
kinetics/ode.ts        （将来）微分方程：Vmax / Km / kcat / kdeg
```

文件夹结构就是为这一天留的——到那一步时新建 `kinetics/` 子目录，其余层文件一个字都不用改。

### 换 Gillespie 的两道坎（按难度排序）

1. **`biology.ts` 的 `effect` 是桌游动词，不是化学计量。**
   现在写的是 `activate` / `inhibit` / `produce` / `consume`，描述「游戏规则里这条边干什么」，
   而不是「反应消耗谁、生成谁、各几个」。Gillespie 要的是：

   ```
   PKG + MLCP → PKG + MLCP_p    （r4：PKG 不变，MLCP 变磷酸化态）
   cGMP       → GMP             （r6：cGMP 被消耗）
   GTP        → cGMP            （r2：消耗 GTP，产出 cGMP）
   ```

   需要给每条 reaction 补一份 stoichiometry，或写一张「effect → 计量式」的翻译表。
   **这是第一道坎，而且它不在引擎里，在这里。**

2. **tick 语义要改。**
   现在是固定 `TICK_MS = 100`（10 Hz），Gillespie 是**变步长事件驱动**。
   `render.js` 的动画、`CHART` 的「每 2 tick 采样一次」、UI 上的倒计时全都要跟着改。
   渲染层的工作量可能比引擎还大。

顺带一提：现有的 `slots` 竞争性抑制机制在 Gillespie 里反而**更自然**——
两个底物竞争同一个酶的速率常数是自然涌现的，不用专门写 `_resolveConsume`。

## 附：本文件夹内的其他文档

- `NO通路生物学参数设定.md` —— 参数背后的文献依据
- `修改关卡参数如何调试.md` —— 调参时怎么验证
