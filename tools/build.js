/* ============================================================================
 * 构建：把 ES module 源码合并成一个可双击运行的 HTML 文件
 *   node tools/build.js
 *
 * 之所以要合并：file:// 协议下 ES module 的 import 会被 CORS 拦截，
 * 合成单文件后用户不需要起本地服务器就能直接打开。
 *
 * ----------------------------------------------------------------------------
 * 打包策略（2026-09-05 重构，此前是「正则删 import/export + 硬编码文件列表」）
 *
 *   ① 自动依赖图：解析每个文件的 import，从入口 main.js 出发 DFS 拓扑排序。
 *      新增 / 重命名 / 删除源文件都不必再回来改这个脚本。
 *
 *   ② 作用域隔离：每个模块包进 IIFE，导出收集到 __MODULES__ 命名空间表，
 *      import 翻译成解构赋值。此前所有模块的顶层符号共享同一作用域，
 *      35 个符号平铺、零冲突纯属运气 —— 新文件里写个 `const ui` 就会
 *      SyntaxError 且难以定位。包 IIFE 后从根本上消除这类冲突。
 *
 *   ③ 构建期校验：循环依赖 / 缺失导出 / 语法错误，全部在进入 dist 之前报错。
 *
 * ⚠️ 本脚本只处理本项目实际用到的 import/export 语法子集（具名、默认、
 *    命名空间、别名、裸导入）。若引入更冷门的 ESM 语法（如动态 import、
 *    export ... from），需要同步扩展 parseModule()。
 * ==========================================================================*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
/** 模块真源目录 —— 自 2026-09-06 起源码为 TypeScript，tools/ 先跑 tsc 编译到 build/，
 *  本脚本只打包「已编译好的 ESM 产物」。CSS 与 HTML 模板仍从 src/ 读。 */
const MOD = path.join(ROOT, 'build');
const DIST = path.join(ROOT, 'dist');

/** 入口。只有从这里可达的模块才会被打进产物。 */
const ENTRY = 'main.js';

/** 干净地报错并退出 —— 构建失败时不甩裸 stack trace 给用户 */
function fail(title, detail) {
  console.error(`\n  ✖ 构建失败：${title}`);
  if (detail) console.error(`    ${detail}`);
  process.exit(1);
}

/* ============================================================ 源码扫描 */

/** 递归列出 src 下所有 .js，返回 POSIX 风格的相对路径（如 'pathways/nocgmp.js'） */
function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else if (e.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

/* ======================================================= 模块语法解析 */

// import { A, B as C } from './x.js';   —— 含多行形式（子句内不允许引号/分号，故不会跨越语句）
const IMPORT_RE = /^[ \t]*import\s+([^;'"]*?)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm;
// import './x.js';                      —— 只为副作用而导入
const IMPORT_BARE_RE = /^[ \t]*import\s+['"]([^'"]+)['"];?[ \t]*$/gm;

// export const X = ... / export class X / export function X / export async function X
const EXPORT_DECL_RE = /^([ \t]*)export\s+(const|let|var|class|function|async function)\s+([A-Za-z_$][\w$]*)/gm;
// export { A, B as C };
const EXPORT_LIST_RE = /^[ \t]*export\s*\{([^}]*)\}\s*;?[ \t]*$/gm;
// export default X;                     —— 单行标识符形式（本项目 nocgmp.js 用的就是这个）
const EXPORT_DEFAULT_ID_RE = /^[ \t]*export\s+default\s+([A-Za-z_$][\w$.]*)\s*;?[ \t]*$/gm;
// export default class X / export default function X
const EXPORT_DEFAULT_DECL_RE = /^([ \t]*)export\s+default\s+(class|function)\s+([A-Za-z_$][\w$]*)/gm;

/** 把 import 子句拆成具体的绑定形态 */
function parseImportClause(clause) {
  const result = { named: [], defaultName: null, namespace: null };
  const trimmed = clause.trim();

  const ns = trimmed.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
  if (ns) { result.namespace = ns[1]; return result; }

  // 先剥掉花括号部分，剩下的就是默认导入
  const brace = trimmed.match(/\{([^}]*)\}/);
  let rest = trimmed;
  if (brace) {
    rest = (trimmed.slice(0, brace.index) + trimmed.slice(brace.index + brace[0].length)).trim();
    for (const part of brace[1].split(',')) {
      const p = part.trim();
      if (!p) continue;
      const as = p.split(/\s+as\s+/);
      if (as.length === 2) result.named.push({ imported: as[0].trim(), local: as[1].trim() });
      else result.named.push({ imported: p, local: p });
    }
  }
  rest = rest.replace(/,$/, '').trim();
  if (rest) result.defaultName = rest;
  return result;
}

/**
 * 解析单个模块文件。
 * @returns {{ id, code, deps: string[], imports: Array, exports: Map<string,string> }}
 *          exports 是 Map<对外导出名, 模块内局部名>
 */
function parseModule(id) {
  const raw = fs.readFileSync(path.join(MOD, id), 'utf8');
  const exportsMap = new Map();
  const imports = [];
  const deps = [];

  let code = raw;

  /* --- import --- */
  code = code.replace(IMPORT_RE, (m, clause, spec) => {
    const dep = path.posix.normalize(path.posix.join(path.posix.dirname(id), spec));
    const parsed = parseImportClause(clause);
    imports.push({ id: dep, ...parsed });
    if (!deps.includes(dep)) deps.push(dep);
    return `/* import from ${spec} */`;
  });
  code = code.replace(IMPORT_BARE_RE, (m, spec) => {
    const dep = path.posix.normalize(path.posix.join(path.posix.dirname(id), spec));
    imports.push({ id: dep, named: [], defaultName: null, namespace: null });
    if (!deps.includes(dep)) deps.push(dep);
    return `/* import ${spec} */`;
  });

  /* --- export --- */
  code = code.replace(EXPORT_DECL_RE, (m, indent, kw, name) => {
    exportsMap.set(name, name);
    return `${indent}${kw} ${name}`;
  });

  code = code.replace(EXPORT_DEFAULT_DECL_RE, (m, indent, kw, name) => {
    exportsMap.set(name, name);
    exportsMap.set('default', name);
    return `${indent}${kw} ${name}`;
  });

  code = code.replace(EXPORT_DEFAULT_ID_RE, (m, name) => {
    exportsMap.set('default', name);
    return '';
  });

  code = code.replace(EXPORT_LIST_RE, (m, list) => {
    for (const part of list.split(',')) {
      const p = part.trim();
      if (!p) continue;
      const as = p.split(/\s+as\s+/);
      if (as.length === 2) exportsMap.set(as[1].trim(), as[0].trim());
      else exportsMap.set(p, p);
    }
    return '';
  });

  // 兜底：还剩 export（说明遇到了本脚本未覆盖的语法，多行的 export default 表达式等）
  const leftover = code.match(/^[ \t]*export\s/m);
  if (leftover) {
    const at = code.search(/^[ \t]*export\s/m);
    fail(
      `${id} 使用了本脚本未处理的 export 语法`,
      `附近内容：${code.slice(at, at + 70).replace(/\n/g, '\\n')}\n` +
      `    处理办法：扩展 parseModule() 的转换规则，或改用已支持的写法。`
    );
  }

  return { id, code: code.trim(), deps, imports, exports: exportsMap };
}

/* ================================================== 依赖图与拓扑排序 */

const files = walk(MOD);
const modules = new Map(files.map((f) => [f, parseModule(f)]));

const order = [];
const state = new Map();
const stack = [];

function visit(id) {
  if (state.get(id) === 'done') return;
  if (state.get(id) === 'visiting') {
    const cycle = stack.slice(stack.indexOf(id)).concat(id);
    fail('检测到循环依赖', cycle.join('  →  ') + '\n    循环依赖在单文件打包下无法确定初始化顺序，请改为让双方依赖第三个模块。');
  }
  if (!modules.has(id)) fail(`依赖了不存在的文件：${id}`, `被引用于：${stack[stack.length - 1] || ENTRY}`);

  state.set(id, 'visiting');
  stack.push(id);
  for (const dep of modules.get(id).deps) visit(dep);
  stack.pop();
  state.set(id, 'done');
  order.push(id); // 后序：被依赖者先入列
}

if (!modules.has(ENTRY)) fail(`入口文件不存在：${path.relative(ROOT, path.join(MOD, ENTRY))}`, '请检查 ENTRY 常量，或先跑 tsc 编译。');
visit(ENTRY);

/* ======================================================== 构建期校验 */

// 校验一：import 的符号确实被目标模块导出（提前抓出拼写错误 / 重构遗漏）
for (const id of order) {
  const mod = modules.get(id);
  for (const imp of mod.imports) {
    const target = modules.get(imp.id);
    for (const n of imp.named) {
      if (!target.exports.has(n.imported)) {
        fail(
          `${id} 从 ${imp.id} 导入了 '${n.imported}'，但对方并未导出它`,
          `${imp.id} 实际导出：${[...target.exports.keys()].join(', ') || '（无）'}`
        );
      }
    }
    if (imp.defaultName && !target.exports.has('default')) {
      fail(`${id} 从 ${imp.id} 导入了默认导出，但对方没有 default`);
    }
  }
}

const unreachable = files.filter((f) => !order.includes(f));

/* ============================================================== 生成 */

const moduleVar = '__MODULES__';

function importStatements(mod) {
  return mod.imports.map((imp) => {
    const ref = `${moduleVar}[${JSON.stringify(imp.id)}]`;
    const lines = [];
    if (imp.namespace) lines.push(`const ${imp.namespace} = ${ref};`);
    if (imp.defaultName) lines.push(`const ${imp.defaultName} = ${ref}.default;`);
    if (imp.named.length) {
      const binding = imp.named
        .map((n) => (n.imported === n.local ? n.imported : `${n.imported}: ${n.local}`))
        .join(', ');
      lines.push(`const { ${binding} } = ${ref};`);
    }
    return lines.length ? lines.join('\n') : `void ${ref};`;
  }).join('\n');
}

function exportStatement(mod) {
  if (mod.exports.size === 0) return 'return {};';
  const pairs = [...mod.exports].map(([exported, local]) => `${exported}: ${local}`);
  return `return { ${pairs.join(', ')} };`;
}

let js = '';
for (const id of order) {
  const mod = modules.get(id);
  js += `\n/* ================================ ${id} ================================ */\n`;
  js += `${moduleVar}[${JSON.stringify(id)}] = (function () {\n`;
  const head = importStatements(mod);
  if (head) js += head + '\n';
  js += mod.code + '\n';
  js += exportStatement(mod) + '\n';
  js += `})();\n`;
}

// 整个 bundle 再包一层：内部变量不泄漏到全局，也不污染 smoke 测试的 sandbox
const bundle = `(function () {\n'use strict';\nconst ${moduleVar} = {};\n${js}\n})();\n`;

// 语法体检：只编译不执行，能提前抓出拼接导致的错误
try {
  new vm.Script(bundle, { filename: 'bundle.js' });
} catch (e) {
  if (process.env.DEBUG) console.error(e.stack);
  fail(
    '拼接后的 JS 存在语法错误',
    `${e.message}\n    源码本身是合法的 ESM，所以这通常是本脚本的模块转换逻辑有问题。\n    加 DEBUG=1 重新构建可打印完整堆栈。`
  );
}

/* ============================================================== 输出 */

const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');
const tpl = fs.readFileSync(path.join(SRC, 'index.template.html'), 'utf8');

const html = tpl
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => bundle);

if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
const out = path.join(DIST, '信号通路模拟器.html');
fs.writeFileSync(out, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);

console.log('  依赖拓扑（打包顺序）：');
for (const id of order) {
  const m = modules.get(id);
  const ex = [...m.exports.keys()].filter((k) => k !== 'default');
  console.log(`    ${id.padEnd(20)} 依赖 ${String(m.deps.length).padStart(2)} 个  ·  导出 ${ex.length ? ex.join(', ') : '（无）'}`);
}
if (unreachable.length) {
  console.log(`  · 未被入口引用，已跳过：${unreachable.join(', ')}`);
}
console.log('  ✔ 循环依赖检查通过');
console.log('  ✔ 导入符号校验通过');
console.log('  ✔ JS 语法检查通过');
console.log(`  ✔ 作用域隔离：${order.length} 个模块各自包进 IIFE，顶层符号不再互相覆盖`);
console.log(`  ✔ 已生成 ${path.relative(ROOT, out)}  (${kb} KB)`);
