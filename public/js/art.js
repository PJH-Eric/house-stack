/*
 * 疊疊高樓 — 3D 場景（Three.js）。
 * 美術方向：明亮卡通城市。圓潤配色的小房子（窗戶裡有笑臉居民）、黃色塔式吊車、氣球與蓬鬆雲朵；
 * 越疊越高，背景隨高度由市區一路換到太空。所有貼圖都由 Canvas 程式繪製，不需外部素材。
 *
 * Board 負責「畫」與「動畫」：樓層模型、吊車、投放/落地/傾倒動畫、搖晃、粒子、鏡頭。
 * 規則（是否倒塌）一律由 rules.js 決定，這裡只依結果演出。
 */
import * as THREE from '../vendor/three.module.min.js';
import { SkyDirector } from './sky.js';

const R = window.HouseRules;
const FH = R.FLOOR_H;
export const PLAYER_COLORS = ['#ff5a5f', '#2f9bff', '#ffb81c', '#2fc48d'];
const PASTEL = ['#ff9b7a', '#ffd35c', '#7fd0f5', '#9ddc9f', '#f6a0c2', '#c9a5ef', '#ffbf75', '#a9c4d6'];
const GAP = 4.0; // 吊著的樓層底部離塔頂的距離
const ROOF = ['#e0533d', '#c9462f', '#4f7fd6', '#2e9d6a'];

export function webglSupported() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const rand = (a, b) => a + Math.random() * (b - a);

/* ---------- 程式繪製貼圖 ---------- */
const texCache = new Map();
/* 樓層牆面只畫底色與細緻的磚縫；窗、陽台、柱子都是真正的 3D 幾何（見 buildDetail） */
function wallTexture(hex) {
  const key = 'w' + hex;
  if (texCache.has(key)) return texCache.get(key);
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = hex; x.fillRect(0, 0, S, S);
  const g = x.createLinearGradient(0, 0, 0, S); g.addColorStop(0, 'rgba(255,255,255,.16)'); g.addColorStop(1, 'rgba(0,0,0,.18)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  x.fillStyle = 'rgba(255,255,255,.10)'; for (let y = 0; y < S; y += 16) x.fillRect(0, y, S, 2);
  x.fillStyle = 'rgba(0,0,0,.06)'; for (let y = 8; y < S; y += 16) for (let xx = (y / 8) % 2 ? 0 : 16; xx < S; xx += 32) x.fillRect(xx, y - 8, 2, 16);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  texCache.set(key, t); return t;
}

/* 依高度換色：色相隨樓層平滑漸變（約 42 層轉一圈），明度與飽和度再輕微起伏；每層另有 12 色點綴（遮陽棚、陽台、花）。 */
const ACCENT = ['#ff6b4a', '#ffd23c', '#ffffff', '#2f6fd8', '#ff5fa2', '#35c9a0', '#9b6bff', '#ff9a2e', '#27c3e6', '#7ed957', '#f25c7a', '#3a4a8c'];
const BASE_HEX = '#d98c5a';
const q = (v, step) => Math.round(v / step) * step;
export function wallStyle(idx) {
  if (idx <= 0) return { key: 'base', color: new THREE.Color(BASE_HEX) };
  const hue = q((200 + idx * 8.5) % 360, 3), l = q(0.5 + 0.05 * Math.sin(idx * 0.9), 0.02), sat = q(0.62 + 0.1 * Math.sin(idx * 0.37 + 1), 0.02);
  return { key: `h${hue}-${l.toFixed(2)}-${sat.toFixed(2)}`, color: new THREE.Color().setHSL(hue / 360, sat, l) };
}

/* 手動合併盒子成單一幾何（頂點色），讓一層樓只需 3 個 draw call */
function mergeBoxes(list) {
  const pos = [], nor = [], col = [], idx = []; let off = 0;
  for (const b of list) {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d); g.applyMatrix4(b.m);
    const p = g.attributes.position, n = g.attributes.normal, c = new THREE.Color(b.color);
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); col.push(c.r, c.g, c.b); }
    for (const k of g.index.array) idx.push(k + off);
    off += p.count; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}
const M4 = THREE.Matrix4;
function boxAt(list, th, w, h, d, x, y, z, color, rx = 0) {
  const m = new M4().makeRotationY(th).multiply(new M4().makeTranslation(x, y, z)).multiply(new M4().makeRotationX(rx));
  list.push({ w, h, d, m, color });
}

/** 一層樓的立體細節：角柱、窗框/玻璃/窗台/窗楣、遮陽棚或陽台、基座線、頂板 */
function buildDetail(s, FHt, variant, accentIdx, base) {
  const L = [], acc = ACCENT[accentIdx % ACCENT.length];
  const cream = '#f4ecc8', cream2 = '#e2d5a4', brown = '#5a3418', glass = '#9fd8f5', white = '#ffffff';
  const half = s / 2, bh = FHt * 0.86, y0 = -FHt * 0.07, cyW = y0 - 0.02 * FHt;
  const hh = FHt * 0.34;
  // 角柱
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) boxAt(L, 0, s * 0.1, bh, s * 0.1, sx * (half - s * 0.03), y0, sz * (half - s * 0.03), cream);
  // 基座線與頂部飾帶
  boxAt(L, 0, s * 1.04, FHt * 0.06, s * 1.04, 0, -FHt * 0.5 + FHt * 0.03, 0, cream2);
  boxAt(L, 0, s * 1.03, FHt * 0.035, s * 1.03, 0, FHt * 0.36 - FHt * 0.02, 0, cream2);
  const windowAt = (th, cx, cy, w, h, cols, o = {}) => {
    const z = half;
    boxAt(L, th, w + 0.2, h + 0.2, 0.16, cx, cy, z + 0.04, brown);
    const gw = (w - 0.07 * (cols - 1)) / cols;
    for (let i = 0; i < cols; i++) boxAt(L, th, gw, h, 0.08, cx - w / 2 + gw / 2 + i * (gw + 0.07), cy, z + 0.09, glass);
    boxAt(L, th, w * 0.96, h * 0.12, 0.02, cx, cy + h * 0.44, z + 0.14, white); // 窗簾
    boxAt(L, th, 0.05, h, 0.04, cx, cy, z + 0.14, brown); // 中梃（雙開窗的分隔）
    if (o.cross) boxAt(L, th, w, 0.05, 0.04, cx, cy, z + 0.14, brown);
    boxAt(L, th, w + 0.14, 0.1, 0.18, cx, cy + h / 2 + 0.17, z + 0.1, cream2); // 窗楣
    if (o.balcony) {
      const by = cy - h / 2 - 0.16, bw = w + 0.6, bd = 0.55;
      boxAt(L, th, bw, 0.1, bd, cx, by, z + bd / 2 - 0.02, white);
      boxAt(L, th, bw, 0.06, 0.06, cx, by + 0.42, z + bd - 0.05, acc);
      boxAt(L, th, 0.06, 0.06, bd, cx - bw / 2 + 0.03, by + 0.42, z + bd / 2 - 0.02, acc);
      boxAt(L, th, 0.06, 0.06, bd, cx + bw / 2 - 0.03, by + 0.42, z + bd / 2 - 0.02, acc);
      for (let i = 0; i < 6; i++) boxAt(L, th, 0.04, 0.4, 0.04, cx - bw / 2 + 0.06 + i * ((bw - 0.12) / 5), by + 0.22, z + bd - 0.05, acc);
      for (let i = 0; i < 4; i++) boxAt(L, th, 0.16, 0.14, 0.16, cx - bw * 0.3 + i * (bw * 0.2), by + 0.12, z + bd * 0.5, ['#ff6b8b', '#ffd23c', '#ffffff', '#ff8a4a'][i]);
    } else boxAt(L, th, w + 0.4, 0.09, 0.3, cx, cy - h / 2 - 0.15, z + 0.12, white); // 窗台
    if (o.awning) {
      boxAt(L, th, w + 0.45, 0.06, 0.62, cx, cy + h / 2 + 0.36, z + 0.3, acc, -0.32);
      boxAt(L, th, w + 0.45, 0.14, 0.05, cx, cy + h / 2 + 0.2, z + 0.56, white, 0);
    }
  };
  for (const th of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const front = th === 0;
    if (base) {
      if (front) {
        windowAt(th, -s * 0.28, cyW + FHt * 0.06, s * 0.2, hh * 0.9, 2, { awning: true });
        windowAt(th, s * 0.28, cyW + FHt * 0.06, s * 0.2, hh * 0.9, 2, { awning: true });
        boxAt(L, th, s * 0.3, FHt * 0.56, 0.16, 0, -FHt * 0.5 + FHt * 0.28 + 0.06, half + 0.06, brown);
        boxAt(L, th, s * 0.22, FHt * 0.5, 0.1, 0, -FHt * 0.5 + FHt * 0.25 + 0.06, half + 0.15, '#c47a3a');
        boxAt(L, th, 0.12, 0.12, 0.08, s * 0.07, -FHt * 0.5 + FHt * 0.28, half + 0.22, '#ffd23c');
        boxAt(L, th, s * 0.5, 0.07, 0.8, 0, -FHt * 0.5 + FHt * 0.6, half + 0.4, acc, -0.25);
      } else windowAt(th, 0, cyW, s * 0.36, hh, 2, {});
      continue;
    }
    const fb = th === 0 || th === Math.PI; // 只有正面／背面有遮陽棚與陽台，側面保持俐落輪廓
    if (variant === 0) windowAt(th, 0, cyW, s * 0.46, hh, 2, { awning: fb });
    else if (variant === 1) { windowAt(th, -s * 0.22, cyW, s * 0.2, hh * 1.1, 1, { cross: true }); windowAt(th, s * 0.22, cyW, s * 0.2, hh * 1.1, 1, { cross: true }); }
    else if (variant === 2) windowAt(th, 0, cyW + 0.1, s * 0.42, hh, 2, { balcony: fb });
    else { for (const k of [-1, 0, 1]) windowAt(th, k * s * 0.29, cyW, s * 0.15, hh, 1, { awning: fb && k !== 0, cross: true }); }
  }
  return mergeBoxes(L);
}
const detailMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x18222c });

function glassTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 160;
  const x = c.getContext('2d'); x.fillStyle = '#dfeeff'; x.fillRect(0, 0, 128, 160);
  for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 4; gx++) {
    const lit = (gx * 7 + gy * 3) % 5 === 0;
    x.fillStyle = lit ? '#ffe9a8' : '#6aa6e6'; x.fillRect(gx * 32 + 4, gy * 32 + 5, 24, 20);
    x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(gx * 32 + 4, gy * 32 + 5, 24, 5);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}

/* ---------- 場景 ---------- */
export class Board {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.demo = !!opts.demo;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = !opts.noShadow;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.5, 9000);
    this.cfg = { size: 4, ground: 8, amp: 4.4, tol: 0.3 };
    this.entries = []; // {group, x, z, i}
    this.debris = [];
    this.particles = [];
    this.time = 0;
    this.busy = false;
    this.timeScale = 1; // 測試用：慢動作
    this.reduceMotion = false;
    this.guide = true;
    this.viewIdx = 0; this.yaw = 0; this.yawTarget = 0;
    this.camY = 7; this.camDist = 46; this.shake = 0; this.jolt = 0; this.sway = 0;
    this.turn = null; this.trolleyD = 0; this.craneRot = 0; this.crAxisTarget = 0;
    this.altitude = 0; this.anim = null;
    this.hold = { vis: false, seat: 0 };
    this._geoCache = null;
    this.buildEnvironment();
    this.buildCrane();
    this.sky = new SkyDirector(this.scene, this.camera, { hemi: this.hemi, sun: this.sun });
    this.resize();
  }

  /* ----- 環境 ----- */
  buildEnvironment() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0xdff3ff, 0x9bc58a, 1.0); s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.7);
    this.sun.position.set(-26, 44, 22); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 5; sc.far = 130;
    this.sun.shadow.bias = -0.0008; this.sun.shadow.normalBias = 0.04;
    s.add(this.sun); s.add(this.sun.target);

    // 地面與道路
    const grass = new THREE.Mesh(new THREE.CircleGeometry(150, 48), new THREE.MeshLambertMaterial({ color: 0x8fd16f }));
    grass.rotation.x = -Math.PI / 2; grass.position.y = -0.31; grass.receiveShadow = true; s.add(grass);
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x6f7a8c });
    for (const rot of [0, Math.PI / 2]) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(300, 7), roadMat);
      road.rotation.set(-Math.PI / 2, 0, rot); road.position.y = -0.3; road.receiveShadow = true; s.add(road);
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(300, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff1b8 }));
      dash.rotation.set(-Math.PI / 2, 0, rot); dash.position.y = -0.28; s.add(dash);
    }
    this.lot = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1), new THREE.MeshLambertMaterial({ color: 0xe8e2d2 }));
    this.lot.position.y = -0.06; this.lot.receiveShadow = true; s.add(this.lot);

    // 小房子與樹（低面數）
    const rng = R.mulberry32(20261025);
    const houseGeo = new THREE.BoxGeometry(1, 1, 1), roofGeo = new THREE.ConeGeometry(0.85, 0.7, 4);
    const city = new THREE.Group();
    const glass = glassTexture();
    const tints = [0xd6e8fa, 0xc4d8f4, 0xdcd3f7, 0xd2f0ea, 0xf8f2e4, 0xe3eaf8];
    const mats = tints.map((c) => new THREE.MeshLambertMaterial({ color: c, map: glass }));
    for (let i = 0; i < 70; i++) {
      const a = rng() * Math.PI * 2, r = 40 + rng() * 70;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < 7 || Math.abs(z) < 7) continue;
      const w = 4 + rng() * 5, hh = 14 + rng() * 52 * (0.5 + 0.5 * Math.min(1, r / 50));
      const geo = new THREE.BoxGeometry(w, hh, w);
      const uv = geo.attributes.uv; for (let k = 0; k < uv.count; k++) { uv.setX(k, uv.getX(k) * w / 4); uv.setY(k, uv.getY(k) * hh / 5); }
      const m = new THREE.Mesh(geo, mats[Math.floor(rng() * mats.length)]);
      m.position.set(x, hh / 2 - 0.3, z); city.add(m);
      if (rng() < 0.4) { const an = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 6, 4), new THREE.MeshLambertMaterial({ color: 0xc0c8d4 })); an.position.set(x, hh + 2.7, z); city.add(an); }
    }
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2, r = 12 + rng() * 14;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < 6 || Math.abs(z) < 6) continue;
      const w = 3 + rng() * 3, hh = 2.5 + rng() * 4;
      const m = new THREE.Mesh(houseGeo, new THREE.MeshLambertMaterial({ color: new THREE.Color(PASTEL[Math.floor(rng() * 8)]) }));
      m.scale.set(w, hh, w); m.position.set(x, hh / 2 - 0.3, z); city.add(m);
      const rf = new THREE.Mesh(roofGeo, new THREE.MeshLambertMaterial({ color: new THREE.Color(ROOF[Math.floor(rng() * 4)]) }));
      rf.scale.set(w * 1.05, 1.2, w * 1.05); rf.rotation.y = Math.PI / 4; rf.position.set(x, hh - 0.3 + 0.55, z); city.add(rf);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.4, 6), leafGeo = new THREE.SphereGeometry(1.7, 9, 7);
    for (let i = 0; i < 46; i++) {
      const a = rng() * Math.PI * 2, r = 12 + rng() * 60;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < 4.5 || Math.abs(z) < 4.5) continue;
      const t = new THREE.Mesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x8a5a33 })); t.position.set(x, 0.4, z); city.add(t);
      const l = new THREE.Mesh(leafGeo, new THREE.MeshLambertMaterial({ color: [0x4cb85a, 0x3a9f4e, 0x66c46a][i % 3] })); l.position.set(x, 2.6, z); l.castShadow = true; city.add(l);
    }
    // 木柵欄（參考圖一樓後方）
    const plank = new THREE.BoxGeometry(0.7, 2.2, 0.25), pm = new THREE.MeshLambertMaterial({ color: 0xb9854c });
    for (let i = -14; i <= 14; i++) { const p = new THREE.Mesh(plank, pm); p.position.set(i * 0.95, 0.8, -7); city.add(p); }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(27.5, 0.3, 0.3), pm); rail.position.set(0, 1.2, -6.8); city.add(rail);
    s.add(city);

    this.clouds = []; // 雲層由 SkyDirector 依高度管理
    this.cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    // 氣球
    this.balloons = [];
    const balGeo = new THREE.SphereGeometry(0.75, 14, 12);
    const cols = [0xff5a5f, 0xffb81c, 0x2f9bff, 0x2fc48d, 0xc86bff, 0xff8fc0];
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(balGeo, new THREE.MeshLambertMaterial({ color: cols[i % cols.length] })); b.scale.y = 1.2; g.add(b);
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 3, 4), new THREE.MeshBasicMaterial({ color: 0xffffff })); str.position.y = -2.4; g.add(str);
      const a = rng() * 6.28, r = 16 + rng() * 16;
      g.position.set(Math.cos(a) * r, rng() * 40, Math.sin(a) * r); g.userData = { a, r, sp: 0.8 + rng() * 0.8, ph: rng() * 6 };
      s.add(g); this.balloons.push(g);
    }
    // 星星
    const sg = new THREE.BufferGeometry(); const sp = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) { const a = rng() * 6.28, e = 0.15 + rng() * 1.3, r = 260; sp[i * 3] = Math.cos(a) * Math.cos(e) * r; sp[i * 3 + 1] = Math.sin(e) * r * 0.8 + 20; sp[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r; }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
    s.add(this.stars);
    s.fog = new THREE.Fog(0xcfeeff, 70, 230);
    s.background = new THREE.Color(0x7ccbff);

    // 投放輔助線
    this.guideGroup = new THREE.Group();
    const gm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
    this.guideMat = gm;
    this.guideBars = [];
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.12), gm); b.renderOrder = 10; this.guideGroup.add(b); this.guideBars.push(b); }
    this.guideBeam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthTest: false }));
    this.guideBeam.renderOrder = 9; this.guideGroup.add(this.guideBeam);
    this.guideGroup.visible = false; s.add(this.guideGroup);

    // 粒子池（落地灰塵）
    const dustGeo = new THREE.SphereGeometry(0.28, 8, 6);
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Mesh(dustGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
      m.visible = false; s.add(m); this.particles.push({ m, life: 0, vx: 0, vy: 0, vz: 0, kind: 'dust' });
    }
    // 完美落地的金色星星（參考圖：樓層兩側噴出星星與白煙）
    const sh = new THREE.Shape(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.28 : 0.7, a = Math.PI / 2 + i * Math.PI / 5; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const starGeo = new THREE.ShapeGeometry(sh); this.starFx = [];
    for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(starGeo, new THREE.MeshBasicMaterial({ color: 0xffd23c, side: THREE.DoubleSide, transparent: true })); m.visible = false; s.add(m); this.starFx.push({ m, life: 0, v: new THREE.Vector3() }); }
    const confGeo = new THREE.PlaneGeometry(0.4, 0.25);
    this.confetti = [];
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(confGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[i % cols.length]), side: THREE.DoubleSide }));
      m.visible = false; s.add(m); this.confetti.push({ m, life: 0, v: new THREE.Vector3(), w: new THREE.Vector3() });
    }
  }

  /* ----- 吊車：樓層以長繩從畫面上方垂下來擺盪；遠景另有靜態塔吊裝飾 ----- */
  buildCrane() {
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    this.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), new THREE.MeshBasicMaterial({ color: 0x3a2a1a })); this.scene.add(this.rope);
    this.hook = new THREE.Group();
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.7), mat(0xffc21a)); hb.castShadow = true; this.hook.add(hb);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 6, 12), mat(0x4a5a70)); ring.position.y = 0.4; this.hook.add(ring);
    this.scene.add(this.hook);
    this.holdSlot = new THREE.Group(); this.scene.add(this.holdSlot);
    for (const [x, z, sc, ry] of [[62, -95, 1, 0], [-58, -85, 0.9, 0]]) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 58, 1.1), mat(0xffc21a)); m.position.y = 29; g.add(m);
      const j = new THREE.Mesh(new THREE.BoxGeometry(34, 0.9, 0.9), mat(0xffc21a)); j.position.set(8, 58, 0); g.add(j);
      const c = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 2), mat(0x4a5a70)); c.position.set(-7, 57, 0); g.add(c);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.8, 1.8), mat(0xe0533d)); cab.position.set(1, 56, 0); g.add(cab);
      g.position.set(x, 0, z); g.scale.setScalar(sc); g.rotation.y = ry; this.scene.add(g);
    }
  }

  /* ----- 設定 / 資料 ----- */
  setConfig(gs) {
    if (this._detailGeo) for (const g of this._detailGeo.values()) g.dispose(); // 換局時釋放舊的幾何，避免越玩越多
    if (this._geoCache) for (const g of Object.values(this._geoCache)) g.dispose();
    this.cfg = { size: gs.size, ground: gs.ground, amp: gs.amp, tol: gs.tol, shapes: gs.shapes || 'off' };
    this._geoCache = {
      body: new THREE.BoxGeometry(gs.size, FH * 0.86, gs.size),
      cornice: new THREE.BoxGeometry(gs.size * 1.07, FH * 0.14, gs.size * 1.07),
      band: new THREE.BoxGeometry(gs.size * 1.02, FH * 0.05, gs.size * 1.02),
      hatch: new THREE.BoxGeometry(gs.size * 0.2, FH * 0.07, gs.size * 0.2),
    };
    this._detailGeo = null;
    this.lot.scale.set(Math.min(gs.ground * 2.2, gs.size * 3.4), 1, Math.min(gs.ground * 2.2, gs.size * 3.4));
    this.lot.position.y = -0.31 + 0.25 - 0.02;
    const g = this.guideBars; const s = gs.size;
    g[0].scale.x = s; g[1].scale.x = s; g[2].scale.x = s; g[3].scale.x = s;
    g[0].position.set(0, 0, s / 2); g[1].position.set(0, 0, -s / 2);
    g[2].position.set(s / 2, 0, 0); g[2].rotation.y = Math.PI / 2; g[3].position.set(-s / 2, 0, 0); g[3].rotation.y = Math.PI / 2;
    this.makeRoof();
  }

  makeFloor(color, variant, seat, base, idx = 1, w = 1, h = 1) {
    const outer = new THREE.Group(); // outer 供動畫縮放；grp 依寬／高倍率變形（不規則樓層）
    const grp = new THREE.Group(); grp.scale.set(w, h, 1); outer.add(grp);
    const st = wallStyle(base ? 0 : idx);
    const tone = [0.92, 1, 0.96][color % 3];
    const mk = `${st.key}-${tone}`;
    this._wallMats = this._wallMats || new Map();
    let side = this._wallMats.get(mk);
    if (!side) { side = new THREE.MeshLambertMaterial({ map: wallTexture('#ffffff'), color: st.color.clone().multiplyScalar(tone) }); this._wallMats.set(mk, side); }
    const plain = this._plainMat || (this._plainMat = new THREE.MeshLambertMaterial({ color: 0xe9dfae }));
    const body = new THREE.Mesh(this._geoCache.body, [side, side, plain, plain, side, side]);
    body.position.y = -FH * 0.07; body.castShadow = true; body.receiveShadow = true; grp.add(body);
    // 3D 細節（依樣式／配色快取，所有同款樓層共用同一份幾何）
    const dk = `${variant}-${color % ACCENT.length}-${base ? 1 : 0}`;
    this._detailGeo = this._detailGeo || new Map();
    let dg = this._detailGeo.get(dk);
    if (!dg) { dg = buildDetail(this.cfg.size, FH, variant, color % ACCENT.length, base); this._detailGeo.set(dk, dg); }
    const det = new THREE.Mesh(dg, detailMat); det.castShadow = true; det.receiveShadow = true; grp.add(det);
    // 奶油色頂板（沒有屋頂，樓層可以一直往上疊）
    const cor = new THREE.Mesh(this._geoCache.cornice, this._cornMat || (this._cornMat = new THREE.MeshLambertMaterial({ color: 0xf6efd0 })));
    cor.position.y = FH * 0.5 - FH * 0.07; cor.castShadow = true; cor.receiveShadow = true; grp.add(cor);
    if (seat >= 0) { // 玩家色小色帶，多人時辨識誰放的
      const band = new THREE.Mesh(this._geoCache.band, (this._bandMats = this._bandMats || {})[seat] || (this._bandMats[seat] = new THREE.MeshLambertMaterial({ color: new THREE.Color(PLAYER_COLORS[seat % PLAYER_COLORS.length]) })));
      band.position.y = FH * 0.5 - FH * 0.17; grp.add(band);
    }
    const hatch = new THREE.Mesh(this._geoCache.hatch, this._hatchMat || (this._hatchMat = new THREE.MeshLambertMaterial({ color: 0x6b6f77 })));
    hatch.position.set(this.cfg.size * 0.12, FH * 0.5 + FH * 0.005, -this.cfg.size * 0.05); grp.add(hatch);
    return outer;
  }

  makeRoof() { this.roof = null; } // 參考作品沒有屋頂；保留空函式讓舊呼叫安全

  clearTower() {
    for (const e of this.entries) this.scene.remove(e.group);
    this.entries = [];
    for (const d of this.debris) this.scene.remove(d.group);
    this.debris = [];
    if (this.anim && this.anim.pivot) this.scene.remove(this.anim.pivot);
    this.anim = null; this.busy = false;
  }

  /** 以伺服器/規則快照重建整座塔：[x,z,color,variant,seat,perfect] */
  setFloors(arr) {
    this.clearTower();
    arr.forEach((f, i) => this.addEntry({ x: f[0], z: f[1], color: f[2], variant: f[3], seat: f[4], w: f[6] || 1, h: f[7] || 1, base: i === 0 }, i));
    this.afterTowerChange(true);
  }
  addEntry(f, i) {
    const group = this.makeFloor(f.color, f.variant, f.seat, i === 0, i, f.w || 1, f.h || 1);
    const y0 = this.entries.length ? this.topY() : 0, ht = FH * (f.h || 1);
    group.position.set(f.x, y0 + ht / 2, f.z);
    this.scene.add(group);
    const e = { group, x: f.x, z: f.z, i, data: f, y0, ht };
    this.entries.push(e);
    return e;
  }
  /** 塔頂高度（各層高度不同，所以是累加值） */
  topY() { const e = this.entries[this.entries.length - 1]; return e ? e.y0 + e.ht : 0; }
  afterTowerChange(snap) {
    const n = this.entries.length;
    this.altitude = this.topY();
    const top = this.entries[n - 1];
    if (this.roof) { this.roof.visible = true; this.roof.position.set(top.x, n * FH, top.z); this.roof.rotation.set(0, 0, 0); this.roof.scale.set(1, 1, 1); }
    // 鏡頭與光源跟著塔頂
    const topY = this.altitude;
    this.camYTarget = Math.max(topY + 1.5, 9.5);
    if (snap) this.camY = this.camYTarget;
    this.sun.target.position.set(0, Math.max(0, topY - 18), 0);
    this.sun.position.set(-26, Math.max(0, topY - 18) + 44, 22);
    this.sun.target.updateMatrixWorld();
    this.craneLayout();
  }

  craneLayout() { this.anchorY = this.topY() + 30; }

  /* ----- 回合：吊車與手上的樓層 ----- */
  /** swing：規則的吊車參數；t0：伺服器開始時間；offset：伺服器時鐘 − 本機時鐘 */
  setTurn(t) {
    this.turn = t ? { ...t, start: performance.now() } : null;
    this.hold.vis = !!t;
    if (t) {
      this.sky.setWind(t.swing.wind || 0);
      if (this.heldFloor) this.holdSlot.remove(this.heldFloor);
      this.zeroG = !!t.swing.space; this.holdH = t.swing.look.h || 1;
      this.heldFloor = this.makeFloor(t.swing.look.color, t.swing.look.variant, t.seat, false, this.entries.length, t.swing.look.w || 1, t.swing.look.h || 1);
      this.holdSlot.add(this.heldFloor);
      this.holdPop = 0;
      this.holdSeat = t.seat;
    } else if (this.heldFloor) { this.holdSlot.remove(this.heldFloor); this.heldFloor = null; }
  }
  swingNow() {
    if (!this.turn) return 0;
    const t = (Date.now() + (this.turn.offset || 0) - this.turn.t0) / 1000;
    return R.swingPos(this.turn.swing, t);
  }
  /** 目前吊車（畫面上）所在偏移；本機玩家放下時送出這個值。 */
  currentD() { return this.trolleyD; }
  setStability(ratio) { this.sway = clamp(ratio, 0, 1.2); }
  setView() { this.yawTarget = 0; }
  rotateView() {}

  holdPos() {
    const n = this.entries.length, top = this.entries[n - 1];
    const axis = this.turn ? this.turn.swing.axis : 'x';
    const y = this.topY() + GAP + FH * (this.holdH || 1) * 0.5;
    return { x: top.x + (axis === 'x' ? this.trolleyD : 0), z: top.z + (axis === 'z' ? this.trolleyD : 0), y };
  }

  /* ----- 投放動畫 ----- */
  /** res：規則 drop 結果。cb：{onImpact(strength), onFall(), onPerfect(pos), onDone()} */
  playDrop(res, cb = {}) {
    if (this.busy) { this.finishNow && this.finishNow(); }
    this.busy = true;
    const n = this.entries.length;
    const placed = res.placed;
    const axis = res.axis;
    this.anim = { type: 'align', t: 0, res, cb, n, from: this.trolleyD, to: res.d, floorsBefore: this.entries.map((e) => ({ x: e.x, z: e.z, w: (e.data && e.data.w) || 1 })) };
    this.holdH = placed.h || 1; this.zeroG = !!(res.swing && res.swing.space);
    this.turnBackup = this.turn;
    this.turn = null; // 吊車停止擺盪，改為手動
    this.hold.vis = true;
    if (this.roof) this.roof.visible = false;
    this.dropFloor = this.heldFloor; this.heldFloor = null;
    if (!this.dropFloor) this.dropFloor = this.makeFloor(placed.color, placed.variant, placed.seat, false, n, placed.w || 1, placed.h || 1);
    this.holdSlot.remove(this.dropFloor); this.dropFloor.rotation.set(0, 0, 0);
    this.dropAxis = axis;
    // 重新依結果上色（保險：旋轉視角或重連時 look 可能不同）
    const pos = (d) => ({ x: this.entries[n - 1].x + (axis === 'x' ? d : 0), z: this.entries[n - 1].z + (axis === 'z' ? d : 0) });
    this.anim.posAt = pos;
    const p0 = pos(this.trolleyD); this.dropFloor.position.set(p0.x, this.topY() + GAP + FH * this.holdH * 0.5, p0.z);
    this.scene.add(this.dropFloor);
  }

  finishNow() { /* 快速收尾上一個動畫（網路事件密集時） */
    const a = this.anim; if (!a) return;
    if (this.dropFloor) { this.scene.remove(this.dropFloor); this.dropFloor = null; }
    if (a.pivot) this.scene.remove(a.pivot);
    for (const d of this.debris) this.scene.remove(d.group);
    this.debris = [];
    this.anim = null; this.busy = false;
    a.cb && a.cb.onDone && a.cb.onDone();
  }

  spawnDust(x, y, z, n = 8, spread = 1.0) {
    if (this.reduceMotion) return;
    let k = 0;
    for (const p of this.particles) {
      if (p.life > 0) continue;
      p.life = 0.7 + Math.random() * 0.3; p.m.visible = true; p.m.position.set(x + rand(-1, 1) * spread, y, z + rand(-1, 1) * spread);
      p.vx = rand(-1, 1) * 2.2; p.vz = rand(-1, 1) * 2.2; p.vy = rand(0.6, 2.2); p.m.scale.setScalar(rand(0.6, 1.2)); p.m.material.opacity = 0.8;
      if (++k >= n) break;
    }
  }
  spawnStars(x, y, z) {
    if (this.reduceMotion) return;
    let k = 0;
    for (const f of this.starFx) {
      if (f.life > 0) continue;
      const side = k % 2 ? 1 : -1;
      f.life = 0.9 + Math.random() * 0.3; f.m.visible = true; f.m.position.set(x + side * this.cfg.size * 0.55, y, z + 0.8);
      f.v.set(side * rand(2.5, 5), rand(1, 4), rand(0, 1)); f.m.scale.setScalar(rand(0.8, 1.3));
      if (++k >= 6) break;
    }
    this.spawnDust(x - this.cfg.size * 0.5, y, z + 0.5, 3, 0.4); this.spawnDust(x + this.cfg.size * 0.5, y, z + 0.5, 3, 0.4);
  }
  burstConfetti(x, y, z, n = 90) {
    if (this.reduceMotion) return;
    let k = 0;
    for (const c of this.confetti) {
      if (c.life > 0) continue;
      c.life = 2.2 + Math.random(); c.m.visible = true; c.m.position.set(x, y, z);
      c.v.set(rand(-7, 7), rand(7, 15), rand(-7, 7)); c.w.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
      if (++k >= n) break;
    }
  }
  confettiAtTop() { const t = this.entries[this.entries.length - 1]; this.burstConfetti(t.x, this.altitude + 2, t.z); }
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, behind: v.z > 1 };
  }
  topProjected() { const t = this.entries[this.entries.length - 1]; return this.project(t.x, this.altitude + 1.5, t.z); }

  /* ----- 傾倒：以最低違規接合面為支點，整段繞支點邊緣倒下 ----- */
  startTopple(res, newEntryIdx) {
    const j = res.fallFrom;
    const entries = this.entries.splice(j);
    const all = res.floorsAfter; // 放置後（含新層）樓層清單
    // 支點：支撐區（j 與 j-1 重疊）沿傾倒方向的邊界
    let cx, cz, hx, hz;
    if (j === 0) { cx = 0; cz = 0; hx = this.cfg.ground; hz = this.cfg.ground; }
    else {
      const a = all[j], b = all[j - 1], h = this.cfg.size / 2, ha = h * (a.w || 1), hb = h * (b.w || 1);
      const loX = Math.max(a.x - ha, b.x - hb), hiX = Math.min(a.x + ha, b.x + hb), loZ = Math.max(a.z, b.z) - h, hiZ = Math.min(a.z, b.z) + h;
      cx = (loX + hiX) / 2; cz = (loZ + hiZ) / 2; hx = Math.max(0.05, (hiX - loX) / 2); hz = Math.max(0.05, (hiZ - loZ) / 2);
    }
    let ux = res.pivot ? res.pivot.dx : 1, uz = res.pivot ? res.pivot.dz : 0;
    const L = Math.hypot(ux, uz) || 1; ux /= L; uz /= L;
    const tx = Math.abs(ux) < 1e-6 ? Infinity : hx / Math.abs(ux), tz = Math.abs(uz) < 1e-6 ? Infinity : hz / Math.abs(uz);
    const t = Math.min(tx, tz);
    const px = cx + ux * t, pz = cz + uz * t, py = entries[0] ? entries[0].y0 : 0;
    const pivot = new THREE.Group(); pivot.position.set(px, py, pz); this.scene.add(pivot);
    for (const e of entries) pivot.attach(e.group);
    if (this.roof && j <= this.entries.length + entries.length) pivot.attach(this.roof);
    this.anim = { ...this.anim, type: 'tip', t: 0, pivot, entries, zg: !!this.zeroG, u: { x: ux, z: uz }, theta: 0, omega: 0.25, axis: new THREE.Vector3(uz, 0, -ux) };
  }

  /* ----- 每幀更新 ----- */
  update(dt) {
    dt *= this.timeScale;
    this.time += dt;
    const rm = this.reduceMotion;
    // 視角
    this.yaw += (this.yawTarget - this.yaw) * Math.min(1, dt * 6);
    this.camY += ((this.camYTarget != null ? this.camYTarget : this.camY) - this.camY) * Math.min(1, dt * 2.6);

    // 吊車 / 手上的樓層
    const n = this.entries.length, top = this.entries[n - 1];
    const a = this.anim;
    if (this.turn && !a) {
      const target = this.swingNow();
      const w = smooth(clamp((performance.now() - this.turn.start) / 450, 0, 1));
      this.trolleyD = lerp(this.trolleyD, target, w < 1 ? Math.max(w, 0.08) : 1);
    } else if (a && a.type === 'align') {
      a.t += dt; const k = smooth(clamp(a.t / 0.14, 0, 1));
      this.trolleyD = lerp(a.from, a.to, k);
      const p = a.posAt(this.trolleyD); this.dropFloor.position.set(p.x, this.topY() + GAP + FH * this.holdH * 0.5, p.z);
      if (k >= 1) { a.type = 'fall'; a.t = 0; a.vy = 0; a.y = this.dropFloor.position.y; a.y0 = a.y; a.px = p.x; a.pz = p.z; if (a.cb.onRelease) a.cb.onRelease(); }
    }
    // 繩子：從畫面上方的錨點垂到樓層頂的掛鉤
    const hp = this.holdPos();
    this.anchorY = this.topY() + 30;
    const hookPos = new THREE.Vector3(hp.x, hp.y + FH * 0.5 + 0.5, hp.z);
    const anchor = new THREE.Vector3(top.x, this.anchorY, top.z);
    const dir = anchor.clone().sub(hookPos); const len = dir.length();
    this.rope.scale.y = len; this.rope.position.copy(hookPos).addScaledVector(dir, 0.5);
    this.rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.hook.position.copy(hookPos); this.hook.position.y -= 0.15;
    const tilt = Math.atan2(hookPos.x - anchor.x, this.anchorY - hookPos.y), tiltZ = Math.atan2(hookPos.z - anchor.z, this.anchorY - hookPos.y);
    this.hook.rotation.set(-tiltZ, 0, tilt);
    if (this.heldFloor) {
      this.holdPop = Math.min(1, (this.holdPop || 0) + dt * 3);
      this.holdSlot.position.set(hp.x, hp.y - (1 - smooth(this.holdPop)) * 6, hp.z);
      this.holdSlot.rotation.set(-tiltZ, 0, tilt);
      this.heldFloor.scale.setScalar(0.4 + 0.6 * smooth(this.holdPop));
      if (this.zeroG && !rm) { this.heldFloor.rotation.y = 0.35 * Math.sin(this.time * 0.7); this.heldFloor.rotation.x = 0.1 * Math.sin(this.time * 0.5 + 1); } else this.heldFloor.rotation.set(0, 0, 0); // 無重力：手上的樓層緩緩漂浮轉動
    }
    // 輔助線
    const showGuide = this.guide && this.turn && this.turn.active && !a;
    this.guideGroup.visible = !!showGuide;
    if (showGuide) {
      const topY = this.topY() + 0.06;
      const sw = this.turn.swing || {}, drift = sw.drift || 0, eff = (this.trolleyD + drift) * (1 - (sw.mag || 0)); // 風與太空磁吸都算進預測落點
      const perfect = Math.abs(eff) <= this.cfg.tol;
      const fw = this.cfg.size * ((sw.look && sw.look.w) || 1), gb = this.guideBars; // 輔助框跟著這層樓的寬度
      gb[0].scale.x = fw; gb[1].scale.x = fw; gb[2].position.x = fw / 2; gb[3].position.x = -fw / 2;
      this.guideGroup.position.set(top.x + (perfect ? eff * R.SNAP_KEEP : eff), topY, hp.z); // 預測落點：已算入風的吹移
      this.guideMat.color.set(perfect ? 0x35e08a : 0xffffff);
      this.guideBeam.scale.y = 5.2; this.guideBeam.position.y = 2.6; this.guideBeam.visible = false;
    }

    // 動畫狀態機
    if (a && a.type === 'fall') this.stepFall(dt);
    else if (a && a.type === 'settle') this.stepSettle(dt);
    else if (a && a.type === 'tip') this.stepTip(dt);
    else if (a && a.type === 'wait') { a.t += dt; if (a.t >= a.dur) this.endAnim(); }

    // 殘骸
    this.stepDebris(dt);

    // 搖晃：高度越高、重心越偏越明顯
    const N = Math.max(1, this.entries.length);
    const zg = this.zeroG && this.entries.length >= R.SPACE_FLOORS, fq = zg ? 0.5 : 1;
    const baseAmp = (0.012 + 0.2 * this.sway * this.sway + 0.03 * Math.abs(this.sky.windS || 0)) * Math.min(N, 40) / 10 * (rm ? 0.3 : 1) * (zg ? 1.7 : 1);
    const amp = baseAmp + this.jolt;
    this.jolt = Math.max(0, this.jolt - dt * 0.35);
    if (!(a && a.type === 'tip')) {
      for (const e of this.entries) {
        const k = Math.pow((e.i + 1) / N, 1.6);
        e.group.position.x = e.x + amp * k * Math.sin(this.time * 2.3 * fq + e.i * 0.08);
        e.group.position.z = e.z + amp * k * Math.sin(this.time * 1.9 * fq + 1.1 + e.i * 0.06);
      }
      if (this.roof && this.entries.length && this.roof.visible && !(a && a.type === 'tip')) {
        const t = this.entries[this.entries.length - 1];
        this.roof.position.set(t.group.position.x, this.entries.length * FH, t.group.position.z);
      }
    }

    // 背景：隨高度改變天空
    this.sky.reduceMotion = rm; this.sky.update(dt, this.camY, FH);
    for (const c of this.clouds) { c.userData.a += c.userData.sp * dt * 0.2; c.position.x = Math.cos(c.userData.a) * c.userData.r; c.position.z = Math.sin(c.userData.a) * c.userData.r; }
    for (const b of this.balloons) {
      const u = b.userData;
      b.visible = this.sky.n < 42; if (!b.visible) continue;
      b.position.y += u.sp * dt; b.position.x = Math.cos(u.a + this.time * 0.03) * u.r + Math.sin(this.time * 0.8 + u.ph) * 0.4; b.position.z = Math.sin(u.a + this.time * 0.03) * u.r;
      if (b.position.y > this.altitude + 40) b.position.y = Math.max(-2, this.altitude - 16);
    }
    // 粒子
    for (const p of this.particles) {
      if (p.life <= 0) continue; p.life -= dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt; p.vy -= 3 * dt;
      p.m.scale.multiplyScalar(1 + dt * 1.6); p.m.material.opacity = Math.max(0, p.life) * 0.9;
      if (p.life <= 0) p.m.visible = false;
    }
    for (const f of this.starFx) {
      if (f.life <= 0) continue; f.life -= dt;
      f.m.position.addScaledVector(f.v, dt); f.v.y -= 4 * dt; f.m.rotation.z += dt * 4; f.m.material.opacity = Math.min(1, f.life * 2.5);
      if (f.life <= 0) f.m.visible = false;
    }
    for (const c of this.confetti) {
      if (c.life <= 0) continue; c.life -= dt;
      c.v.y -= 14 * dt; c.m.position.addScaledVector(c.v, dt); c.m.rotation.x += c.w.x * dt; c.m.rotation.y += c.w.y * dt;
      if (c.life <= 0 || c.m.position.y < 0) { c.life = 0; c.m.visible = false; }
    }
    this.shake = Math.max(0, this.shake - dt * 2.4);
    if (this.demo) { this.yaw = 0.38 + 0.12 * Math.sin(this.time * 0.25); }
  }

  stepFall(dt) {
    const a = this.anim, f = this.dropFloor, n = a.n, res = a.res;
    a.vy -= (this.zeroG ? 9 : 38) * dt; if (this.zeroG) a.vy = Math.max(a.vy, -6); a.y += a.vy * dt; // 無重力：緩緩漂下
    const landY = this.topY() + FH * (res.placed.h || 1) * 0.5;
    if (res.missed) { // 完全沒接到：偏離塔身往下掉
      f.position.x += (res.drift || 0) * dt * 1.4; f.position.y = a.y; a.sx = (a.sx || 0) + dt * 1.2; f.rotation.z += dt * 3.2 * (a.pz < 0 ? 1 : -1); f.rotation.x += dt * 2.1;
      const top = this.entries[n - 1]; const dirx = res.axis === 'x' ? Math.sign(res.d || 1) : 0, dirz = res.axis === 'z' ? Math.sign(res.d || 1) : 0;
      f.position.x += dirx * dt * 2.4; f.position.z += dirz * dt * 2.4;
      if (a.y <= landY + 0.2 && !a.passed) { a.passed = true; this.shake = 0.5; a.cb.onImpact && a.cb.onImpact(0.35); }
      if (a.y <= FH * 0.5) {
        this.spawnDust(f.position.x, 0.4, f.position.z, 10, 1.4); a.cb.onFall && a.cb.onFall();
        this.debris.push({ group: f, vel: new THREE.Vector3(0, 0, 0), spin: new THREE.Vector3(0, 0, 0), age: 0, resting: true, fade: 0.9 });
        this.dropFloor = null; this.anim = { ...a, type: 'wait', t: 0, dur: 0.8 };
      }
      return;
    }
    if (a.y <= landY) {
      // 落地
      const p = res.placed;
      this.dropFloor = null;
      const y0 = this.topY(), ht = FH * (p.h || 1);
      f.position.set(p.x, y0 + ht / 2, p.z); f.rotation.set(0, 0, 0); f.scale.setScalar(1);
      const e = { group: f, x: p.x, z: p.z, i: n, data: p, y0, ht };
      this.entries.push(e);
      this.altitude = this.topY();
      const strength = clamp(0.5 + Math.abs(res.off) * 0.15, 0.4, 1);
      this.shake = res.toppled ? 0.7 : (res.perfect ? 0.18 : 0.35);
      this.jolt += res.toppled ? 0.35 : (res.perfect ? 0.04 : 0.12 + Math.abs(res.off) * 0.05);
      this.spawnDust(p.x, y0 + 0.1, p.z, res.perfect ? 4 : 9, this.cfg.size * 0.45);
      a.cb.onImpact && a.cb.onImpact(strength);
      if (res.perfect) { this.spawnStars(p.x, this.altitude - FH * 0.3, p.z); this.burstConfetti(p.x, this.altitude + 0.5, p.z, 10); a.cb.onPerfect && a.cb.onPerfect({ x: p.x, y: this.altitude + 0.6, z: p.z }); }
      this.afterTowerChange(false);
      if (res.toppled) res.floorsAfter = a.floorsBefore.concat([{ x: p.x, z: p.z, w: p.w || 1 }]);
      a.type = 'settle'; a.t = 0; a.topple = !!res.toppled; a.entry = e;
      return;
    }
    f.position.y = a.y;
    { const prog = clamp((a.y0 - a.y) / Math.max(0.01, a.y0 - landY), 0, 1); f.position.x = lerp(a.px, res.placed.x, prog * prog * (3 - 2 * prog)); } // 落下途中被風吹向最終位置
  }

  stepSettle(dt) {
    const a = this.anim; a.t += dt;
    const e = a.entry;
    const k = clamp(a.t / 0.22, 0, 1);
    const sq = Math.sin(k * Math.PI) * 0.1; // 落地壓扁
    if (e) e.group.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
    if (k >= 1) {
      if (e) e.group.scale.set(1, 1, 1);
      if (a.topple) this.startTopple(a.res, this.entries.length - 1);
      else { this.anim = { ...a, type: 'wait', t: 0, dur: 0.3 }; }
    }
  }

  stepTip(dt) {
    const a = this.anim; a.t += dt;
    a.omega += (6.2 * Math.sin(a.theta + 0.05) + 1.2) * (a.zg ? 0.32 : 1) * dt; a.theta += a.omega * dt;
    a.pivot.quaternion.setFromAxisAngle(a.axis, a.theta);
    if (a.t === dt) this.cbCreak && this.cbCreak();
    if (a.theta > 0.85 || a.t > (a.zg ? 3.2 : 2)) {
      // 分離成殘骸
      const u = a.u;
      const parts = [...a.entries, ...(this.roof ? [{ group: this.roof, roof: true }] : [])];
      parts.forEach((e, idx) => {
        this.scene.attach(e.group);
        const vel = new THREE.Vector3(u.x * rand(2.5, 5) + rand(-1, 1), rand(0.5, 2.5), u.z * rand(2.5, 5) + rand(-1, 1));
        const spin = new THREE.Vector3(rand(-2.5, 2.5), rand(-2, 2), rand(-2.5, 2.5));
        if (a.zg) { vel.multiplyScalar(0.35); spin.multiplyScalar(0.5); } // 無重力：殘骸慢慢飄散
        this.debris.push({ group: e.group, vel, spin, age: 0, resting: false, zg: !!a.zg, fade: (1.6 + idx * 0.04) * (a.zg ? 2.2 : 1), roof: !!e.roof });
      });
      this.scene.remove(a.pivot);
      a.cb.onFall && a.cb.onFall();
      this.anim = { ...a, type: 'wait', t: 0, dur: 1.3, pivot: null, entries: null };
      this.roof = null; this.makeRoof();
      if (!this.entries.length) { const rem = a.res.remaining; rem.forEach((f, i) => this.addEntry({ x: f[0], z: f[1], color: f[2], variant: f[3], seat: f[4], w: f[6] || 1, h: f[7] || 1 }, i)); }
      this.afterTowerChange(false);
      this.shake = 0.6;
    }
  }

  stepDebris(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]; d.age += dt;
      if (!d.resting) {
        if (!d.zg) d.vel.y -= 30 * dt; d.group.position.addScaledVector(d.vel, dt);
        d.group.rotation.x += d.spin.x * dt; d.group.rotation.y += d.spin.y * dt; d.group.rotation.z += d.spin.z * dt;
        const floor = d.roof ? 0.3 : FH * 0.45;
        if (!d.zg && d.group.position.y < floor) {
          d.group.position.y = floor; if (Math.abs(d.vel.y) > 3) this.spawnDust(d.group.position.x, 0.3, d.group.position.z, 3, 0.8);
          d.vel.y *= -0.28; d.vel.x *= 0.6; d.vel.z *= 0.6; d.spin.multiplyScalar(0.5);
          if (Math.abs(d.vel.y) < 1) { d.vel.set(0, 0, 0); d.resting = true; }
        }
      }
      const f = d.fade;
      if (d.age > f) { const k = 1 - clamp((d.age - f) / 0.5, 0, 1); d.group.scale.setScalar(Math.max(0.001, k)); if (k <= 0) { this.scene.remove(d.group); this.debris.splice(i, 1); } }
    }
  }

  endAnim() {
    const a = this.anim; this.anim = null; this.busy = false;
    this.turn = null;
    a && a.cb && a.cb.onDone && a.cb.onDone();
  }

  /* ----- 渲染 / 尺寸 ----- */
  resize() {
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.aspect = w / h;
    if (this.viewShift) this.camera.setViewOffset(w, h, -w * this.viewShift, 0, w, h); else if (this.camera.view) this.camera.clearViewOffset();
  }
  render() {
    // 鏡頭距離：同時容納吊車橫向範圍與塔頂上下範圍
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    if (this.turn && this.turn.swing.look) this.lastW = this.turn.swing.look.w || 1;
    const lw = this.cfg.shapes === 'every' ? 1.5 : (this.cfg.shapes === 'fixed' ? (this.lastW || 1) : 1); // 樓層變寬時鏡頭要退後，整局固定不會忽遠忽近
    const needH = 25, needW = Math.max(16, 2 * ((this.cfg.amp || 4.4) + (this.cfg.shapes === 'off' ? 1.2 : 1.8) + (this.cfg.size || 4) * lw / 2) + 1);
    const dH = needH / (2 * Math.tan(vFov / 2));
    const dW = needW / (2 * Math.tan(vFov / 2) * this.aspect);
    const dist = Math.max(dH, dW, 34);
    this.camDist += (dist - this.camDist) * 0.15;
    const pitch = 0.1;
    const top = this.entries.length ? this.entries[this.entries.length - 1] : { x: 0, z: 0 };
    const tx = top.x * 0.6, tz = top.z * 0.6;
    const ty = this.camY + 2.2;
    const sh = this.reduceMotion ? 0 : this.shake;
    const cx = tx + Math.sin(this.yaw) * Math.cos(pitch) * this.camDist + (Math.random() - 0.5) * sh * 0.9;
    const cz = tz + Math.cos(this.yaw) * Math.cos(pitch) * this.camDist + (Math.random() - 0.5) * sh * 0.9;
    const cy = ty + Math.sin(pitch) * this.camDist + (Math.random() - 0.5) * sh * 0.9;
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(tx, ty, tz);
    this.camera.updateMatrixWorld(); this.sky.sync(this.camera);
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.renderer.dispose(); this.renderer.forceContextLoss && this.renderer.forceContextLoss();
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}
