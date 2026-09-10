# tools/ —— 开发用的小脚本

不懂代码的话，这个文件夹可以直接忽略。
日常操作走根目录的两个 `.bat` 就够了，不用碰这里。

| 文件 | 干什么 | 什么时候用 |
|---|---|---|
| `build.js` | 把编译产物打包成单个 HTML，放进 `dist/` | 改了源码，要出成品 |
| `smoke-test.mjs` | 冒烟测试：在 Node 里用假 DOM 跑 7200 帧，检查装配和渲染有没有炸 | 打包之后验一遍 |
| `balance.mjs` | 参数配平：跑 5 个标准场景，看结局是否符合预期 | 改了关卡数值 |
| `sweep.mjs` | 网格搜索 / 多种子敏感性分析，大范围找参数 | 单个参数怎么调都不对时 |
| `dev-server.mjs` | 本地静态服务器，配合 `npm run watch` 实时预览 | 调界面和画面 |

对应命令（在项目根目录执行）：

```
node tools/build.js          # 打包
node tools/smoke-test.mjs    # 冒烟测试
node tools/balance.mjs       # 配平 5 场景
node tools/sweep.mjs         # 网格搜索
node tools/dev-server.mjs    # 起本地服务器
```

一条命令走全流程：`npm run check`（类型检查 → 编译 → 打包 → 冒烟）。

> **文件名故意保留英文**：这些要在命令行里敲，中文名来回切输入法太难受。
> 忘了哪个是干嘛的就回来看这张表。

⚠️ `balance.mjs` 和 `sweep.mjs` 读的是 `build/` 里的**编译产物**，不是 `.ts` 源码。
改完参数必须先 `npm run build:ts`，否则跑出来的是旧数字。
