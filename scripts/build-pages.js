/* 產生 GitHub Pages 靜態前端：複製 public/ 到 dist/，並以 GAME_SERVER_URL 注入唯一的連線設定（env.js）。 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'public');
const dist = path.join(root, 'dist');
const url = (process.env.GAME_SERVER_URL || '').trim().replace(/\/+$/, '');

if (url) {
  let u;
  try { u = new URL(url); } catch (e) { console.error('GAME_SERVER_URL 不是有效網址：' + url); process.exit(1); }
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) { console.error('production 的 GAME_SERVER_URL 必須是 https:// 開頭'); process.exit(1); }
} else {
  console.warn('[提示] 未設定 GAME_SERVER_URL：前端只能單機／對電腦，線上對戰會顯示「尚未設定伺服器」。');
}

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(src, dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'env.js'), `window.__GAME_CONFIG__ = ${JSON.stringify({ serverUrl: url })};\n`, 'utf8');
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log(`已建置到 dist/（serverUrl = ${url || '(未設定)'}）`);
