/*
 * 右上角固定按鈕（語言／設定／延遲徽章）是否蓋住其他可操作元素或標題：各畫面 × 各尺寸 × 各語言。
 * 需要伺服器執行中：BASE=http://localhost:3090/ node scripts/overlap-check.js
 */
'use strict';
const { launch } = require('./browser.js');
const BASE = process.env.BASE || 'http://localhost:3090/';
const SIZES = process.env.ONLY_320 ? { 'phone-320': [320, 640] } : { 'phone-320': [320, 640], 'phone-p': [390, 844], 'phone-l': [844, 390], 'tablet-p': [820, 1180], 'tablet-l': [1180, 820] };
const LANGS = (process.env.LANGS || 'zh-Hant,en,zh-Hans').split(',');

function scan() {
  const fixed = [...document.querySelectorAll('.gear-wrap > *')].filter((e) => !e.hidden && e.getBoundingClientRect().width);
  const targets = [...document.querySelectorAll('.btn, .icon-btn, .sel-btn, .tf-input, h1, h2, .stat, .turn-banner, .lobby-link')].filter((e) => !e.closest('.gear-wrap') && !e.closest('.sel-pop') && e.getBoundingClientRect().width && getComputedStyle(e).visibility !== 'hidden');
  const out = [];
  const inter = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 3 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 3;
  for (const f of fixed) {
    const fr = f.getBoundingClientRect();
    for (const t of targets) {
      const tr = t.getBoundingClientRect();
      if (!inter(fr, tr)) continue;
      // 被上層（資訊欄、Modal）蓋住的不算
      const cx = (Math.max(fr.left, tr.left) + Math.min(fr.right, tr.right)) / 2, cy = (Math.max(fr.top, tr.top) + Math.min(fr.bottom, tr.bottom)) / 2;
      const top = document.elementFromPoint(cx, cy);
      if (top && !f.contains(top)) continue;
      out.push(`${f.className.split(' ')[0]} 蓋住 ${t.tagName}.${(t.className || '').toString().split(' ')[0]} "${t.textContent.trim().slice(0, 16)}"`);
    }
  }
  return out;
}

(async () => {
  const b = await launch(); let bad = 0;
  for (const lang of LANGS) for (const [key, [w, h]] of Object.entries(SIZES)) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true });
    const p = await ctx.newPage();
    await p.goto(`${BASE}?lang=${lang}`); await p.waitForTimeout(500);
    const screens = [['首頁', () => {}], ['單人設定', () => window.__app.go('setup', { mode: 'solo' })], ['教學', () => window.__app.go('tutorial')], ['大廳', () => window.__app.go('lobby')],
      ['對局', () => window.__app.go('game', { kind: 'local', mode: 'versus', diff: 'normal', players: [{ id: 'me', name: 'Eric', kind: 'human' }, { id: 'ai1', name: 'AI', kind: 'ai', ai: 'hard' }], lives: 2, setupMode: 'vs' })]];
    for (const [name, fn] of screens) {
      await p.evaluate(fn); await p.waitForTimeout(name === '對局' ? 1400 : name === '大廳' ? 3300 : 600);
      for (const m of await p.evaluate(scan)) { bad++; console.log(`✘ [${lang}/${key}] ${name}: ${m}`); }
    }
    await ctx.close();
  }
  await b.close();
  console.log(bad ? `\n重疊檢查：${bad} 個問題` : '\n重疊檢查：全部通過');
  process.exitCode = bad ? 1 : 0;
})();
