/**
 * 自动化验收：启动 headless Chromium，加载 index.html，
 * 截图 + 模拟交互（悬停 / 点击星辰 / 缩放 / 拖拽），并输出诊断数据。
 *
 *   node tools/cdp.mjs [--url=file:///D:/obo/christmas/index.html]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:/Users/W10/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe';
const PORT = 9333;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const OUT = path.join(ROOT, 'shots');
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const VW = parseInt(arg('w', '1600'), 10);
const VH = parseInt(arg('h', '900'), 10);
const TAG = arg('tag', '');
const TARGET = arg('url', 'file:///D:/obo/christmas/index.html');

fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- CDP 客户端 ---------------- */
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
  }
  async open() {
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  close() { try { this.ws.close(); } catch {} }
}

/* ---------------- 启动浏览器 ---------------- */
const profile = path.join(ROOT, '.chrome-profile');
const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu-sandbox',
  '--disable-crash-reporter',
  '--disable-breakpad',
  '--disable-dev-shm-usage',
  '--disable-features=Crashpad',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--hide-scrollbars', '--mute-audio',
  `--window-size=${VW},${VH}`,
  '--allow-file-access-from-files',
  TARGET,
], { stdio: 'ignore', detached: false });

let version = null;
for (let i = 0; i < 60; i++) {
  try {
    version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    break;
  } catch { await sleep(400); }
}
if (!version) { console.error('无法连接 Chromium'); chrome.kill(); process.exit(1); }
console.log('浏览器:', version['Browser']);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const cdp = new CDP(page.webSocketDebuggerUrl);
await cdp.open();

await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Log.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });

async function evalJS(expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}

async function shot(name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, (TAG ? TAG + '-' : '') + name + '.png');
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('  📸', path.relative(ROOT, file));
}

async function mouse(type, x, y, extra = {}) {
  await cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons: type === 'mouseMoved' && extra.down ? 1 : (type === 'mousePressed' ? 1 : 0),
    clickCount: type === 'mousePressed' || type === 'mouseReleased' ? 1 : 0,
    ...extra,
  });
}

async function key(k, code, vk) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
}

/* ---------------- 测试流程 ---------------- */
const problems = [];
try {
  await cdp.send('Page.navigate', { url: TARGET });
  await sleep(6000);

  const ready = await evalJS('!!window.__xmas');
  if (!ready) problems.push('页面未初始化（window.__xmas 不存在）');

  const info1 = await evalJS('window.__xmas ? window.__xmas.info : null');
  console.log('场景:', JSON.stringify(info1));
  await shot('01-overview');

  // 悬停到树冠上的一颗星
  const total = (info1 && info1.stars) || 0;
  const target = await evalJS(`(() => {
    const x = window.__xmas;
    if (!x) return null;
    const total = ${total};
    const VW = ${VW}, VH = ${VH};
    let best = null;
    for (let k = 0; k < 8000; k++) {
      const idx = Math.floor(Math.random() * total);
      const p = x.project(idx);
      if (!p || !isFinite(p.x) || p.z > 1 || p.z < -1) continue;
      if (p.x < VW * 0.52 || p.x > VW * 0.9 || p.y < VH * 0.12 || p.y > VH * 0.8) continue;
      best = { idx, x: Math.round(p.x), y: Math.round(p.y) };
      break;
    }
    return best;
  })()`);
  console.log('目标星辰:', JSON.stringify(target));

  if (target) {
    await mouse('mouseMoved', target.x, target.y);
    await sleep(400);
    const hoverInfo = await evalJS('window.__xmas.info');
    console.log('悬停:', JSON.stringify(hoverInfo));
    await shot('02-hover');

    await mouse('mousePressed', target.x, target.y);
    await sleep(60);
    await mouse('mouseReleased', target.x, target.y);
    await sleep(3000);
    await shot('03-focus-mid');
    await sleep(9000);
    const focusInfo = await evalJS('window.__xmas.info');
    console.log('聚焦后:', JSON.stringify(focusInfo));
    if (focusInfo.mode !== 'focus') problems.push('点击星辰后未切换到该星辰视角');
    await shot('04-focus');
  } else {
    problems.push('未找到可用于点击的屏幕坐标');
  }

  // 缩放
  await evalJS(`window.__wheelSeen = 0; window.addEventListener('wheel', () => { window.__wheelSeen++; }, true);`);
  await mouse('mouseMoved', VW / 2, VH * 0.22);
  await sleep(200);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: VW / 2, y: VH * 0.22, deltaX: 0, deltaY: -240, pointerType: 'mouse' });
  await sleep(2500);
  const zoomInfo = await evalJS('window.__xmas.info');
  const wheelSeen = await evalJS('window.__wheelSeen');
  console.log('缩放后:', JSON.stringify(zoomInfo), 'window wheel events:', wheelSeen);
  if (!wheelSeen) problems.push('滚轮事件未送达页面');
  if (Math.abs(zoomInfo.distTarget - zoomInfo.dist) > 0.01 && Math.abs(zoomInfo.distTarget - 0.6) > 0.01) {
    problems.push('滚轮未触发缩放（distTarget=' + zoomInfo.distTarget + '）');
  }
  await shot('05-zoom');

  // 拖拽
  await mouse('mouseMoved', VW / 2, VH / 2);
  await mouse('mousePressed', VW / 2, VH / 2);
  for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', VW / 2 + i * 18, VH / 2 + i * 4, { down: true, buttons: 1 }); await sleep(30); }
  await mouse('mouseReleased', VW / 2 + 8 * 18, VH / 2 + 8 * 4);
  await sleep(3000);
  await shot('06-drag');

  // 返回全景（先用固定步长推进模拟，规避软件渲染的极低帧率）
  await key('Escape', 'Escape', 27);
  await sleep(600);
  const backInfo = await evalJS('window.__xmas.step(3.0)');
  console.log('返回后:', JSON.stringify(backInfo));
  if (backInfo.mode !== 'overview') problems.push('Esc 未返回全景');
  if (Math.abs(backInfo.dist - 16.8) > 0.9) problems.push('Esc 未把镜头拉回全景（dist=' + backInfo.dist + '）');
  await sleep(1200);
  await shot('07-back');

  // 隐藏界面（纯净截图）
  await key('h', 'KeyH', 72);
  await sleep(3000);
  await shot('08-clean');

  /* ---- 工具栏 / 功能开关 ---- */
  const acts = ['snow', 'lines', 'sound', 'snow', 'lines', 'sound', 'reshuffle', 'reset'];
  for (const act of acts) {
    const r = await evalJS(`(() => {
      const b = document.querySelector('.tool[data-act="${act}"]');
      if (!b) return 'missing';
      b.click();
      return 'ok';
    })()`);
    if (r !== 'ok') problems.push('工具栏按钮缺失: ' + act);
    await sleep(900);
  }
  await sleep(3000);
  const after = await evalJS('window.__xmas.info');
  console.log('工具栏操作后:', JSON.stringify(after));
  if (after.stars < 1000) problems.push('换星空后星辰数量异常: ' + after.stars);
  await shot('09-reshuffle');
} catch (e) {
  problems.push('异常: ' + e.message);
}

/* 控制台错误 */
const errs = cdp.events.filter((e) =>
  (e.method === 'Runtime.exceptionThrown') ||
  (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') ||
  (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
if (errs.length) {
  console.log('\n控制台错误:');
  for (const e of errs.slice(0, 12)) {
    console.log('  ✖', JSON.stringify(e.params).slice(0, 400));
  }
  problems.push(`控制台出现 ${errs.length} 条错误`);
}

console.log('\n' + (problems.length ? '❌ 问题:\n - ' + problems.join('\n - ') : '✅ 全部检查通过'));

cdp.close();
chrome.kill();
process.exit(problems.length ? 1 : 0);
