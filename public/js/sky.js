/*
 * 疊疊高樓 — 隨高度變化的背景導演（SkyDirector）。
 * 依「壓縮後的真實層次」安排：市區 → 鳥群 → 直升機 → 積雨雲（下雨、閃電）→ 雲海與客機（尾跡）→
 * 平流層（天空轉深藍、地球弧線）→ 太空（地球、月球、火星、木星、土星…）→ 銀河。
 * 固定白天（只靠高度換景）。天體與地球都掛在相機上（rig），所以不論蓋到幾層都不會飛出視野。
 * 單位：n = 目前鏡頭高度換算的樓層數（可為小數）。
 */
import { t } from './i18n.js';
import * as THREE from '../vendor/three.module.min.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

export const STAGES = [
  [0, t('市區天際線')], [12, t('低空・鳥群')], [22, t('直升機高度')], [34, t('雲層・積雨雲')], [55, t('客機巡航高度')],
  [80, t('平流層')], [110, t('大氣層邊緣')], [140, t('太空・地球軌道')], [190, t('月球')], [260, t('火星')],
  [340, t('木星')], [430, t('土星')], [520, t('天王星')], [620, t('銀河')],
];
export function stageIndex(n) { let k = 0; for (let i = 0; i < STAGES.length; i++) if (n >= STAGES[i][0]) k = i; return k; }

/** 依 key 表線性內插；rows: [n, v0, v1, ...] */
function keyed(rows, n) {
  if (n <= rows[0][0]) return rows[0].slice(1);
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    if (n <= b[0]) { const t = (n - a[0]) / (b[0] - a[0]); return a.slice(1).map((v, k) => lerp(v, b[k + 1], t)); }
  }
  return rows[rows.length - 1].slice(1);
}
const SKY = [ // n, 天空色, 霧色, 半球光, 太陽光, 星空亮度
  [0, 0x7ccbff, 0xcfeeff, 1.0, 1.7, 0], [30, 0x6fb6f7, 0xcfe6fb, 1.0, 1.7, 0], [60, 0x4a8de0, 0x9cc0ee, 0.95, 1.7, 0],
  [85, 0x2563b8, 0x4a78c0, 0.85, 1.8, 0.1], [115, 0x0f2d6b, 0x1a3a7a, 0.7, 1.9, 0.5], [145, 0x030816, 0x050b24, 0.55, 2.0, 1],
  [180, 0x000005, 0x000008, 0.5, 2.0, 1],
];
// 地球：n, 地平線頂端離視線中心往下的弧度, 角半徑
const EARTH = [[38, 0.44, 1.3], [80, 0.24, 1.0], [120, 0.11, 0.62], [160, 0.12, 0.26], [210, 0.17, 0.13], [290, 0.13, 0.08], [420, 0.2, 0.045], [520, 0.3, 0.02]];

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function earthTexture() {
  return canvasTex(1024, 512, (x, w, h) => {
    const r = seeded(7);
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2b7fe0'); g.addColorStop(0.5, '#1d68c8'); g.addColorStop(1, '#2b7fe0');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const land = ['#4fae55', '#3c9a4a', '#7cbf5c', '#b7a45a', '#c9b878'];
    for (let k = 0; k < 26; k++) { // 大陸：許多重疊的不規則圓塊
      const cx = r() * w, cy = h * (0.18 + r() * 0.64), R = 40 + r() * 110;
      for (let i = 0; i < 26; i++) {
        const a = r() * 6.28, d = r() * R;
        x.fillStyle = land[Math.floor(r() * land.length)]; x.beginPath(); x.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, 10 + r() * 38, 0, 7); x.fill();
      }
    }
    x.fillStyle = '#f2f6ff'; x.fillRect(0, 0, w, 24); x.fillRect(0, h - 28, w, 28);
    x.fillStyle = 'rgba(255,255,255,.35)'; for (let i = 0; i < 60; i++) { x.beginPath(); x.ellipse(r() * w, r() * h, 20 + r() * 60, 6 + r() * 14, r() * 3, 0, 7); x.fill(); }
  });
}
function cloudShellTexture() {
  return canvasTex(1024, 512, (x, w, h) => {
    const r = seeded(21); x.clearRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.45})`; x.beginPath(); x.ellipse(r() * w, h * (0.1 + r() * 0.8), 18 + r() * 70, 6 + r() * 16, (r() - 0.5) * 0.6, 0, 7); x.fill(); }
  });
}
function bandTexture(colors, seed, blotch) {
  return canvasTex(512, 256, (x, w, h) => {
    const r = seeded(seed); let y = 0;
    while (y < h) { const bh = 8 + r() * 26; x.fillStyle = colors[Math.floor(r() * colors.length)]; x.fillRect(0, y, w, bh); y += bh; }
    for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(255,255,255,${r() * 0.08})`; x.fillRect(0, r() * h, w, 1 + r() * 3); }
    if (blotch) { x.fillStyle = blotch; x.beginPath(); x.ellipse(w * 0.35, h * 0.62, 38, 20, 0, 0, 7); x.fill(); }
  });
}
function rockTexture(base, dark, seed, polar) {
  return canvasTex(512, 256, (x, w, h) => {
    const r = seeded(seed); x.fillStyle = base; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { x.fillStyle = dark; x.globalAlpha = 0.18 + r() * 0.3; x.beginPath(); x.arc(r() * w, r() * h, 4 + r() * 26, 0, 7); x.fill(); }
    x.globalAlpha = 1;
    if (polar) { x.fillStyle = '#f4f4f4'; x.fillRect(0, 0, w, 14); x.fillRect(0, h - 14, w, 14); }
  });
}
function glowTexture(inner, outer) {
  return canvasTex(256, 256, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, inner); g.addColorStop(0.18, inner); g.addColorStop(0.45, outer); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  });
}
function galaxyTexture() {
  return canvasTex(512, 512, (x, w, h) => {
    const r = seeded(99); x.clearRect(0, 0, w, h);
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(255,240,210,.9)'); g.addColorStop(0.2, 'rgba(190,150,255,.35)'); g.addColorStop(1, 'rgba(60,40,140,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) { // 兩條螺旋臂
      const arm = i % 2, t = r() * 4.5, a = t * 1.5 + arm * Math.PI + (r() - 0.5) * 0.5, d = 14 + t * 52;
      x.fillStyle = `rgba(${200 + r() * 55},${180 + r() * 60},255,${0.15 + r() * 0.5})`; x.fillRect(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d * 0.55, 1.6, 1.6);
    }
  });
}

export class SkyDirector {
  constructor(scene, camera, parts) {
    this.scene = scene; this.camera = camera; this.hemi = parts.hemi; this.sun = parts.sun;
    this.wind = 0; this.windS = 0; this.n = 0; this.stage = 0; this.time = 0; this.rain = 0; this.flash = 0; this.flashIn = 4;
    this.onStage = null; this.onThunder = null; this.reduceMotion = false;
    this.bgColor = new THREE.Color(); this.fogColor = new THREE.Color();
    this.rig = new THREE.Group(); scene.add(this.rig);
    this.buildStars(); this.buildSun(); this.buildEarth(); this.buildPlanets(); this.buildClouds(); this.buildRain(); this.buildBolt(); this.buildWindLines();
    this.pools = { bird: [], heli: [], plane: [] };
    this.timers = { bird: 2, heli: 6, plane: 5 };
  }

  /* ---------- 相機掛載的背景 ---------- */
  buildStars() {
    const N = 1500, p = new Float32Array(N * 3), r = seeded(5);
    for (let i = 0; i < N; i++) { const a = r() * 6.28, e = Math.asin(r() * 2 - 1), R = 3000; p[i * 3] = Math.cos(a) * Math.cos(e) * R; p[i * 3 + 1] = Math.sin(e) * R; p[i * 3 + 2] = Math.sin(a) * Math.cos(e) * R; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.renderOrder = -110; this.stars.frustumCulled = false; this.scene.add(this.stars); // 星空只跟相機位置，不跟轉向
  }
  buildSun() {
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,252,235,1)', 'rgba(255,225,150,.35)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    this.sunSprite.scale.set(520, 520, 1); this.sunSprite.position.set(0.5 * 2400, 0.62 * 2400, -2400); this.sunSprite.renderOrder = -80; this.rig.add(this.sunSprite);
  }
  buildEarth() {
    const geo = new THREE.SphereGeometry(1, 64, 48);
    this.earth = new THREE.Group();
    this.earthBody = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: earthTexture(), emissive: 0x16304f, fog: false, depthWrite: false }));
    this.earthClouds = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: cloudShellTexture(), transparent: true, fog: false, depthWrite: false, emissive: 0x303a48 }));
    this.earthClouds.scale.setScalar(1.012);
    this.earthGlow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x7ec4ff, transparent: true, opacity: 0.38, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.earthGlow.scale.setScalar(1.07);
    for (const m of [this.earthBody, this.earthClouds, this.earthGlow]) { m.frustumCulled = false; }
    this.earthBody.renderOrder = -100; this.earthClouds.renderOrder = -99; this.earthGlow.renderOrder = -98;
    this.earth.add(this.earthBody, this.earthClouds, this.earthGlow); this.earth.visible = false; this.rig.add(this.earth);
  }
  buildPlanets() {
    const geo = new THREE.SphereGeometry(1, 40, 28);
    const defs = [
      { n0: 190, ax: -0.26, rho: 0.11, tex: rockTexture('#a9a9ad', '#6e6e74', 3), name: 'moon' },
      { n0: 270, ax: 0.3, rho: 0.06, tex: rockTexture('#c4673a', '#7a2f17', 11, true), name: 'mars' },
      { n0: 350, ax: -0.3, rho: 0.12, tex: bandTexture(['#d9b48a', '#c28b5e', '#efe0c6', '#a7683f', '#e6c9a0'], 17, '#b5472f'), name: 'jupiter' },
      { n0: 440, ax: 0.27, rho: 0.09, tex: bandTexture(['#e8d49a', '#d1b676', '#f2e6bb', '#c6a458'], 29), name: 'saturn', ring: true },
      { n0: 530, ax: -0.28, rho: 0.07, tex: bandTexture(['#9ee6e8', '#8cd8dc', '#b4f0f0'], 41), name: 'uranus' },
    ];
    this.planets = defs.map((d) => {
      const g = new THREE.Group(), m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: d.tex, emissive: 0x16161c, fog: false, depthWrite: false }));
      m.renderOrder = -90; m.frustumCulled = false; g.add(m);
      if (d.ring) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 2.35, 72), new THREE.MeshBasicMaterial({
          map: canvasTex(256, 8, (x, w, h) => { const r = seeded(5); for (let i = 0; i < w; i++) { x.fillStyle = `rgba(${210 + r() * 40},${190 + r() * 40},${140 + r() * 40},${0.25 + r() * 0.6})`; x.fillRect(i, 0, 1, h); } }),
          side: THREE.DoubleSide, transparent: true, fog: false, depthWrite: false,
        }));
        ring.rotation.x = -1.25; ring.rotation.y = 0.2; ring.renderOrder = -89; ring.frustumCulled = false;
        // 環的 UV 改為沿半徑方向
        const pos = ring.geometry.attributes.position, uv = ring.geometry.attributes.uv;
        for (let i = 0; i < pos.count; i++) { const rr = Math.hypot(pos.getX(i), pos.getY(i)); uv.setXY(i, (rr - 1.4) / 0.95, 0.5); }
        g.add(ring);
      }
      g.visible = false; this.rig.add(g); return { d, g, m };
    });
    this.galaxy = new THREE.Sprite(new THREE.SpriteMaterial({ map: galaxyTexture(), transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    this.galaxy.scale.set(1500, 1500, 1); this.galaxy.position.set(0.32 * 2600, 0.3 * 2600, -2600); this.galaxy.renderOrder = -95; this.rig.add(this.galaxy);
  }

  /* ---------- 世界裡的雲層（都放在樓的後方，不會擋住樓） ---------- */
  buildClouds() {
    this.cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x4a5a70 });
    this.stormMat = new THREE.MeshLambertMaterial({ color: 0xf1f4fb, emissive: 0x2c3548 });
    this.stormBase = new THREE.MeshLambertMaterial({ color: 0xaab4c8, emissive: 0x1d2433 });
    this.cirrusMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x5a6a80, transparent: true, opacity: 0.6 });
    const puff = new THREE.SphereGeometry(1, 12, 10);
    this.clouds = [];
    const r = seeded(31);
    const add = (g, y, speed, spanX = 110) => { g.position.set(rand(-spanX, spanX), y, -rand(20, 120)); g.userData = { sp: speed, span: spanX }; this.scene.add(g); this.clouds.push(g); };
    const mk = (mat, n, sx, sy, sz, spread, matBase) => {
      const g = new THREE.Group();
      for (let k = 0; k < n; k++) { const m = new THREE.Mesh(puff, matBase && k < n * 0.4 ? matBase : mat); m.scale.set(sx * (0.7 + r() * 0.7), sy * (0.7 + r() * 0.6), sz * (0.7 + r() * 0.6)); m.position.set((r() - 0.5) * spread, (r() - 0.5) * sy * 1.2 + (matBase ? k * sy * 0.45 : 0), (r() - 0.5) * spread * 0.4); g.add(m); }
      return g;
    };
    for (let i = 0; i < 16; i++) add(mk(this.cloudMat, 4, 3.2, 2.0, 2.6, 8), rand(46, 82), rand(0.25, 0.7)); // 低雲
    this.storms = [];
    for (let i = 0; i < 9; i++) { const g = mk(this.stormMat, 9, 7.5, 5.5, 6, 18, this.stormBase); add(g, rand(105, 150), rand(0.1, 0.3)); this.storms.push(g); } // 積雨雲
    for (let i = 0; i < 34; i++) add(mk(this.cloudMat, 3, 11, 1.7, 8, 16), rand(168, 182), rand(0.1, 0.25), 150); // 雲海
    for (let i = 0; i < 14; i++) { const g = mk(this.cirrusMat, 3, 15, 0.28, 1.8, 24); add(g, rand(250, 310), rand(0.3, 0.8)); } // 卷雲
  }

  /* ---------- 風：順風飄的白色風線 ---------- */
  setWind(w) { this.wind = w; }
  buildWindLines() {
    const N = 40; this.windN = N; this.windPos = new Float32Array(N * 6); this.windSeed = [];
    for (let i = 0; i < N; i++) this.windSeed.push([rand(-28, 28), rand(-17, 17), -rand(8, 44), rand(0.7, 1.4)]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.windPos, 3)); g.attributes.position.setUsage(THREE.DynamicDrawUsage);
    this.windLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.windLines.frustumCulled = false; this.rig.add(this.windLines);
  }

  /* ---------- 雨與閃電 ---------- */
  buildRain() {
    const N = 420; this.rainN = N;
    this.rainPos = new Float32Array(N * 6); this.rainSeed = [];
    for (let i = 0; i < N; i++) this.rainSeed.push([rand(-26, 26), rand(-16, 16), -rand(6, 46), rand(24, 38)]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3)); g.attributes.position.setUsage(THREE.DynamicDrawUsage);
    this.rainLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xcfe0f5, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.rainLines.frustumCulled = false; this.rig.add(this.rainLines);
  }
  buildBolt() {
    this.bolt = new THREE.Group(); const mat = new THREE.MeshBasicMaterial({ color: 0xf4f8ff, fog: false });
    const geo = new THREE.BoxGeometry(0.35, 1, 0.35); this.boltSegs = [];
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(geo, mat); this.bolt.add(m); this.boltSegs.push(m); }
    this.bolt.visible = false; this.rig.add(this.bolt);
  }
  strike() {
    let x = rand(-6, 6), y = 17; const z = -rand(34, 50);
    this.boltSegs.forEach((m, i) => {
      const nx = x + rand(-2, 2), ny = y - 5.2, dx = nx - x, dy = ny - y, len = Math.hypot(dx, dy);
      m.position.set((x + nx) / 2, (y + ny) / 2, z); m.scale.set(1, len, 1); m.rotation.set(0, 0, -Math.atan2(dx, dy)); x = nx; y = ny;
    });
    this.bolt.visible = true; this.flash = 0.42;
    if (this.onThunder) setTimeout(() => this.onThunder && this.onThunder(), 350 + Math.random() * 500);
  }

  /* ---------- 飛行物 ---------- */
  makeBird() {
    const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: 0x2c3340, side: THREE.DoubleSide });
    const wing = new THREE.PlaneGeometry(1.1, 0.42); wing.translate(0.55, 0, 0);
    const l = new THREE.Mesh(wing, mat), r = new THREE.Mesh(wing, mat); r.scale.x = -1;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mat); body.scale.set(1.5, 0.8, 0.8);
    g.add(l, r, body); g.userData = { l, r, ph: rand(0, 6) }; return g;
  }
  makeHeli() {
    const g = new THREE.Group(), red = new THREE.MeshLambertMaterial({ color: 0xe8453c }), white = new THREE.MeshLambertMaterial({ color: 0xf6f6f6 }), dark = new THREE.MeshLambertMaterial({ color: 0x3a4250 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), red); body.scale.set(2.1, 1.2, 1.2); g.add(body);
    const win = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8), new THREE.MeshLambertMaterial({ color: 0x9fd8f5, emissive: 0x203040 })); win.scale.set(1, 0.9, 1.15); win.position.set(1.15, 0.15, 0); g.add(win);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.32, 0.32), white); tail.position.set(-3.2, 0.3, 0); g.add(tail);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.12), red); fin.position.set(-4.9, 0.7, 0); g.add(fin);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 6), dark); mast.position.y = 1.35; g.add(mast);
    const rotor = new THREE.Group(); rotor.position.y = 1.65;
    for (const a of [0, Math.PI / 2]) { const b = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.06, 0.28), dark); b.rotation.y = a; rotor.add(b); }
    g.add(rotor);
    const tr = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.1), dark); tr.position.set(-4.95, 0.7, 0.14); g.add(tr);
    for (const z of [-0.8, 0.8]) { const sk = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.1, 0.1), dark); sk.position.set(0.1, -1.35, z); g.add(sk); for (const x of [-0.7, 0.9]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), dark); st.position.set(x, -1.0, z); g.add(st); } }
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030 })); light.position.set(-0.2, 1.0, 0); g.add(light);
    g.userData = { rotor, tr, light, ph: 0 }; return g;
  }
  makePlane() {
    const g = new THREE.Group(), white = new THREE.MeshLambertMaterial({ color: 0xf8fafc, emissive: 0x30363f }), blue = new THREE.MeshLambertMaterial({ color: 0x2f6fd8 });
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 9, 12), white); fus.rotation.z = Math.PI / 2; g.add(fus);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8), white); nose.position.x = 4.5; nose.scale.set(1.6, 1, 1); g.add(nose);
    const tailc = new THREE.Mesh(new THREE.ConeGeometry(0.62, 2.2, 12), white); tailc.rotation.z = Math.PI / 2; tailc.position.x = -5.4; g.add(tailc);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.635, 0.635, 5.5, 12), blue); stripe.rotation.z = Math.PI / 2; stripe.scale.set(0.35, 1, 1); g.add(stripe);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 4.6), white); w.position.set(0.2, -0.15, s * 2.6); w.rotation.y = s * 0.45; g.add(w);
      const hs = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 2), white); hs.position.set(-4.7, 0.2, s * 1.0); hs.rotation.y = s * 0.4; g.add(hs);
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.3, 8), blue); eng.rotation.z = Math.PI / 2; eng.position.set(1.0, -0.6, s * 2.0); g.add(eng);
    }
    const fin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.8, 0.14), blue); fin.position.set(-4.7, 1.2, 0); fin.rotation.z = -0.35; g.add(fin);
    const trail = new THREE.Mesh(new THREE.BoxGeometry(1, 0.34, 0.34), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
    g.add(trail); g.userData = { trail, len: 0 }; g.scale.setScalar(1.6); return g;
  }
  spawn(kind, camY) {
    const dir = Math.abs(this.windS) > 0.25 ? Math.sign(this.windS) : (Math.random() < 0.5 ? 1 : -1); // 飛行物順風飛
    if (kind === 'bird') {
      const flock = new THREE.Group(), cnt = 5 + Math.floor(rand(0, 4)), birds = [];
      for (let i = 0; i < cnt; i++) { const b = this.makeBird(); const k = Math.ceil(i / 2) * (i % 2 ? 1 : -1); b.position.set(-Math.abs(k) * 1.8 * dir, rand(-0.4, 0.4), k * 1.6); b.scale.setScalar(rand(0.7, 1.05)); b.rotation.y = dir > 0 ? 0 : Math.PI; flock.add(b); birds.push(b); }
      flock.position.set(-dir * 75, camY + rand(-7, 12), -rand(22, 62)); flock.userData = { kind, dir, speed: rand(4.5, 7), birds, t: 0 };
      this.scene.add(flock); this.pools.bird.push(flock);
    } else if (kind === 'heli') {
      const h = this.makeHeli(); h.rotation.y = dir > 0 ? Math.PI : 0; // 機頭朝行進方向（模型機頭為 +x）
      h.position.set(-dir * 48, camY + rand(-6, 10), -rand(26, 52)); h.userData.kind = kind; h.userData.dir = dir; h.userData.speed = rand(4.5, 6.5);
      this.scene.add(h); this.pools.heli.push(h);
    } else {
      const p = this.makePlane(); p.rotation.y = dir > 0 ? 0 : Math.PI;
      p.position.set(-dir * 160, camY + rand(-4, 14), -rand(70, 130)); p.userData.kind = kind; p.userData.dir = dir; p.userData.speed = rand(13, 19);
      this.scene.add(p); this.pools.plane.push(p);
    }
  }
  stepFliers(dt, camY, n) {
    const rm = this.reduceMotion;
    const rule = { bird: [1, 26, 7, 12], heli: [15, 42, 16, 26], plane: [40, 105, 11, 19] };
    for (const kind of ['bird', 'heli', 'plane']) {
      const [lo, hi, a, b] = rule[kind];
      this.timers[kind] -= dt;
      if (this.timers[kind] <= 0) { this.timers[kind] = rand(a, b); if (n >= lo && n <= hi && !rm) this.spawn(kind, camY); }
      const list = this.pools[kind];
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i], u = o.userData; o.position.x += (u.dir * u.speed + this.windS * 5) * dt;
        if (kind === 'bird') { u.t += dt; for (const b of u.birds) { const f = Math.sin(u.t * 9 + b.userData.ph) * 0.75; b.userData.l.rotation.z = f; b.userData.r.rotation.z = -f; } }
        else if (kind === 'heli') { u.rotor.rotation.y += dt * 38; u.tr.rotation.z += dt * 40; u.ph += dt; u.light.visible = Math.sin(u.ph * 5) > 0; o.position.y += Math.sin(u.ph * 0.9) * dt * 0.4; }
        else { u.len = Math.min(70, u.len + dt * 11); u.trail.scale.x = u.len / 1; u.trail.position.x = -(5.6 + u.len / 2); }
        if (Math.abs(o.position.x) > 190) { this.scene.remove(o); list.splice(i, 1); }
        // 飛行物跟著鏡頭上下緩慢追高，避免蓋樓時留在原地
        const target = camY + (kind === 'bird' ? 2 : kind === 'heli' ? 3 : 6); o.position.y += (Math.max(o.position.y, target - 14) - o.position.y) * Math.min(1, dt * 0.6);
      }
    }
  }

  /* ---------- 主更新 ---------- */
  update(dt, camY, FH) {
    this.time += dt; const n = camY / FH; this.n = n;
    this.windS += (this.wind - this.windS) * Math.min(1, dt * 1.5); const ws = this.windS;
    const st = stageIndex(n);
    if (st !== this.stage) { const up = st > this.stage; this.stage = st; if (up && this.onStage) this.onStage(STAGES[st][1], st); }
    // 天空與光線
    const row = keyed(SKY, n); this.bgColor.setHex(0x000000);
    const k = SKY; let i = 0; while (i < k.length - 2 && n > k[i + 1][0]) i++;
    const t = clamp((n - k[i][0]) / (k[i + 1][0] - k[i][0]), 0, 1);
    this.bgColor.setHex(k[i][1]).lerp(new THREE.Color(k[i + 1][1]), t); this.fogColor.setHex(k[i][2]).lerp(new THREE.Color(k[i + 1][2]), t);
    // 暴風雨：天空偏灰、有雨與閃電
    const storm = clamp(Math.min((n - 34) / 4, (52 - n) / 4), 0, 1) * (this.reduceMotion ? 0.4 : 1);
    this.rain += (storm - this.rain) * Math.min(1, dt * 2);
    this.bgColor.lerp(new THREE.Color(0x71819a), 0.5 * this.rain); this.fogColor.lerp(new THREE.Color(0x8d9ab0), 0.5 * this.rain);
    this.scene.background.copy(this.bgColor); this.scene.fog.color.copy(this.fogColor);
    const f0 = clamp((n - 50) / 60, 0, 1); this.scene.fog.near = lerp(70, 1800, f0); this.scene.fog.far = lerp(230, 9000, f0);
    this.flash = Math.max(0, this.flash - dt);
    const fl = this.flash > 0 ? Math.sin(this.flash / 0.42 * Math.PI * 3) ** 2 * 1.3 : 0;
    this.hemi.intensity = row[2] * (1 - 0.2 * this.rain) + fl; this.sun.intensity = row[3] * (1 - 0.35 * this.rain);
    this.sun.color.setHex(0xffffff);
    this.stars.material.opacity = row[4]; this.stars.visible = row[4] > 0.01;
    this.sunSprite.material.opacity = clamp(1 - this.rain * 0.9, 0.05, 1);
    this.cloudMat.emissive.setHex(n > 110 ? 0x30386a : 0x4a5a70);
    if (this.flash <= 0) this.bolt.visible = false;
    if (this.rain > 0.3 && this.flash <= 0) { this.flashIn -= dt; if (this.flashIn <= 0) { this.flashIn = rand(2.5, 6); if (!this.reduceMotion) this.strike(); } }
    // 雨滴
    this.rainLines.visible = this.rain > 0.02; this.rainLines.material.opacity = 0.55 * this.rain;
    if (this.rainLines.visible) {
      const p = this.rainPos;
      for (let j = 0; j < this.rainN; j++) {
        const s = this.rainSeed[j]; s[1] -= s[3] * dt; if (s[1] < -16) s[1] += 32; s[0] += ws * 9 * dt; if (s[0] > 26) s[0] -= 52; else if (s[0] < -26) s[0] += 52;
        p[j * 6] = s[0]; p[j * 6 + 1] = s[1]; p[j * 6 + 2] = s[2]; p[j * 6 + 3] = s[0] - 0.12 - ws * 1.3; p[j * 6 + 4] = s[1] - 1.5; p[j * 6 + 5] = s[2];
      }
      this.rainLines.geometry.attributes.position.needsUpdate = true;
    }
    // 風線
    const wa = Math.abs(ws), showW = wa > 0.04 && !this.reduceMotion; this.windLines.visible = showW; this.windLines.material.opacity = 0.5 * Math.min(1, wa * 1.6);
    if (showW) {
      const p = this.windPos, len = 1.2 + 5 * wa;
      for (let j = 0; j < this.windN; j++) {
        const s = this.windSeed[j]; s[0] += ws * 34 * s[3] * dt; if (s[0] > 28) s[0] -= 56; else if (s[0] < -28) s[0] += 56;
        p[j * 6] = s[0]; p[j * 6 + 1] = s[1]; p[j * 6 + 2] = s[2]; p[j * 6 + 3] = s[0] - Math.sign(ws) * len; p[j * 6 + 4] = s[1] + Math.sin(s[0] * 0.3) * 0.25; p[j * 6 + 5] = s[2];
      }
      this.windLines.geometry.attributes.position.needsUpdate = true;
    }
    // 雲：緩緩飄移；到達範圍外再從另一側回來；各層只在對應高度附近才顯示（省效能）
    for (const c of this.clouds) {
      c.position.x += (c.userData.sp * 0.4 + ws * 6) * dt; if (c.position.x > c.userData.span) c.position.x = -c.userData.span; else if (c.position.x < -c.userData.span) c.position.x = c.userData.span;
      c.visible = Math.abs(c.position.y - camY) < 190;
    }
    // 地球
    const ek = keyed(EARTH, n);
    const showEarth = n > 37 && !(n > 500 && ek[1] < 0.03);
    this.earth.visible = showEarth;
    if (showEarth) {
      const top = ek[0], rho = ek[1], D = 2000, c = top + rho;
      this.earth.position.set(0, -D * Math.sin(c), -D * Math.cos(c)); this.earth.scale.setScalar(D * Math.sin(rho));
      this.earthBody.rotation.y = this.time * 0.01; this.earthClouds.rotation.y = this.time * 0.016;
    }
    // 行星：隨高度由上往下經過畫面
    for (const p of this.planets) {
      const u = (n - p.d.n0) / 130, vis = Math.abs(u) < 1; p.g.visible = vis;
      if (!vis) continue;
      const ay = 0.7 - (u + 1) / 2 * 1.4, D = 1800, rho = p.d.rho * (1.25 - 0.4 * Math.abs(u));
      p.g.position.set(D * Math.tan(p.d.ax), D * Math.tan(ay), -D); p.g.scale.setScalar(D * Math.sin(rho)); p.m.rotation.y = this.time * 0.03;
    }
    this.galaxy.material.opacity = clamp((n - 560) / 80, 0, 0.85);
    this.stepFliers(dt, camY, n);
  }

  /** 每幀在相機定位後呼叫：把背景掛到相機上 */
  sync(camera) {
    this.rig.position.copy(camera.position); this.rig.quaternion.copy(camera.quaternion);
    this.stars.position.copy(camera.position);
  }
}
