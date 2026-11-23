/**
 * 通过 GitHub REST API（Git Data API）把本地目录同步到仓库并推送。
 * 不依赖 git 客户端的 HTTPS 通道，适合受限网络环境。
 *
 *   node tools/publish.mjs --repo=ASnowe/ASnowe.github.io --dir=. \
 *        --branch=master --include=index.html,README.md,src,tools,...
 *
 * 依赖环境变量 GITHUB_TOKEN。
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const REPO = arg('repo', 'ASnowe/ASnowe.github.io');
const DIR = path.resolve(arg('dir', process.cwd()));
const BRANCH = arg('branch', 'master');
const INCLUDE = arg('include', 'index.html,README.md,.gitignore,package.json,build.mjs,src,tools,shots').split(',').map((s) => s.trim()).filter(Boolean);
const BACKUP_BRANCH = arg('backup-branch', '');
const BACKUP_DIR = arg('backup-dir', 'D:/obo/deploy');
const MESSAGE = arg('message', '🎄 Christmas Stars：Three.js 圣诞星辰交互页面');
const DRY = process.argv.includes('--dry-run');

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) { console.error('缺少 GITHUB_TOKEN 环境变量'); process.exit(1); }

const API = 'https://api.github.com';
const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'dsh-publish',
  'Content-Type': 'application/json',
};

async function api(method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

/* ---------------- 1. 收集待上传文件 ---------------- */
function collect() {
  const out = [];
  for (const item of INCLUDE) {
    const full = path.join(DIR, item);
    if (!fs.existsSync(full)) { console.warn(`  跳过（不存在）: ${item}`); continue; }
    const st = fs.statSync(full);
    if (st.isFile()) { out.push({ path: item.replace(/\\/g, '/'), abs: full }); continue; }
    const walk = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === 'build') continue;
        const abs = path.join(dir, e.name);
        const rp = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(abs, rp);
        else out.push({ path: rp.replace(/\\/g, '/'), abs });
      }
    };
    walk(full, item);
  }
  return out;
}

/* ---------------- 2. 备份 ---------------- */
async function backup(headSha) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const tar = path.join(BACKUP_DIR, `ASnowe.github.io-${stamp}.tar.gz`);
  const res = await fetch(`https://codeload.github.com/${REPO}/tar.gz/${BRANCH}`, {
    headers: { 'User-Agent': 'dsh-publish' },
  });
  if (!res.ok) throw new Error('下载备份失败: ' + res.status);
  fs.writeFileSync(tar, Buffer.from(await res.arrayBuffer()));
  console.log(`✔ 本地备份: ${tar} (${(fs.statSync(tar).size / 1024).toFixed(0)} KB)`);

  if (BACKUP_BRANCH) {
    try {
      await api('POST', `/repos/${REPO}/git/refs`, { ref: `refs/heads/${BACKUP_BRANCH}`, sha: headSha });
      console.log(`✔ 远端备份分支: ${BACKUP_BRANCH} → ${headSha.slice(0, 8)}`);
    } catch (e) {
      if (/already exists/i.test(e.message)) console.log(`· 备份分支已存在，跳过: ${BACKUP_BRANCH}`);
      else throw e;
    }
  }
}

/* ---------------- 主流程 ---------------- */
(async () => {
  const user = await api('GET', '/user');
  console.log(`登录身份: ${user.login}`);

  const ref = await api('GET', `/repos/${REPO}/git/ref/heads/${BRANCH}`);
  const headSha = ref.object.sha;
  console.log(`当前 ${BRANCH}: ${headSha.slice(0, 8)}`);

  await backup(headSha);

  const files = collect();
  console.log(`待上传 ${files.length} 个文件`);
  const newPaths = new Set(files.map((f) => f.path));

  // 旧文件清单（将被覆盖/删除）
  const oldTree = await api('GET', `/repos/${REPO}/git/trees/${BRANCH}?recursive=1`);
  const oldBlobs = (oldTree.tree || []).filter((t) => t.type === 'blob');
  const removed = oldBlobs.filter((t) => !newPaths.has(t.path));
  console.log(`旧文件 ${oldBlobs.length} 个，其中将被移除 ${removed.length} 个`);
  for (const r of removed) console.log(`  - ${r.path}`);

  if (DRY) { console.log('（dry-run，未写入）'); return; }

  // 创建 blob
  const entries = [];
  let done = 0;
  for (const f of files) {
    const buf = fs.readFileSync(f.abs);
    const blob = await api('POST', `/repos/${REPO}/git/blobs`, {
      content: buf.toString('base64'),
      encoding: 'base64',
    });
    entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    done++;
    if (done % 5 === 0 || done === files.length) console.log(`  blob ${done}/${files.length}`);
  }

  // 删除旧文件
  for (const r of removed) entries.push({ path: r.path, mode: '100644', type: 'blob', sha: null });

  // 写树
  const tree = await api('POST', `/repos/${REPO}/git/trees`, { base_tree: headSha, tree: entries });
  console.log(`✔ 新 tree: ${tree.sha.slice(0, 8)}`);

  // 提交
  const commit = await api('POST', `/repos/${REPO}/git/commits`, {
    message: MESSAGE,
    tree: tree.sha,
    parents: [headSha],
  });
  console.log(`✔ commit: ${commit.sha.slice(0, 8)}`);

  // 更新分支
  await api('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });
  console.log(`✔ 已推送到 ${BRANCH}: ${commit.sha.slice(0, 8)}`);
})().catch((e) => { console.error('✖ ' + e.message); process.exit(1); });
