/* 多語系瀏覽器檢查：英文與簡體各畫面不得殘留繁體字串、不得有頁面錯誤，並確認語言切換入口運作。
 * 用法：先啟動伺服器（node server.js），再 node scripts/i18n-check.js（BASE 可指定網址）。 */
'use strict';
const { launch } = require('./browser');
const BASE = process.env.BASE || 'http://localhost:3090/';
const CJK = /[一-鿿]/;
const ALLOWED = /^(繁體中文|简体中文)$/; // 語言選單本身用各語言自稱
const hantOnly = /[學習體機務對戰這個開關閉選單線連驗證計時鍵數據專輪實際]/; // 簡體頁面不該出現的常見繁體字

(async () => {
  const b = await launch(); let bad = 0;
  const fail = (m) => { bad++; console.log('✘ ' + m); };
  for (const lang of ['en', 'zh-Hans']) {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(BASE + '?lang=' + lang); await p.waitForTimeout(1200);
    const scan = async (label) => {
      await p.waitForTimeout(350);
      const texts = await p.evaluate(() => {
        const out = [];
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) { const s = n.nodeValue.trim(); if (s && n.parentElement && !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(n.parentElement.tagName)) out.push(s); }
        document.querySelectorAll('[aria-label],[title],[placeholder]').forEach((e) => ['aria-label', 'title', 'placeholder'].forEach((a) => { const v = e.getAttribute(a); if (v) out.push(v); }));
        return out;
      });
      for (const s of texts) {
        if (lang === 'en' && CJK.test(s) && !ALLOWED.test(s) && !/'s room$/.test(s)) fail(`[${lang}] ${label} 殘留中文：${s.slice(0, 40)}`);
        if (lang === 'zh-Hans' && hantOnly.test(s)) fail(`[${lang}] ${label} 殘留繁體：${s.slice(0, 40)}`);
      }
    };
    await scan('首頁');
    await p.evaluate(() => document.documentElement.lang).then((l) => { if (l !== lang) fail(`<html lang> 應為 ${lang}，實際 ${l}`); });
    for (const [label, name, prm] of [['單人設定', 'setup', { mode: 'solo' }], ['對電腦設定', 'setup', { mode: 'vs' }], ['教學', 'tutorial', {}], ['大廳', 'lobby', {}]]) {
      await p.evaluate(([n, q]) => window.__app.go(n, q), [name, prm]); await scan(label);
    }
    await p.evaluate(() => window.__app.go('game', { kind: 'local', mode: 'versus', diff: 'normal', players: [{ id: 'me', name: 'Eric', kind: 'human' }, { id: 'ai1', name: 'CPU', kind: 'ai', ai: 'hard' }], lives: 2, setupMode: 'vs', shapes: 'every' }));
    await p.waitForTimeout(1500); await scan('對局');
    await p.click('.info-btn').catch(() => {}); await scan('對局（資訊欄）');
    await p.keyboard.press('Escape'); await scan('暫停選單'); await p.keyboard.press('Escape');
    await p.click('.gear-btn'); await scan('設定彈窗'); await p.keyboard.press('Escape');
    // 線上房間：快速加入 → 房間畫面
    await p.evaluate(() => window.__app.go('lobby')); await p.waitForTimeout(800);
    const quick = await p.$('text=' + (lang === 'en' ? 'Quick Join' : '快速加入'));
    if (quick) { await quick.click(); await p.waitForTimeout(1500); await scan('房間'); }
    else fail(`[${lang}] 找不到快速加入按鈕`);
    if (errs.length) fail(`[${lang}] 頁面錯誤：${errs.join(';')}`);
    // 切換語言：設定 → 語言 → 繁體中文，頁面重新載入後為繁中
    await p.evaluate(() => window.__app.go('home')); await p.waitForTimeout(400);
    await p.click('.gear-btn'); await p.waitForTimeout(300);
    await p.click('.modal .sel-btn'); await p.waitForTimeout(200);
    await Promise.all([p.waitForNavigation({ timeout: 8000 }).catch(() => null), p.click('.sel-pop >> text=繁體中文')]);
    await p.waitForTimeout(1200);
    const after = await p.evaluate(() => [document.documentElement.lang, document.body.innerText.includes('單人挑戰')]);
    if (after[0] !== 'zh-Hant' || !after[1]) fail(`[${lang}] 切換到繁中失敗：${after}`);
    await ctx.close();
  }
  await b.close();
  console.log(bad ? `\n多語系檢查：${bad} 個問題` : '\n多語系檢查：全部通過');
  process.exitCode = bad ? 1 : 0;
})();
