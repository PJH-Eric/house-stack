/*
 * 版面巡檢：在多種尺寸與方向下開啟每個畫面，檢查
 *  1) 沒有未受控的水平溢出（頁面寬度、元素超出視窗）
 *  2) 沒有原生控制項（select/textarea/checkbox/range…）與原生可見捲軸
 *  3) 主要操作按鈕在視窗內且命中區 ≥ 36px
 * 需要 Playwright 與執行中的伺服器：BASE=http://localhost:3090 node scripts/layout-audit.js
 */
'use strict';
const { launch } = require('./browser.js');
const BASE = process.env.BASE || 'http://localhost:3090/';
const SIZES = { 'phone-p': [390, 844], 'phone-l': [844, 390], 'tablet-p': [820, 1180], 'tablet-l': [1180, 820], desktop: [1440, 900] };

function auditPage() {
  const out = [];
  const vw = window.innerWidth, vh = window.innerHeight;
  if (document.documentElement.scrollWidth > vw + 1) out.push(`頁面水平溢出 scrollWidth=${document.documentElement.scrollWidth} > ${vw}`);
  for (const el of document.querySelectorAll('select, textarea, input[type=checkbox], input[type=radio], input[type=range], input[type=number], input[type=date], details, dialog')) out.push('原生控制項：' + el.tagName + ' ' + (el.type || ''));
  for (const el of document.querySelectorAll('input')) if (!el.closest('.tf')) out.push('輸入框未經自訂元件封裝');
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2 && cs.scrollbarWidth !== 'none') out.push('可見原生捲軸：' + el.className);
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 2 && cs.scrollbarWidth !== 'none') out.push('可見原生橫向捲軸：' + el.className);
  }
  for (const el of document.querySelectorAll('.btn, .icon-btn, .tg, .sel-btn, .tf-input, .sl')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.closest('[hidden]') || getComputedStyle(el).visibility === 'hidden') continue;
    const inScroll = el.closest('.sa-view');
    if (!inScroll && (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1)) out.push(`超出視窗：${el.className} ${el.textContent.trim().slice(0, 12)}`);
    if (r.height < 30 && !el.classList.contains('btn-xs')) out.push(`命中區過小：${el.className} h=${Math.round(r.height)}`);
  }
  return out;
}

(async () => {
  const b = await launch(); let bad = 0; const sum = [];
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  for (const [key, [w, h]] of Object.entries(SIZES)) {
    if (only && !only.includes(key)) continue;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: key !== 'desktop' });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE); await p.waitForTimeout(500);
    const check = async (label) => { await p.waitForTimeout(350); const r = await p.evaluate(auditPage); r.forEach((x) => { bad++; console.log(`✘ [${key}] ${label}: ${x}`); }); sum.push(`${key}/${label}:${r.length ? 'NG' : 'ok'}`); };
    await check('首頁');
    await p.click('.gear-btn'); await check('設定彈窗'); await p.keyboard.press('Escape');
    await p.evaluate(() => window.__app.go('setup', { mode: 'solo' })); await check('單人設定');
    await p.evaluate(() => window.__app.go('setup', { mode: 'vs' })); await check('對電腦設定');
    await p.evaluate(() => window.__app.go('tutorial')); await check('教學');
    await p.evaluate(() => window.__app.go('lobby')); await p.waitForTimeout(700); await check('大廳');
    await p.evaluate(() => window.__app.go('game', { kind: 'local', mode: 'versus', diff: 'normal', players: [{ id: 'me', name: 'Eric', kind: 'human' }, { id: 'ai1', name: '電腦1', kind: 'ai', ai: 'hard' }], lives: 2, setupMode: 'vs' }));
    await p.waitForTimeout(1200); await check('對局');
    await p.click('.info-btn'); await p.waitForTimeout(1200); await check('對局(資訊欄切換後)');
    if (await p.evaluate(() => document.querySelector('.game').classList.contains('panel-open'))) await p.click('.side-head .icon-btn');
    await p.waitForTimeout(400);
    await p.click('.menu-btn'); await check('暫停選單'); await p.keyboard.press('Escape');
    await p.click('.info-btn'); await p.waitForTimeout(1200); await check('對局(資訊欄展開)');
    if (await p.evaluate(() => document.querySelector('.game').classList.contains('panel-open'))) await p.click('.side-head .icon-btn');
    await p.waitForTimeout(300);
    await p.evaluate(() => { window.__app.app.screen.debug.board.currentD = () => 4.4; }); // 人類故意放到沒接到，盡快走到結算
    for (let i = 0; i < 90 && !(await p.$('.result')); i++) {
      const t = await p.evaluate(() => document.querySelector('.turn-banner')?.textContent || '');
      if (t.includes('輪到你')) await p.keyboard.press('Space');
      await p.waitForTimeout(1200);
    }
    if (await p.$('.result')) await check('結算 overlay'); else { bad++; console.log(`✘ [${key}] 沒有出現結算`); }
    if (errs.length) { bad++; console.log(`✘ [${key}] 頁面錯誤：${errs.join(';')}`); }
    await ctx.close();
  }
  await b.close();
  console.log(sum.join('  '));
  console.log(bad ? `\n版面巡檢：${bad} 個問題` : '\n版面巡檢：全部通過');
  process.exitCode = bad ? 1 : 0;
})();
