# 项目长期记忆 · 信号通路模拟

## 定位
Signaling Pathway Simulator —— 细胞信号转导模拟游戏。
不追求定量精确，主打**定性拓扑逻辑推演**：让玩家通过投放抑制剂/激活剂，
寻找网络中的关键调控枢纽，恢复或维持细胞稳态。

目标受众双向：对学生是"直观的因果教学模拟器"，对研究人员是"轻量级的假说验证器"。

## 技术栈（已定，不要轻易改）
- **纯 HTML5 + Canvas 2D，不引入 Cocos / Godot / 游戏引擎**
- **源码为 TypeScript**（2026-09-06 迁入）：逻辑核心 `src/engine.ts` + 关卡数据
  `src/pathways/nocgmp.ts` 已全面类型化；`render.js/ui.js/main.js` 暂仍是 .js（allowJs 一并编译）
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

## 扩展方向（PDF 里的远期规划）
- 解析 KEGG KGML / Reactome 数据文件自动生成关卡拓扑
- 分层展开：主干路线 + 点击枢纽节点展开内部细节
- 进阶关卡开放"串扰接口"，可拼接子网络
- 存档导出为 JSON，供他人复现模拟状态
- 跑通后在 GitHub 开源，关卡贡献者署名在感谢页
