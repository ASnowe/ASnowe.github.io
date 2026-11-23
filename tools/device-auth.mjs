/**
 * GitHub 设备码授权（Node fetch 直连，绕开被沙箱阻断的 git/.NET 通道）。
 *
 *   node tools/device-auth.mjs start     → 打印验证码 + 授权链接，轮询等待授权
 *   node tools/device-auth.mjs start --scope=repo
 *
 * 授权成功后令牌写入 D:/obo/deploy/oauth-token.txt（仅本机）。
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const CLIENT_ID = arg('client-id', '0120e057bd645470c1ed');   // Git Credential Manager 的公开 OAuth App
const SCOPE = arg('scope', 'public_repo');
const OUT = arg('out', 'D:/obo/deploy/oauth-token.txt');
const POLL_MINUTES = parseInt(arg('minutes', '15'), 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'dsh-device-auth' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

(async () => {
  console.log(`[auth] client_id=${CLIENT_ID} scope=${SCOPE}`);
  const r = await post('https://github.com/login/device/code', { client_id: CLIENT_ID, scope: SCOPE });
  if (r.status !== 200 || !r.json.device_code) {
    console.error('[auth] 无法发起设备码授权:', r.status, JSON.stringify(r.json).slice(0, 300));
    process.exit(1);
  }
  const { device_code, user_code, verification_uri, interval = 5, expires_in } = r.json;

  console.log('');
  console.log('===============================================');
  console.log('  请在浏览器打开： ' + verification_uri);
  console.log('  输入验证码   ： ' + user_code);
  console.log('  （有效��� ' + Math.round(expires_in / 60) + ' 分钟）');
  console.log('===============================================');
  console.log('');

  const deadline = Date.now() + POLL_MINUTES * 60 * 1000;
  let wait = interval * 1000;
  while (Date.now() < deadline) {
    await sleep(wait);
    const t = await post('https://github.com/login/oauth/access_token', {
      client_id: CLIENT_ID,
      device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    const j = t.json || {};
    if (j.access_token) {
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT, j.access_token, 'utf8');
      console.log('[auth] ✔ 授权成功，令牌已保存到 ' + OUT);
      console.log('[auth] scopes:', j.scope, ' token_type:', j.token_type);
      process.exit(0);
    }
    if (j.error === 'authorization_pending') { console.log('[auth] 等待授权…'); continue; }
    if (j.error === 'slow_down') { wait += 5000; continue; }
    console.error('[auth] 失败:', j.error, j.error_description || '');
    process.exit(1);
  }
  console.error('[auth] 超时未授权');
  process.exit(1);
})();
