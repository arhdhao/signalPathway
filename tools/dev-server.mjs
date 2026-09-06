/* ============================================================================
 * 开发预览服务器（零依赖，只用 node 内置模块）
 *   node tools/dev-server.mjs            # 默认端口 8123
 *   node tools/dev-server.mjs 9000       # 自定义端口
 *
 * 为什么需要它：
 *   file:// 协议下浏览器的 ES module import 会被 CORS 拦截，所以正式版必须打包成
 *   单文件（dist/）。但开发时频繁改参数，每次都跑 tools/build.js 太烦 ——
 *   起一个本地服务器走 http://，浏览器就能直接加载 src/ 下的源码模块。
 *
 * 用法：
 *   1. node tools/dev-server.mjs
 *   2. 浏览器打开 http://localhost:8123/src/dev.html
 *   3. 改 src 下任意文件 → 刷新浏览器 → 立即生效（不用打包）
 *
 * 注意：这个服务器只服务本机，用于开发调试。要发布给别人，仍用
 *   node tools/build.js 生成 dist/信号通路模拟器.html（可双击运行）。
 * ==========================================================================*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.argv[2]) || 8123;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname);
  let filePath = path.normalize(path.join(ROOT, pathname));

  // 防目录穿越：解析后必须在项目根目录内
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Not Found: ${pathname}`);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store', // 开发模式：禁止缓存，保证改完刷新即新
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ✔ 开发服务器已启动（仅本机可访问）');
  console.log('');
  console.log(`    浏览器打开: http://localhost:${PORT}/src/dev.html`);
  console.log('');
    console.log('    之后的工作流：');
    console.log('      先跑编译 watch（另开终端）： ./node_modules/.bin/tsc -w');
    console.log('      改 src/ 下的 .ts/.js → tsc 自动重编到 build/ → 刷新浏览器即可');
    console.log('      （浏览器不能直接跑 .ts，故 dev 页加载 build/ 产物）');
  console.log('');
  console.log('    要发布给别人用时才需要打包: node tools/build.js');
  console.log('    按 Ctrl+C 停止本服务器。');
  console.log('');
});
