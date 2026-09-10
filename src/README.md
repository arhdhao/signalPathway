# src/ —— 源码

不懂代码可以整个忽略这个文件夹。

```
src/
├─ engine.ts            引擎：四步结算（匹配标签 → 掷骰子 → 挂 Buff → 乘数增量）
├─ render.js            画面：Canvas 2D 画节点、粒子、折线图
├─ ui.js                界面：道具栏、参数面板、检查器
├─ main.js              入口：把上面几块装起来，跑主循环
├─ styles.css           样式
├─ index.template.html  打包用的网页骨架（build.js 往里塞代码）
├─ dev.html             调试页：加载编译产物，配合本地服务器实时预览
└─ pathways/            关卡数据，一个关卡一个文件夹
   └─ nocgmp/           第一关：NO–sGC–cGMP–PKG–PDE5
```

想读代码的话别从这里硬啃 —— 看 `docs/给开发者/代码阅读指南.md`，
里面有推荐的阅读顺序。

关卡目录 `pathways/nocgmp/` 按「变化的理由」拆成了 6 层
（画面布局 / 生物学拓扑 / 交互 / 动力学参数 / 游戏规则 / 文案），
细节见它自己的 `README.md`。
