# 项目长期记忆 · 信号通路模拟

## 定位
Signaling Pathway Simulator —— 细胞信号转导模拟游戏。
不追求定量精确，主打**定性拓扑逻辑推演**：让玩家通过投放抑制剂/激活剂，
寻找网络中的关键调控枢纽，恢复或维持细胞稳态。

目标受众双向：对学生是"直观的因果教学模拟器"，对研究人员是"轻量级的假说验证器"。

## 技术栈（已定，不要轻易改）
- **纯 HTML5 + Canvas 2D，不引入 Cocos / Godot / 游戏引擎**
- **源码为 TypeScript**（2026-09-06 迁入）：逻辑核心 `src/engine.ts` + 关卡数据
  `src/pathways/nocgmp/` 已全面类型化；`render.js/ui.js/main.js` 暂仍是 .js（allowJs 一并编译）
- **关卡 = 文件夹，不是单文件**（2026-09-08 拆分）：
  `nocgmp/{view,biology,interaction,kinetics,game,copy,index}.ts` + README + 两份参数文档。
  按「变化的理由」分六层，`index.ts` 只做按 id 查表合并。
  build.js 是自动依赖图 DFS，拆子目录零改造；但孤儿文件会被 `unreachable` 剔除，
  新文件必须被 index.ts 引用。
  ⚠️ `index.ts` 的 NODE_ORDER / REACTION_ORDER **顺序有意义**（决定绘制层级与随机数消耗顺序），
  重排会让整局推演结果改变。
- **构建链（三连）**：
  1. `tsc -p tsconfig.json` → 严格类型检查 + 编译 ESM 产物到 `build/`
  2. `node tools/build.js` → 从 `build/` 打包单文件 `dist/信号通路模拟器.html`
  3. `node tools/smoke.mjs` → 回归
  一条命令：`npm run check`（= build:ts + build + smoke）
- 配平工具 balance/sweep 的 import 已改指 `../build/*`（编译产物）
- dev 页加载 `build/main.js`（浏览器跑不了 .ts），配合 `./node_modules/.bin/tsc -w` 实时重编
- tsconfig 关键取舍：`strictPropertyInitialization:false`（类字段经 Object.assign 默认值初始化，
  tsc 静态追踪不了）；`verbatimModuleSyntax` + `allowJs` + bundler resolution
- 类型收益实证：关卡 effect 枚举拼错会报 TS2820 并给修正建议，编译期拦截而非运行期炸

## 底层规则（PDF 定下的，不可改）
四步结算：`匹配标签(tags)` → `掷骰子(band)` → `挂 Buff(activation/timer)` → `乘数增量(amplify)`
三种失败：能量枯竭（GTP 归零）/ 脱靶毒性（红区超载）/ 无响应（超时）
80% 的常规分子参数写死，只开放 20% 关键节点给玩家调参。

## 工作流约定
- 一条命令走全回归：`npm run check`（= tsc 类型检查+编译 → build.js 打包 → smoke.mjs）
- 改代码 → 至少跑 `npm run typecheck`（tsc --noEmit）确认类型绿，再 `npm run check`
- 改参数 → 跑 `tools/balance.mjs`（5 场景）或 `tools/sweep.mjs`（网格搜索）——注意它们吃 build/ 产物，
  改完参数须先 `npm run build:ts`
- 参数配平靠脚本扫，不靠手调（一阶动力学的饱和特性反直觉，手调必然踩坑）
- dev 调试 → `node tools/dev-server.mjs` + 另开终端 `npm run watch`（tsc 监听实时重编到 build/）
- **纯重构的验收标准**：动手前先 `node tools/balance.mjs > 基线.txt`，改完 diff 必须逐行一致
  （注意过滤 MODULE_TYPELESS 那几行 warning，带 PID 会假报差异）。
  「架构改变 ≠ 模拟规则改变」—— 数字变了就是 index.ts 漏搬字段

## 更换求解器（Gillespie，arhdhao 2026-09-08 选的远期方向）
- **②③⑤⑥ 四层与求解器无关**，换求解器时原样复用；只有 `kinetics.ts` 整个重写。
  它的 band/hill/power/amplify/slots 全是骰子求解器的方言，与 Vmax/Km/kcat 语义正交，
  **不能做字段映射，只能换一套**。文件夹结构已为此留位（`kinetics/` 子目录）。
- **第一道坎不在引擎，在 `biology.ts`**：effect 四枚举是「桌游动词」不是化学计量，
  Gillespie 要 `PKG + MLCP → PKG + MLCP_p`。需补 stoichiometry 或写翻译表。
- **第二道坎是 tick 语义**：现固定 100ms（10Hz），Gillespie 是变步长事件驱动；
  render 动画 / CHART 每 2 tick 采样 / UI 倒计时全要改，渲染层工作量可能大于引擎。
- 反向利好：`slots` 竞争性抑制在 Gillespie 里是自然涌现的（两底物争同一酶速率常数），
  不用专门写 `_resolveConsume`。

## 扩展方向（PDF 里的远期规划）
- 解析 KEGG KGML / Reactome 数据文件自动生成关卡拓扑
- 分层展开：主干路线 + 点击枢纽节点展开内部细节
- 进阶关卡开放"串扰接口"，可拼接子网络
- 存档导出为 JSON，供他人复现模拟状态
- 跑通后在 GitHub 开源，关卡贡献者署名在感谢页

## 文档体系（docs/00基础知识/ 三件套）
同一个问题拆成三个层次，写新文档前先想清楚它落在哪一层：

| 文档 | 面向 | 回答 |
|---|---|---|
| 细胞信号通路入门 | 零基础爱好者 | **谁作用于谁**（拓扑与因果） |
| 生化反应动力学 | 关卡作者 / 深度玩家 | **多快、多强**（速率与参数） |
| 模拟机制介绍 | 开发与设计人员 | **代码怎么算**（工程实现） |

配 `docs/参数调参清单.md`（A/B/C/D 四档风险分级）与 `docs/代码阅读指南.md` 食用。
统一写作风格：`〇/一/二…` 编号 + `>` 引用块 + 💡🔬⚠️🎉 提示 + ASCII 图 + 高密度表格 + 附录术语对照表。
写长文档时务必在写完后通读校验 —— 长输出的后段容易出现字符混杂，已踩过一次。

## 骰子求解器的三条隐藏性质（2026-09-09 读引擎时发现）
1. **`hill` 会右移半程点，不是纯变陡。** 引擎用嵌套形式 `(S/(S+K))ⁿ`，不是经典 Hill 的
   `Sⁿ/(Kⁿ+Sⁿ)`。半程点 `S = K·p/(1−p)`，`p = 0.5^(1/n)`：
   n=1 → 1.00K｜1.4 → 1.56K｜1.6 → 1.84K｜2.0 → 2.41K。
   ⇒ **调 `hill` 必须同步补 `K`**。`04kinetics.ts` 的注释里没写这条。
2. **槽位竞争是「零级区近似」的竞争性抑制。** 引擎 `v = cap·[S]/([S]+[I])` 分母**无 Km 项**，
   而米氏竞争 `v = Vmax[S]/(Km(1+[I]/Ki)+[S])`。等价于假设酶始终被底物占满
   ⇒ 抑制剂效果被放大、更直觉，但丢掉了「高底物平滑克服竞争」的过渡曲线。是有意选的层级。
3. **振荡是结构性必然。** `amplify(14) > slots(7.5)` ⇒ PDE5 满激活产能也仅 sGC 的 54%；
   sGC 持续点亮时需 `baseDecay` 补 (14−7.5)/0.022 ≈ 295 才平衡，远超红线 190
   ⇒ **不存在低于红线的高 cGMP 稳态** ⇒ 必然来回摆动（极限环）。
   想压平应该动这个比例（`slots`），而不是拧胜负阈值。
