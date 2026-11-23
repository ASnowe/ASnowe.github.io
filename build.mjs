/**
 * 把 src/ 下的源码打包成一个「双击即可运行」的独立 HTML 文件。
 *   node build.mjs
 * 产物： christmas/index.html （内联 three.js + 业务代码 + 样式，零外部请求）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const build = path.join(root, 'build');
fs.mkdirSync(build, { recursive: true });

/* ---- 定位 esbuild 可执行文件 ---- */
function esbuildBin() {
  const win = path.join(root, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe');
  if (fs.existsSync(win)) return win;
  const mac = path.join(root, 'node_modules', '@esbuild', 'darwin-arm64', 'esbuild');
  if (fs.existsSync(mac)) return mac;
  const linux = path.join(root, 'node_modules', '@esbuild', 'linux-x64', 'esbuild');
  if (fs.existsSync(linux)) return linux;
  return 'esbuild';
}

function run(args) {
  const r = spawnSync(esbuildBin(), args, { stdio: 'inherit', cwd: root });
  if (r.status !== 0) throw new Error('esbuild 失败: ' + args.join(' '));
}

/* ---- 1. 打包 JS / CSS ---- */
run([
  'src/main.js', '--bundle', '--minify', '--format=iife',
  '--target=es2019', '--legal-comments=none', '--outfile=build/app.js',
]);
run(['src/style.css', '--minify', '--outfile=build/app.css']);

/* ---- 2. 内联进 HTML ---- */
const jsCode = fs.readFileSync(path.join(build, 'app.js'), 'utf8').replace(/<\/script>/gi, '<\\/script>');
const cssCode = fs.readFileSync(path.join(build, 'app.css'), 'utf8');

let html = fs.readFileSync(path.join(root, 'src', 'shell.html'), 'utf8');
html = html.replace('/*__CSS__*/', () => cssCode);
html = html.replace('/*__JS__*/', () => jsCode);

const out = path.join(root, 'index.html');
fs.writeFileSync(out, html, 'utf8');
console.log(`✔ ${path.relative(process.cwd(), out)}  ${(html.length / 1024).toFixed(0)} KB  (零外部依赖)`);
