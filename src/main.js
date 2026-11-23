/* =========================================================================
 *  Christmas Stars · 圣诞星辰
 *  一个由「各自运行在独立轨道上的星辰」构成的圣诞树 / 星球 / 光环场景
 *  - Three.js  ·  纯前端 ·  无外部依赖（已内联打包）
 *  - 交互：拖拽环绕 / 滚轮精细缩放 / 点击星辰进入该星辰视角
 * ========================================================================= */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* -------------------------------------------------------------------------
 * 0. 基础工具
 * ---------------------------------------------------------------------- */
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const damp = (c, t, lambda, dt) => c + (t - c) * (1 - Math.exp(-lambda * dt));
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------------------
 * 1. 场景配置
 * ---------------------------------------------------------------------- */
const OFF_X = 1.5;                       // 整体右移，给左侧问候语留出空间

const GEO = {
  tree: { baseY: 0.95, height: 7.0, baseRadius: 2.1, turns: 4.2, strands: 4 },
  globe: { cy: -1.85, radius: 3.25 },
};

const QUALITY = {
  high:   { spiral: 13000, fuzz: 6900, dome: 7600, swirl: 2700, ring: 3900, light: 190, bg: 4600, dpr: 2.0 },
  medium: { spiral: 8200,  fuzz: 4400, dome: 4800, swirl: 1750, ring: 2550, light: 140, bg: 2800, dpr: 1.6 },
  low:    { spiral: 5000,  fuzz: 2700, dome: 2900, swirl: 1000, ring: 1600, light: 100, bg: 1700, dpr: 1.25 },
};

const PALETTE = {
  tree:   [0xffffff, 0xfff2f6, 0xffdfe9, 0xf6d7e2, 0xffe9e4, 0xeef0fb],
  globe:  [0xffffff, 0xfdf0f4, 0xffe0ea, 0xe8ecf8, 0xffece6],
  light:  [0xffd79a, 0xffb3c6, 0xa9d3ff, 0xfff3c4, 0xff9f86, 0xd8c1ff],
  bg:     [0xffffff, 0xdfe7ff, 0xffe9d6, 0xffffff, 0xf0d9ff],
};

function pickQuality() {
  // 允许通过 URL 参数覆盖：?quality=low | medium | high
  try {
    const q = new URLSearchParams(location.search).get('quality');
    if (q && QUALITY[q]) return q;
  } catch { /* ignore */ }
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency || 4;
  if (mobile) return cores >= 6 ? 'medium' : 'low';
  if (cores >= 8) return 'high';
  if (cores >= 4) return 'medium';
  return 'low';
}

let qualityName = pickQuality();
let Q = QUALITY[qualityName];

/* -------------------------------------------------------------------------
 * 2. DOM
 * ---------------------------------------------------------------------- */
const DOM = {
  app: document.getElementById('app'),
  canvas: document.getElementById('stage'),
  loading: document.getElementById('loading'),
  loadingBar: document.getElementById('loading-bar'),
  loadingPct: document.getElementById('loading-pct'),
  info: document.getElementById('info'),
  infoTitle: document.getElementById('info-title'),
  infoGrid: document.getElementById('info-grid'),
  infoClose: document.getElementById('info-close'),
  greeting: document.getElementById('greeting'),
  hint: document.getElementById('hint'),
  toolbar: document.getElementById('toolbar'),
  fps: document.getElementById('fps'),
};

function setProgress(p) {
  const v = Math.round(clamp(p, 0, 1) * 100);
  DOM.loadingBar.style.width = v + '%';
  DOM.loadingPct.textContent = v + '%';
}

/* -------------------------------------------------------------------------
 * 3. 渲染器 / 场景 / 相机
 * ---------------------------------------------------------------------- */
let renderer, scene, camera, composer, bloomPass;
let width = window.innerWidth, height = window.innerHeight;

function initRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas: DOM.canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.dpr));
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  scene = new THREE.Scene();
  scene.fog = null;

  camera = new THREE.PerspectiveCamera(48, width / height, 0.05, 400);
  camera.position.set(OFF_X + 3, 4, 14);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.66, 0.62, 0.06);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  renderer.info.autoReset = false;
}

/* -------------------------------------------------------------------------
 * 4. 着色器
 * ---------------------------------------------------------------------- */
const STAR_VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uSizeScale;
uniform float uSelected;
uniform float uHover;
uniform vec3  uFocusPoint;
uniform float uFocusAmount;
uniform float uFocusRadius;

attribute float aSize;
attribute vec3  aColor;
attribute vec3  aAxis;
attribute float aRadius;
attribute float aPhase;
attribute float aSpeed;
attribute float aTwinkle;
attribute float aIndex;

varying vec3  vColor;
varying float vAlpha;

void main() {
  vec3 axis = normalize(aAxis);
  vec3 helper = abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 bu = normalize(cross(helper, axis));
  vec3 bv = cross(axis, bu);

  float ang = aPhase + aSpeed * uTime;
  vec3 pos = position + (bu * cos(ang) + bv * sin(ang)) * aRadius;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  float sel = 1.0 - step(0.5, abs(aIndex - uSelected));
  float hov = 1.0 - step(0.5, abs(aIndex - uHover));

  float d = distance(pos, uFocusPoint);
  float dim = mix(1.0, 1.0 - smoothstep(uFocusRadius * 0.22, uFocusRadius * 1.45, d), uFocusAmount);

  // 贴近镜头的粒子会变得巨大，既难看又拖慢渲染 —— 距离越近越淡出
  float camDist = -mv.z;
  float nearFade = smoothstep(0.30, 1.55, camDist);
  nearFade = mix(nearFade, 1.0, max(sel, hov));

  float tw = 0.70 + 0.30 * sin(uTime * aTwinkle + aPhase * 2.3);
  vAlpha = tw * mix(1.0, dim, uFocusAmount) * nearFade * (1.0 + 0.85 * sel + 0.30 * hov);
  vColor  = mix(aColor, vec3(1.0), 0.42 * sel + 0.16 * hov);

  #ifdef FIXED_SIZE
    float size = aSize * uPixelRatio;
  #else
    float size = aSize * uSizeScale * uPixelRatio * (300.0 / max(0.05, -mv.z));
  #endif
  size *= mix(1.0, 0.22 + 0.78 * dim, uFocusAmount);
  size *= nearFade;
  size *= (1.0 + 0.9 * sel + 0.28 * hov);
  gl_PointSize = clamp(size, 0.6, mix(96.0, 18.0, uFocusAmount));
}
`;

const STAR_FRAG = /* glsl */ `
varying vec3  vColor;
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard;
  float core = 1.0 - smoothstep(0.04, 0.5, d);
  float hot  = pow(max(0.0, 1.0 - d * 2.25), 3.0);
  float a = (core * 0.55 + hot * 0.95) * vAlpha;
  vec3 c = vColor * (0.82 + 0.95 * hot);
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
}
`;

const SNOW_VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uSpan;
attribute float aSize;
attribute float aSpeed;
attribute float aPhase;
varying float vAlpha;
void main() {
  vec3 pos = position;
  float fall = mod(pos.y - uTime * aSpeed, uSpan);
  pos.y = fall - uSpan * 0.5;
  pos.x += sin(uTime * 0.55 + aPhase) * 0.75;
  pos.z += cos(uTime * 0.42 + aPhase * 1.3) * 0.55;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  vAlpha = smoothstep(0.0, 0.35, 1.0 - abs(pos.y) / (uSpan * 0.5));
  gl_PointSize = clamp(aSize * uPixelRatio * (220.0 / max(0.05, -mv.z)), 0.7, 14.0);
}
`;

const SNOW_FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard;
  float a = (1.0 - smoothstep(0.05, 0.5, d)) * vAlpha * 0.55;
  gl_FragColor = vec4(vec3(0.92, 0.95, 1.0), a);
}
`;

const MARKER_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;
  float ang = atan(p.y, p.x);
  float ring = 1.0 - smoothstep(0.0, 0.035, abs(r - 0.62));
  float halo = (1.0 - smoothstep(0.0, 0.62, r)) * 0.18;
  float ticks = 0.0;
  for (int i = 0; i < 4; i++) {
    float a0 = float(i) * 1.5707963 + uTime * 0.35;
    float da = abs(mod(ang - a0 + 3.14159265, 6.2831853) - 3.14159265);
    ticks += (1.0 - smoothstep(0.0, 0.06, da)) * (1.0 - smoothstep(0.62, 0.95, r)) * step(0.62, r);
  }
  float pulse = 0.75 + 0.25 * sin(uTime * 2.0);
  float a = (ring * 0.85 + halo + ticks * 0.5) * uOpacity * pulse;
  vec3 c = mix(vec3(1.0, 0.93, 0.84), vec3(1.0), ring);
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
}
`;

const MARKER_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/* -------------------------------------------------------------------------
 * 5. 星辰系统
 * ---------------------------------------------------------------------- */
const STAR_GROUPS = { TREE: 0, DOME: 1, RING: 2, LIGHT: 3, SWIRL: 4 };
const GROUP_NAME = {
  0: '树冠螺旋', 1: '星球表面', 2: '轨道光环', 3: '彩灯', 4: '星球漩涡',
};

const FG = {
  count: 0, base: null, u: null, v: null, radius: null, phase: null,
  speed: null, size: null, twinkle: null, group: null, points: null,
};
let BG = null;
let starMaterials = [];

function makeMaterial(fixedSize) {
  const defines = fixedSize ? { FIXED_SIZE: '' } : {};
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uSizeScale: { value: 1 },
      uSelected: { value: -1 },
      uHover: { value: -1 },
      uFocusPoint: { value: new THREE.Vector3(0, 2, 0) },
      uFocusAmount: { value: 0 },
      uFocusRadius: { value: 1.8 },
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    defines,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * 生成主星场：所有「星辰」共用一套轨道系统，每颗星有独立的轨道轴 / 半径 / 速度
 */
function buildStarField(rng) {
  const pos = [], col = [], siz = [], axi = [], rad = [], pha = [], spd = [], twk = [], grp = [];
  const tmpColor = new THREE.Color();

  function push(x, y, z, size, hex, group, orbitClass) {
    let r, speed;
    if (orbitClass === 'tight') { r = 0.022 + rng() * 0.055; speed = 0.25 + rng() * 0.55; }
    else if (orbitClass === 'loose') { r = 0.11 + rng() * 0.20; speed = 0.18 + rng() * 0.40; }
    else { r = 0.38 + rng() * 0.62; speed = 0.10 + rng() * 0.26; }

    const ax = rng() * 2 - 1, ay = rng() * 2 - 1, az = rng() * 2 - 1;
    const al = Math.hypot(ax, ay, az) || 1;

    pos.push(x, y, z);
    tmpColor.setHex(hex).convertSRGBToLinear();
    col.push(tmpColor.r, tmpColor.g, tmpColor.b);
    siz.push(size);
    axi.push(ax / al, ay / al, az / al);
    rad.push(r);
    pha.push(rng() * Math.PI * 2);
    spd.push(speed * (rng() < 0.5 ? -1 : 1));
    twk.push(0.5 + rng() * 2.4);
    grp.push(group);
  }

  const T = GEO.tree, G = GEO.globe;
  const pickFrom = (arr) => arr[(rng() * arr.length) | 0];

  /* -- 5.1 树冠螺旋主束 ------------------------------------------------- */
  const perStrand = Math.floor(Q.spiral / T.strands);
  for (let s = 0; s < T.strands; s++) {
    const offset = (s / T.strands) * Math.PI * 2;
    for (let i = 0; i < perStrand; i++) {
      const t = i / (perStrand - 1);
      const ang = t * T.turns * Math.PI * 2 + offset + (rng() - 0.5) * 0.05;
      const rad = Math.max(0.075, T.baseRadius * Math.pow(1 - t, 0.92)) + (rng() - 0.5) * 0.06;
      const y = T.baseY + t * T.height + (rng() - 0.5) * 0.06;
      const cls = rng() < 0.74 ? 'tight' : (rng() < 0.78 ? 'loose' : 'wild');
      push(OFF_X + rad * Math.cos(ang), y, rad * Math.sin(ang),
        0.062 + rng() * 0.085, pickFrom(PALETTE.tree), STAR_GROUPS.TREE, cls);
    }
  }

  /* -- 5.2 树体绒毛（填满锥形轮廓） ------------------------------------- */
  let placed = 0;
  while (placed < Q.fuzz) {
    const t = rng();
    if (rng() > Math.pow(1 - t, 1.5)) continue;
    placed++;
    const ang = t * T.turns * Math.PI * 2 + (rng() - 0.5) * 1.05;
    const rad = Math.max(0.075, T.baseRadius * Math.pow(1 - t, 0.92)) * Math.pow(rng(), 0.38);
    const y = T.baseY + t * T.height + (rng() - 0.5) * 0.10;
    const cls = rng() < 0.8 ? 'tight' : 'loose';
    push(OFF_X + rad * Math.cos(ang), y, rad * Math.sin(ang),
      0.04 + rng() * 0.055, pickFrom(PALETTE.tree), STAR_GROUPS.TREE, cls);
  }

  /* -- 5.3 星球（穹顶）表面 --------------------------------------------- */
  for (let i = 0; i < Q.dome; i++) {
    const theta = Math.pow(rng(), 0.72) * 1.48;
    const phi = rng() * Math.PI * 2;
    const rr = G.radius * (1 + (rng() - 0.5) * 0.04);
    const st = Math.sin(theta), ct = Math.cos(theta);
    const cls = rng() < 0.82 ? 'tight' : 'loose';
    push(OFF_X + rr * st * Math.cos(phi), G.cy + rr * ct, rr * st * Math.sin(phi),
      0.078 + rng() * 0.085, pickFrom(PALETTE.globe), STAR_GROUPS.DOME, cls);
  }

  /* -- 5.4 星球表面的螺旋漩涡（呼应参考图的缠绕感） ---------------------- */
  const swirlN = Q.swirl;
  for (let i = 0; i < swirlN; i++) {
    const p = i / (swirlN - 1);
    const theta = 0.06 + p * 1.34;
    const phi = p * Math.PI * 2 * 3.6;
    const rr = G.radius * 1.015;
    const st = Math.sin(theta), ct = Math.cos(theta);
    push(OFF_X + rr * st * Math.cos(phi), G.cy + rr * ct, rr * st * Math.sin(phi),
      0.075 + rng() * 0.07, pickFrom(PALETTE.globe), STAR_GROUPS.SWIRL, 'loose');
  }

  /* -- 5.5 经纬光环 ----------------------------------------------------- */
  const rings = [0.20, 0.44, 0.70, 0.96, 1.22];
  const perRing = Math.floor(Q.ring / rings.length);
  for (const th of rings) {
    const rr = G.radius * Math.cos(th) * 1.015;
    const y = G.cy + G.radius * Math.sin(th);
    for (let i = 0; i < perRing; i++) {
      const phi = (i / perRing) * Math.PI * 2 + (rng() - 0.5) * 0.02;
      const cls = rng() < 0.7 ? 'tight' : 'loose';
      push(OFF_X + rr * Math.cos(phi), y + (rng() - 0.5) * 0.05, rr * Math.sin(phi),
        0.055 + rng() * 0.05, pickFrom(PALETTE.globe), STAR_GROUPS.RING, cls);
    }
  }
  // 外侧大弧线（参考图底部横扫的弧）
  const wide = [4.35, 5.45, 6.65];
  const wideN = Math.floor(Q.ring / 3 / wide.length);
  for (let w = 0; w < wide.length; w++) {
    const R = wide[w];
    for (let i = 0; i < wideN; i++) {
      const a = (i / wideN) * Math.PI * 2;
      const y = G.cy - 0.95 - w * 0.42 + Math.sin(a * 3 + w) * 0.16;
      const cls = rng() < 0.55 ? 'tight' : 'loose';
      push(OFF_X + R * Math.cos(a), y, R * Math.sin(a) * 0.97,
        0.05 + rng() * 0.045, pickFrom(PALETTE.globe), STAR_GROUPS.RING, cls);
    }
  }

  /* -- 5.6 彩灯（树上的发光 ornament） --------------------------------- */
  for (let i = 0; i < Q.light; i++) {
    const t = 0.04 + rng() * 0.92;
    const ang = rng() * Math.PI * 2;
    const rad = Math.max(0.075, T.baseRadius * Math.pow(1 - t, 0.92)) * 0.99;
    push(OFF_X + rad * Math.cos(ang), T.baseY + t * T.height, rad * Math.sin(ang),
      0.13 + rng() * 0.15, pickFrom(PALETTE.light), STAR_GROUPS.LIGHT, 'tight');
  }

  /* -- 打包 ------------------------------------------------------------ */
  const n = pos.length / 3;
  FG.count = n;
  FG.base = new Float32Array(pos);
  FG.size = new Float32Array(siz);
  FG.radius = new Float32Array(rad);
  FG.phase = new Float32Array(pha);
  FG.speed = new Float32Array(spd);
  FG.twinkle = new Float32Array(twk);
  FG.group = new Uint8Array(grp);
  FG.u = new Float32Array(n * 3);
  FG.v = new Float32Array(n * 3);

  // 预计算轨道基向量（与着色器内逻辑保持一致）
  const ax = new Float32Array(n * 3);
  ax.set(axi);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const x = ax[o], y = ax[o + 1], z = ax[o + 2];
    let hx = 0, hy = 1, hz = 0;
    if (Math.abs(y) >= 0.9) { hx = 1; hy = 0; hz = 0; }
    // u = normalize(cross(helper, axis))
    let ux = hy * z - hz * y, uy = hz * x - hx * z, uz = hx * y - hy * x;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    // v = cross(axis, u)
    const vx = y * uz - z * uy, vy = z * ux - x * uz, vz = x * uy - y * ux;
    FG.u[o] = ux; FG.u[o + 1] = uy; FG.u[o + 2] = uz;
    FG.v[o] = vx; FG.v[o + 1] = vy; FG.v[o + 2] = vz;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(FG.base, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(col), 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(FG.size, 1));
  geo.setAttribute('aAxis', new THREE.BufferAttribute(new Float32Array(axi), 3));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(FG.radius, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(FG.phase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(FG.speed, 1));
  geo.setAttribute('aTwinkle', new THREE.BufferAttribute(FG.twinkle, 1));
  geo.setAttribute('aIndex', new THREE.BufferAttribute(new Float32Array(n).map((_, i) => i), 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(OFF_X, 1.5, 0), 12);

  const mat = makeMaterial(false);
  starMaterials.push(mat);
  FG.points = new THREE.Points(geo, mat);
  FG.points.frustumCulled = false;
  FG.points.renderOrder = 2;
  scene.add(FG.points);
}

/** 背景星海（跟随相机，永远在远处） */
function buildBackground(rng) {
  const n = Q.bg;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const siz = new Float32Array(n);
  const twk = new Float32Array(n);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const r = 52 + rng() * 70;
    const th = Math.acos(2 * rng() - 1);
    const ph = rng() * Math.PI * 2;
    pos[i * 3] = r * Math.sin(th) * Math.cos(ph);
    pos[i * 3 + 1] = r * Math.cos(th);
    pos[i * 3 + 2] = r * Math.sin(th) * Math.sin(ph);
    c.setHex(PALETTE.bg[(rng() * PALETTE.bg.length) | 0]).convertSRGBToLinear();
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    siz[i] = 0.9 + Math.pow(rng(), 2.2) * 3.4;
    twk[i] = 0.4 + rng() * 2.6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  geo.setAttribute('aAxis', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(n).map(() => rng() * 6.28), 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute('aTwinkle', new THREE.BufferAttribute(twk, 1));
  geo.setAttribute('aIndex', new THREE.BufferAttribute(new Float32Array(n).map((_, i) => i), 1));

  const mat = makeMaterial(true);
  starMaterials.push(mat);
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 1;
  scene.add(pts);
  BG = { points: pts };
}

/* -------------------------------------------------------------------------
 * 6. 飘雪
 * ---------------------------------------------------------------------- */
let snow = null;
function buildSnow(rng) {
  const n = 1400;
  const span = 42;
  const pos = new Float32Array(n * 3);
  const siz = new Float32Array(n);
  const spd = new Float32Array(n);
  const pha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rng() - 0.5) * 46;
    pos[i * 3 + 1] = rng() * span;
    pos[i * 3 + 2] = (rng() - 0.5) * 46;
    siz[i] = 0.035 + rng() * 0.075;
    spd[i] = 0.5 + rng() * 1.5;
    pha[i] = rng() * 6.28;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uSpan: { value: span },
    },
    vertexShader: SNOW_VERT,
    fragmentShader: SNOW_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  snow = { points: pts, material: mat };
}

/* -------------------------------------------------------------------------
 * 7. 聚焦标记 + 星座连线
 * ---------------------------------------------------------------------- */
let marker, markerMat;
let constellation = null;
let neighbors = [];

function buildFocusTools() {
  markerMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
    vertexShader: MARKER_VERT,
    fragmentShader: MARKER_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), markerMat);
  marker.visible = false;
  marker.renderOrder = 10;
  scene.add(marker);

  const MAX = 26;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xffe7ef, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  constellation = new THREE.LineSegments(geo, mat);
  constellation.frustumCulled = false;
  constellation.renderOrder = 9;
  scene.add(constellation);
}

/* -------------------------------------------------------------------------
 * 8. 相机装置（缩放 / 环绕 / 视角切换）
 * ---------------------------------------------------------------------- */
const OVERVIEW = {
  focus: new THREE.Vector3(OFF_X, 1.35, 0),
  dist: 16.8,
  yaw: -0.30,
  pitch: 0.075,
};

const rig = {
  focus: OVERVIEW.focus.clone(),
  focusTarget: OVERVIEW.focus.clone(),
  dist: OVERVIEW.dist,
  distTarget: OVERVIEW.dist,
  yaw: OVERVIEW.yaw,
  yawTarget: OVERVIEW.yaw,
  pitch: OVERVIEW.pitch,
  pitchTarget: OVERVIEW.pitch,
  mode: 'overview',       // overview | focus
  trans: null,
  focusAmount: 0,
  focusAmountTarget: 0,
};

const pointer = { x: 0, y: 0, nx: 0, ny: 0, inside: false };
const selected = { index: -1 };
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _look = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

function startTransition(duration = 1.65) {
  rig.trans = {
    t: 0,
    dur: duration,
    from: { fx: rig.focus.x, fy: rig.focus.y, fz: rig.focus.z, dist: rig.dist },
  };
}

function goOverview(instant = false) {
  if (selected.index < 0 && rig.mode === 'overview' && !instant) return;
  selected.index = -1;
  rig.mode = 'overview';
  rig.focusTarget.copy(OVERVIEW.focus);
  rig.distTarget = OVERVIEW.dist;
  rig.yawTarget = OVERVIEW.yaw;
  rig.pitchTarget = OVERVIEW.pitch;
  rig.focusAmountTarget = 0;
  if (instant) {
    rig.focus.copy(OVERVIEW.focus);
    rig.dist = OVERVIEW.dist;
    rig.yaw = OVERVIEW.yaw;
    rig.pitch = OVERVIEW.pitch;
  } else {
    startTransition(1.6);
  }
  DOM.info.classList.remove('show');
  DOM.greeting.classList.remove('dim');
}

function goToStar(index) {
  selected.index = index;
  rig.mode = 'focus';
  rig.focusTarget.copy(starWorldPos(index, new THREE.Vector3()));
  rig.distTarget = 0.82;
  rig.focusAmountTarget = 1;
  startTransition(1.7);
  findNeighbors(index);
  DOM.info.classList.add('show');
  DOM.greeting.classList.add('dim');
  DOM.hint.classList.add('gone');
  playChime(index);
  updateInfoPanel(true);
}

/* -------------------------------------------------------------------------
 * 9. 星辰实时位置 / 拾取
 * ---------------------------------------------------------------------- */
const _tmp = new THREE.Vector3();

/** 第 i 颗星在 t 时刻的世界坐标（与着色器公式一致） */
function starWorldPos(i, out) {
  const o = i * 3;
  const ang = FG.phase[i] + FG.speed[i] * clockTime;
  const c = Math.cos(ang), s = Math.sin(ang), r = FG.radius[i];
  out.set(
    FG.base[o] + (FG.u[o] * c + FG.v[o] * s) * r,
    FG.base[o + 1] + (FG.u[o + 1] * c + FG.v[o + 1] * s) * r,
    FG.base[o + 2] + (FG.u[o + 2] * c + FG.v[o + 2] * s) * r
  );
  return out;
}

/** 找到选中星辰最近的若干邻居，用于生成星座连线 */
function findNeighbors(index) {
  const n = FG.count;
  const px = FG.base[index * 3], py = FG.base[index * 3 + 1], pz = FG.base[index * 3 + 2];
  const found = [];
  for (let i = 0; i < n; i++) {
    if (i === index) continue;
    const o = i * 3;
    const dx = FG.base[o] - px, dy = FG.base[o + 1] - py, dz = FG.base[o + 2] - pz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > 2.6) continue;
    found.push({ i, d });
  }
  found.sort((a, b) => a.d - b.d);
  neighbors = found.slice(0, 12).map((f) => f.i);
}

const _vp = new THREE.Matrix4();
const _pickPos = new Float32Array(0);

/** 屏幕空间拾取：返回最接近指针的星辰索引 */
function pickStar(px, py) {
  if (FG.count === 0) return -1;
  _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const e = _vp.elements;
  const halfW = width / 2, halfH = height / 2;
  const thresh = 20;
  let best = -1, bestScore = Infinity;

  const n = FG.count;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const ang = FG.phase[i] + FG.speed[i] * clockTime;
    const c = Math.cos(ang), s = Math.sin(ang), r = FG.radius[i];
    const x = FG.base[o] + (FG.u[o] * c + FG.v[o] * s) * r;
    const y = FG.base[o + 1] + (FG.u[o + 1] * c + FG.v[o + 1] * s) * r;
    const z = FG.base[o + 2] + (FG.u[o + 2] * c + FG.v[o + 2] * s) * r;

    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (w <= 0.001) continue;
    const cx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
    const cy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
    const cz = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
    if (cz < -1 || cz > 1) continue;

    const sx = cx * halfW + halfW;
    const sy = -cy * halfH + halfH;
    const dx = sx - px, dy = sy - py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > thresh) continue;
    // 越大越优先（亮的 / 装饰灯）
    const bonus = FG.group[i] === STAR_GROUPS.LIGHT ? 9 : (FG.size[i] > 0.13 ? 4 : 0);
    const score = dist - bonus;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/* -------------------------------------------------------------------------
 * 10. 交互
 * ---------------------------------------------------------------------- */
let clockTime = 0;
let lastPointer = { x: 0, y: 0 };
let dragStart = null;
let dragged = false;
let idleTime = 0;
let hoverIndex = -1;
let pointerInside = false;
let pointerClientX = 0, pointerClientY = 0;

function updatePointerNDC(clientX, clientY) {
  pointerClientX = clientX; pointerClientY = clientY;
  pointer.nx = (clientX / width) * 2 - 1;
  pointer.ny = -((clientY / height) * 2 - 1);
  pointer.x = clientX; pointer.y = clientY;
}

function onPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  DOM.canvas.setPointerCapture && DOM.canvas.setPointerCapture(e.pointerId);
  dragStart = { x: e.clientX, y: e.clientY, t: performance.now(), yaw: rig.yawTarget, pitch: rig.pitchTarget };
  dragged = false;
  DOM.canvas.classList.add('is-dragging');
  idleTime = 0;
}

function onPointerMove(e) {
  updatePointerNDC(e.clientX, e.clientY);
  pointerInside = true;
  if (dragStart) {
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragged = true;
    if (dragged) {
      rig.yawTarget = dragStart.yaw - dx * 0.0042;
      rig.pitchTarget = clamp(dragStart.pitch + dy * 0.0030, -0.92, 1.18);
      idleTime = 0;
    }
  }
}

function onPointerUp(e) {
  DOM.canvas.classList.remove('is-dragging');
  if (!dragStart) return;
  const dt = performance.now() - dragStart.t;
  const moved = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
  if (!dragged && moved < 7 && dt < 700) {
    counters.click++;
    const hit = pickStar(e.clientX, e.clientY);
    if (hit >= 0) {
      goToStar(hit);
    } else if (rig.mode === 'focus') {
      goOverview();
    }
  }
  dragStart = null;
  idleTime = 0;
}

function onPointerLeave() {
  pointerInside = false;
  hoverIndex = -1;
  DOM.canvas.classList.remove('is-hot');
}

function onWheel(e) {
  e.preventDefault();
  counters.wheel++;
  const delta = e.deltaMode === 1 ? e.deltaY * 16 : (e.deltaMode === 2 ? e.deltaY * height : e.deltaY);
  const fine = e.shiftKey ? 0.32 : 1.0;    // 按住 Shift 触发精细缩放
  zoomBy(Math.exp(clamp(delta, -240, 240) * 0.0013 * fine));
  idleTime = 0;
}
const counters = { wheel: 0, click: 0, key: 0 };

function zoomBy(factor) {
  const min = rig.mode === 'focus' ? 0.26 : 3.0;
  const max = rig.mode === 'focus' ? 22 : 48;
  rig.distTarget = clamp(rig.distTarget * factor, min, max);
}

/* 触屏双指缩放 */
let pinch = null;
function onTouchStart(e) {
  if (e.touches.length === 2) {
    pinch = { d: touchDist(e.touches), dist: rig.distTarget };
  }
}
function touchDist(t) {
  const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
  return Math.hypot(dx, dy);
}
function onTouchMove(e) {
  if (e.touches.length === 2 && pinch) {
    e.preventDefault();
    const d = touchDist(e.touches);
    if (d > 0) zoomBy(pinch.dist * (pinch.d / d));
  }
}
function onTouchEnd() { pinch = null; }

/* 键盘 */
function onKey(e) {
  const k = e.key.toLowerCase();
  counters.key++;
  if (k === 'escape' || k === ' ') { e.preventDefault(); goOverview(); }
  else if (k === '+' || k === '=' || k === 'arrowup') { zoomBy(0.86); }
  else if (k === '-' || k === '_' || k === 'arrowdown') { zoomBy(1.16); }
  else if (k === 'arrowleft') { rig.yawTarget += 0.12; }
  else if (k === 'arrowright') { rig.yawTarget -= 0.12; }
  else if (k === 'h') { document.body.classList.toggle('ui-hidden'); }
  else if (k === 's') { toggleTool('snow'); }
  else if (k === 'l') { toggleTool('lines'); }
  else if (k === 'm') { toggleTool('sound'); }
  else if (k === 'f') { toggleFullscreen(); }
  else if (k === 'r') { reshuffle(); }
  else if (k === 'p') { DOM.fps.hidden = !DOM.fps.hidden; }
}

/* 工具栏 */
const TOOL_STATE = { snow: true, lines: true, sound: false };

function toggleTool(act) {
  if (act === 'snow') {
    TOOL_STATE.snow = !TOOL_STATE.snow;
    snow.points.visible = TOOL_STATE.snow;
  } else if (act === 'lines') {
    TOOL_STATE.lines = !TOOL_STATE.lines;
    if (!TOOL_STATE.lines) constellation.material.opacity = 0;
  } else if (act === 'sound') {
    TOOL_STATE.sound = !TOOL_STATE.sound;
    if (TOOL_STATE.sound) initAudio();
  }
  syncToolUI();
}

function syncToolUI() {
  DOM.toolbar.querySelectorAll('.tool').forEach((btn) => {
    const act = btn.dataset.act;
    if (act in TOOL_STATE) btn.classList.toggle('is-on', TOOL_STATE[act]);
  });
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen && document.exitFullscreen();
  }
}

/* -------------------------------------------------------------------------
 * 11. 音效（WebAudio 合成，无需外部资源）
 * ---------------------------------------------------------------------- */
let audioCtx = null;
function initAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

const SCALE = [523.25, 587.33, 698.46, 783.99, 880.0, 1046.5, 1174.66, 1396.91];
function playChime(index) {
  if (!TOOL_STATE.sound) return;
  initAudio();
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const f = SCALE[index % SCALE.length];
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
  g.connect(audioCtx.destination);

  [1, 2.01, 3.02].forEach((mul, i) => {
    const o = audioCtx.createOscillator();
    o.type = i === 0 ? 'sine' : 'triangle';
    o.frequency.setValueAtTime(f * mul, t0);
    const og = audioCtx.createGain();
    og.gain.value = [1, 0.34, 0.13][i];
    o.connect(og); og.connect(g);
    o.start(t0); o.stop(t0 + 1.7);
  });
}

/* -------------------------------------------------------------------------
 * 12. HUD
 * ---------------------------------------------------------------------- */
function updateInfoPanel(rebuild) {
  const i = selected.index;
  if (i < 0) return;
  const p = starWorldPos(i, _tmp);
  const gname = GROUP_NAME[FG.group[i]] || '星辰';
  DOM.infoTitle.textContent = `星辰 #${String(i).padStart(5, '0')}`;
  const rows = [
    ['结构', gname],
    ['轨道半径', FG.radius[i].toFixed(3)],
    ['角速度', Math.abs(FG.speed[i]).toFixed(3) + ' rad/s'],
    ['轨道相位', ((FG.phase[i] + FG.speed[i] * clockTime) % (Math.PI * 2)).toFixed(2) + ' rad'],
    ['实时坐标', `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`],
    ['距地面高度', p.y.toFixed(2)],
  ];
  if (rebuild) {
    DOM.infoGrid.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    infoCells = DOM.infoGrid.querySelectorAll('dd');
  } else if (infoCells && infoCells.length === rows.length) {
    infoCells[3].textContent = rows[3][1];
    infoCells[4].textContent = rows[4][1];
    infoCells[5].textContent = rows[5][1];
  }
}
let infoCells = null;

/* -------------------------------------------------------------------------
 * 13. 换一片星空
 * ---------------------------------------------------------------------- */
async function reshuffle() {
  DOM.hint.classList.add('gone');
  const seed = (Math.random() * 1e9) | 0;
  const rng = mulberry32(seed);
  // 用新种子重建主星场
  scene.remove(FG.points);
  FG.points.geometry.dispose();
  FG.points.material.dispose();
  starMaterials = starMaterials.filter((m) => m !== FG.points.material);
  buildStarField(rng);
  selected.index = -1;
  goOverview(true);
  DOM.info.classList.remove('show');
}

/* -------------------------------------------------------------------------
 * 13.5 诊断接口（供自动化测试 / 调试使用）
 * ---------------------------------------------------------------------- */
window.__xmas = {
  get info() {
    return {
      stars: FG.count,
      mode: rig.mode,
      selected: selected.index,
      hover: hoverIndex,
      dist: +rig.dist.toFixed(3),
      distTarget: +rig.distTarget.toFixed(3),
      focus: [+rig.focus.x.toFixed(3), +rig.focus.y.toFixed(3), +rig.focus.z.toFixed(3)],
      fps: fpsValue,
      quality: qualityName,
      drawCalls: renderer.info.render.calls,
      points: renderer.info.render.points,
      counters: { ...counters },
      trans: rig.trans ? { t: +rig.trans.t.toFixed(2), dur: rig.trans.dur } : null,
      clock: +clockTime.toFixed(2),
    };
  },
  pickStar,
  goToStar,
  goOverview,
  zoomBy,
  findStarAtScreen(x, y) { return pickStar(x, y); },
  starWorldPos,
  camera,
  rig,
  /** 第 i 颗星当前的屏幕坐标 */
  project(i) {
    const p = starWorldPos(i, new THREE.Vector3()).project(camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight, z: p.z };
  },
  /** 以固定步长推进模拟（不渲染），用于自动化测试 */
  step(seconds = 1, dt = 1 / 60) {
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) {
      clockTime += dt;
      updateCamera(dt);
      updateFocusTools(dt);
    }
    return this.info;
  },
};

/* -------------------------------------------------------------------------
 * 14. 主循环
 * ---------------------------------------------------------------------- */
let last = performance.now();
let fpsAcc = 0, fpsFrames = 0, fpsValue = 60;
let degraded = false;

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const realDt = (now - last) / 1000;
  let dt = realDt;
  last = now;
  dt = Math.min(dt, 0.05);
  clockTime += dt;

  updateCamera(dt);
  updateFocusTools(dt);
  updateHover();
  updateInfoPanel(false);

  for (const m of starMaterials) {
    m.uniforms.uTime.value = clockTime;
    m.uniforms.uSelected.value = selected.index;
    m.uniforms.uHover.value = hoverIndex;
    m.uniforms.uFocusPoint.value.copy(rig.focus);
    m.uniforms.uFocusAmount.value = rig.focusAmount;
  }
  if (snow) {
    snow.material.uniforms.uTime.value = clockTime;
    snow.points.position.set(camera.position.x, camera.position.y, camera.position.z);
  }
  if (BG) BG.points.position.copy(camera.position);

  renderer.info.reset();
  composer.render();

  // fps（真实帧率）
  fpsAcc += realDt; fpsFrames++;
  if (fpsAcc > 0.5) {
    fpsValue = Math.round(fpsFrames / fpsAcc);
    if (!DOM.fps.hidden) DOM.fps.textContent = `${fpsValue} FPS · ${FG.count.toLocaleString()} 颗星辰`;
    fpsAcc = 0; fpsFrames = 0;
    adaptQuality();
  }
}

/** 性能自适应：帧率过低时降低分辨率并关闭泛光 */
function adaptQuality() {
  if (degraded || clockTime < 6) return;
  if (fpsValue < 34) {
    degraded = true;
    renderer.setPixelRatio(Math.max(0.85, renderer.getPixelRatio() * 0.75));
    onResize();
    bloomPass.strength *= 0.8;
  }
}

function updateCamera(dt) {
  idleTime += dt;

  // 空闲时缓慢自转
  if (idleTime > 2.6 && !dragStart && rig.mode === 'overview') {
    rig.yawTarget += 0.028 * dt;
  }

  if (rig.trans) {
    rig.trans.t += dt;
    const k = easeInOutCubic(clamp(rig.trans.t / rig.trans.dur, 0, 1));
    rig.focus.set(
      lerp(rig.trans.from.fx, rig.focusTarget.x, k),
      lerp(rig.trans.from.fy, rig.focusTarget.y, k),
      lerp(rig.trans.from.fz, rig.focusTarget.z, k)
    );
    rig.dist = lerp(rig.trans.from.dist, rig.distTarget, k);
    if (rig.trans.t >= rig.trans.dur) rig.trans = null;
  } else {
    rig.focus.x = damp(rig.focus.x, rig.focusTarget.x, 6.5, dt);
    rig.focus.y = damp(rig.focus.y, rig.focusTarget.y, 6.5, dt);
    rig.focus.z = damp(rig.focus.z, rig.focusTarget.z, 6.5, dt);
    rig.dist = damp(rig.dist, rig.distTarget, 6.5, dt);
  }

  rig.yaw = damp(rig.yaw, rig.yawTarget, 7, dt);
  rig.pitch = damp(rig.pitch, rig.pitchTarget, 7, dt);
  rig.focusAmount = damp(rig.focusAmount, rig.focusAmountTarget, 3.2, dt);

  // 聚焦模式下，被选中的星辰会继续沿轨道运行 —— 视角需要跟随
  if (rig.mode === 'focus' && selected.index >= 0) {
    starWorldPos(selected.index, _tmp);
    rig.focusTarget.lerp(_tmp, 1 - Math.exp(-9 * dt));
  }

  // 鼠标视差
  const px = pointerInside ? pointer.nx * 0.085 : 0;
  const py = pointerInside ? pointer.ny * 0.055 : 0;

  const cp = Math.cos(rig.pitch + py), sp = Math.sin(rig.pitch + py);
  camera.position.set(
    rig.focus.x + rig.dist * cp * Math.sin(rig.yaw + px),
    rig.focus.y + rig.dist * sp,
    rig.focus.z + rig.dist * cp * Math.cos(rig.yaw + px)
  );

  // 聚焦模式下把主体略微上移 —— 构图更讲究，也避开左下角的信息卡
  _look.copy(rig.focus);
  if (rig.mode === 'focus') {
    _fwd.subVectors(_look, camera.position).normalize();
    _right.crossVectors(_fwd, WORLD_UP).normalize();
    _up.crossVectors(_right, _fwd).normalize();
    _look.addScaledVector(_up, -rig.dist * 0.17);
  }
  camera.lookAt(_look.x + px * 0.6, _look.y + py * 0.4, _look.z);
}

function updateFocusTools(dt) {
  const hasSel = selected.index >= 0;
  const targetOpacity = hasSel ? 1 : 0;
  markerMat.uniforms.uOpacity.value = damp(markerMat.uniforms.uOpacity.value, targetOpacity, 5, dt);
  markerMat.uniforms.uTime.value = clockTime;

  if (hasSel) {
    const p = starWorldPos(selected.index, _tmp);
    marker.visible = true;
    marker.position.copy(p);
    marker.quaternion.copy(camera.quaternion);
    const s = rig.dist * 0.055 * (height / 900);
    marker.scale.set(s, s, 1);
  } else if (markerMat.uniforms.uOpacity.value < 0.01) {
    marker.visible = false;
  }

  // 星座连线
  const lineMat = constellation.material;
  const lineTarget = hasSel && TOOL_STATE.lines ? 0.5 : 0;
  lineMat.opacity = damp(lineMat.opacity, lineTarget, 4, dt);
  constellation.visible = lineMat.opacity > 0.005;
  if (constellation.visible) {
    const pos = constellation.geometry.attributes.position;
    const arr = pos.array;
    let k = 0;
    const a = starWorldPos(selected.index, new THREE.Vector3());
    for (const j of neighbors) {
      if (k + 6 > arr.length) break;
      const b = starWorldPos(j, new THREE.Vector3());
      arr[k++] = a.x; arr[k++] = a.y; arr[k++] = a.z;
      arr[k++] = b.x; arr[k++] = b.y; arr[k++] = b.z;
    }
    for (; k < arr.length; k++) arr[k] = 0;
    pos.needsUpdate = true;
  }
}

let hoverCheckTimer = 0;
function updateHover() {
  hoverCheckTimer += 1;
  if (hoverCheckTimer % 2 !== 0) return;   // 30Hz 拾取即可
  if (!pointerInside || dragStart) { hoverIndex = -1; DOM.canvas.classList.remove('is-hot'); return; }
  const hit = pickStar(pointerClientX, pointerClientY);
  hoverIndex = hit;
  DOM.canvas.classList.toggle('is-hot', hit >= 0);
}

/* -------------------------------------------------------------------------
 * 15. 尺寸 / 事件
 * ---------------------------------------------------------------------- */
function onResize() {
  width = window.innerWidth;
  height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  composer.setSize(width, height);
  bloomPass.setSize(width, height);
  const dpr = renderer.getPixelRatio();
  for (const m of starMaterials) m.uniforms.uPixelRatio.value = dpr;
  if (snow) snow.material.uniforms.uPixelRatio.value = dpr;
}

function bindEvents() {
  DOM.canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  DOM.canvas.addEventListener('pointerleave', onPointerLeave);
  DOM.canvas.addEventListener('wheel', onWheel, { passive: false });
  DOM.canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  DOM.canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  DOM.canvas.addEventListener('touchend', onTouchEnd);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  DOM.toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tool');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'reset') goOverview();
    else if (act === 'zoom-in') zoomBy(0.85);
    else if (act === 'zoom-out') zoomBy(1.18);
    else if (act === 'fullscreen') toggleFullscreen();
    else if (act === 'ui') document.body.classList.toggle('ui-hidden');
    else if (act === 'reshuffle') reshuffle();
    else toggleTool(act);
  });

  DOM.infoClose.addEventListener('click', () => goOverview());
}

/* -------------------------------------------------------------------------
 * 16. 启动
 * ---------------------------------------------------------------------- */
async function boot() {
  setProgress(0.06);
  await nextFrame();

  initRenderer();
  setProgress(0.16);
  await nextFrame();

  const seed = 20261225;
  const rng = mulberry32(seed);
  buildStarField(rng);
  setProgress(0.56);
  await nextFrame();

  buildBackground(mulberry32(seed ^ 0x9e37));
  setProgress(0.72);
  await nextFrame();

  buildSnow(mulberry32(seed ^ 0x51ed));
  buildFocusTools();
  setProgress(0.86);
  await nextFrame();

  bindEvents();
  syncToolUI();
  rig.focus.copy(OVERVIEW.focus);
  rig.focusTarget.copy(OVERVIEW.focus);
  rig.dist = OVERVIEW.dist;
  rig.distTarget = OVERVIEW.dist;
  rig.yaw = OVERVIEW.yaw; rig.yawTarget = OVERVIEW.yaw;
  rig.pitch = OVERVIEW.pitch; rig.pitchTarget = OVERVIEW.pitch;

  // 首帧预热
  camera.position.set(OFF_X + 4, 4, 14);
  camera.lookAt(rig.focus);
  composer.render();
  setProgress(1);
  await nextFrame();

  DOM.loading.classList.add('hide');
  document.body.classList.add('ready');
  setTimeout(() => { DOM.hint.classList.add('gone'); }, 16000);

  last = performance.now();
  animate();
}

boot().catch((err) => {
  console.error(err);
  DOM.loading.innerHTML = `<div class="loading-inner"><p class="loading-text">无法初始化 WebGL</p><p class="loading-pct">${String(err.message || err).slice(0, 120)}</p></div>`;
});
