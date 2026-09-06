# 项目长期记忆 · 信号通路模拟

## 定位
Signaling Pathway Simulator —— 细胞信号转导模拟游戏。
不追求定量精确，主打**定性拓扑逻辑推演**：让玩家通过投放抑制剂/激活剂，
寻找网络中的关键调控枢纽，恢复或维持细胞稳态。

目标受众双向：对学生是"直观的因果教学模拟器"，对研究人员是"轻量级的假说验证器"。

## 技术栈（已定，不要轻易改）
- **纯 HTML5 + Canvas 2D，不引入 Cocos / Godot / 游戏引擎**
- 逻辑层 TypeScript 风格书写（JSDoc 标注），但当前以 ES module 形式交付
- 构建：`node tools/build.js` 把 ES module 合并为单文件 `dist/信号通路模拟器.html`
  （file:// 下 import 会被 CORS 拦截，所以必须合并，用户才能双击运行）
- 测试：改完务必跑 `node tools/build.js && node tools/smoke.mjs`

## 底层规则（PDF 定下的，不可改）
四步结算：`匹配标签(tags)` → `掷骰子(band)` → `挂 Buff(activation/timer)` → `乘数增量(amplify)`
三种失败：能量枯竭（GTP 归零）/ 脱靶毒性（红区超载）/ 无响应（超时）
80% 的常规分子参数写死，只开放 20% 关键节点给玩家调参。

## 工作流约定
- 改参数 → 跑 `tools/balance.mjs`（5 场景）或 `tools/sweep.mjs`（网格搜索）
- 改代码 → 跑 `tools/build.js` 再跑 `tools/smoke.mjs`
- 参数配平靠脚本扫，不靠手调（一阶动力学的饱和特性反直觉，手调必然踩坑）

## 扩展方向（PDF 里的远期规划）
- 解析 KEGG KGML / Reactome 数据文件自动生成关卡拓扑
- 分层展开：主干路线 + 点击枢纽节点展开内部细节
- 进阶关卡开放"串扰接口"，可拼接子网络
- 存档导出为 JSON，供他人复现模拟状态
- 跑通后在 GitHub 开源，关卡贡献者署名在感谢页
