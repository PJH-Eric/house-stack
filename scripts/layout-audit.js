/*
 * 版面巡檢：在多種尺寸與方向下開啟每個畫面，檢查
 *  1) 沒有未受控的水平溢出（頁面寬度、元素超出視窗）
 *  2) 沒有原生控制項（select/textarea/checkbox/range…）與原生可見捲軸
 *  3) 主要操作按鈕在視窗內且命中區 ≥ 36px
 * 需要 Playwright 與執行中的伺服器：BASE=http://localhost:3090 node scripts/layout-audit.js
 */
'use strict';
const { launch } = require('./browser.js');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:3090/';
const OUT = process.env.OUT;
const SIZES = { 'phone-xs': [320, 640], 'phone-p': [390, 844], 'phone-l': [844, 390], 'tablet-p': [820, 1180], 'tablet-l': [1180, 820], desktop: [1440, 900] };

function auditPage() {
  const out = [];
  const vw = window.innerWidth, vh = window.innerHeight;
  if (document.documentElement.scrollWidth > vw + 1) out.push(`頁面水平溢出 scrollWidth=${document.documentElement.scrollWidth} > ${vw}`);
  for (const el of document.querySelectorAll('select, textarea, input[type=checkbox], input[type=radio], input[type=range], input[type=number], input[type=date], details, dialog')) out.push('原生控制項：' + el.tagName + ' ' + (el.type || ''));
  for (const el of document.querySelectorAll('input')) if (!el.closest('.tf')) out.push('輸入框未經自訂元件封裝');
  // 文字被裁切：有文字的元素內容比盒子寬／高，且會被 overflow 或 ellipsis 截掉；或按鈕文字斷成過多行（多語系常見）
  for (const el of document.querySelectorAll('.btn, .sel-btn, .sel-text, .badge, .tg-label, .stat small, .stat b, .turn-banner, h1, h2, h3, .modal-head h2, .rr-main, .rr-sub, .seat, .notice')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.closest('[hidden]') || getComputedStyle(el).visibility === 'hidden') continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 2 && !el.closest('.sa-view')) out.push(`文字被橫向裁切：${el.className} "${el.textContent.trim().slice(0, 24)}" ${el.scrollWidth}>${el.clientWidth}`);
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 2) out.push(`文字被省略號截斷：${el.className} "${el.textContent.trim().slice(0, 24)}"`);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    if (el.matches('.btn, .sel-btn') && r.height > lh * 2.6 + 12) out.push(`按鈕文字斷成過多行：${el.className} "${el.textContent.trim().slice(0, 24)}" h=${Math.round(r.height)}`);
  }
  for (const f of document.querySelectorAll('.gear-wrap > *')) { // 右上角固定鈕不可蓋住結算層的標題或按鈕
    const fr = f.getBoundingClientRect(); if (f.hidden || !fr.width) continue;
    for (const t of document.querySelectorAll('.result h2, .result .btn')) {
      const tr = t.getBoundingClientRect();
      const w = Math.min(fr.right, tr.right) - Math.max(fr.left, tr.left), hh = Math.min(fr.bottom, tr.bottom) - Math.max(fr.top, tr.top);
      if (w > 3 && hh > 3) { const top = document.elementFromPoint(Math.max(fr.left, tr.left) + w / 2, Math.max(fr.top, tr.top) + hh / 2); if (top && f.contains(top)) out.push(`右上角按鈕蓋住結算層：${t.textContent.trim().slice(0, 16)}`); }
    }
  }
  for (const v of document.querySelectorAll('.sa-view:not(.sa-x)')) if (v.scrollWidth > v.clientWidth + 2 && v.getBoundingClientRect().width) out.push(`捲動區內容橫向溢出：${(v.parentElement && v.parentElement.className) || ''} ${v.scrollWidth}>${v.clientWidth}`);
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2 && cs.scrollbarWidth !== 'none') out.push('可見原生捲軸：' + el.className);
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 2 && cs.scrollbarWidth !== 'none') out.push('可見原生橫向捲軸：' + el.className);
  }
  for (const el of document.querySelectorAll('.btn, .icon-btn, .tg, .sel-btn, .tf-input, .sl')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.closest('[hidden]') || getComputedStyle(el).visibility === 'hidden') continue;
    const inScroll = el.closest('.sa-view');
    if (!inScroll && (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1)) out.push(`超出視窗：${el.className} ${el.textContent.trim().slice(0, 12)} [${el.getAttribute('aria-label') || ''}] ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
    if (r.height < 30 && !el.classList.contains('btn-xs')) out.push(`命中區過小：${el.className} h=${Math.round(r.height)}`);
  }
  if (document.querySelector('.game') && (vw <= 600 || (vh <= 520 && vw > vh))) {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
    const overlaps = (a, b) => a && b &&
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
    const header = ['.tb-left', '.tb-center', '.tb-right', '.gear-wrap'];
    for (let i = 0; i < header.length; i++) for (let j = i + 1; j < header.length; j++) {
      if (overlaps(rect(header[i]), rect(header[j]))) out.push(`手機工具列重疊：${header[i]} / ${header[j]}`);
    }
    const status = rect('.stage-status'), hud = rect('.hud-bl'), wind = rect('.wind-chip'), drop = rect('.drop-btn');
    if (overlaps(hud, wind)) out.push('手機樓層／愛心與風力重疊');
    if (status && (status.left < 0 || status.right > vw + 1 || status.bottom > vh + 1)) out.push('手機狀態列超出可視範圍');
    if (overlaps(status, drop)) out.push('手機狀態列遮住放下按鈕');
    if (hud && hud.height > 46) out.push(`手機 HUD 未收成橫排：h=${Math.round(hud.height)}`);
    if (drop && drop.height < 48) out.push('手機放下按鈕命中區不足 48px');
  }
  return out;
}

(async () => {
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const b = await launch(); let bad = 0; const sum = [];
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  for (const [key, [w, h]] of Object.entries(SIZES)) {
    if (only && !only.includes(key)) continue;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: key !== 'desktop' });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + (process.env.LANG_CODE ? '?lang=' + process.env.LANG_CODE : '')); await p.waitForTimeout(500);
    const check = async (label) => {
      await p.waitForTimeout(350);
      await p.waitForFunction(() => !document.getAnimations().some((x) => x.playState === 'running' && x.effect && x.effect.getTiming().iterations !== Infinity), null, { timeout: 4000 }).catch(() => {});
      const r = await p.evaluate(auditPage);
      r.forEach((x) => { bad++; console.log(`✘ [${key}] ${label}: ${x}`); });
      sum.push(`${key}/${label}:${r.length ? 'NG' : 'ok'}`);
      if (OUT) await p.screenshot({ path: path.join(OUT, `${process.env.LANG_CODE || 'zh-Hant'}-${key}-${label}.png`) });
    };
    await check('首頁');
    await p.click('.gear-btn'); await check('設定彈窗'); await p.keyboard.press('Escape');
    await p.evaluate(() => window.__app.go('setup', { mode: 'solo' })); await check('單人設定');
    await p.evaluate(() => window.__app.go('setup', { mode: 'vs' })); await check('對電腦設定');
    await p.evaluate(() => window.__app.go('tutorial')); await check('教學');
    await p.evaluate(() => window.__app.go('lobby')); await p.waitForTimeout(700); await check('大廳');
    await p.click('.lobby-actions .btn:not(.autofocus)'); await p.waitForSelector('.modal', { timeout: 4000 }).catch(() => {}); await check('建立房間彈窗'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await p.click('.lobby-actions .autofocus'); await p.waitForSelector('.room-page', { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(600); await check('房間'); // 快速加入 → 房間頁
    if (await p.$('.room-page')) await p.click('.room-page [data-back]');
    await p.evaluate(() => window.__app.go('home')); await p.waitForTimeout(500);
    await p.evaluate(() => window.__app.go('game', { kind: 'local', mode: 'versus', diff: 'normal', turnLimit: 15, players: [{ id: 'me', name: 'Eric', kind: 'human' }, { id: 'ai1', name: '電腦1', kind: 'ai', ai: 'hard' }], lives: 2, setupMode: 'vs' }));
    await p.waitForTimeout(1200);
    await p.evaluate(() => {
      const d = window.__app.app.screen.debug;
      d.S.paused = true; // 版面巡檢期間凍結回合，不讓截圖耗時觸發自動放下。
      const render = d.board.render.bind(d.board);
      let last = 0;
      d.board.render = () => { // 限制軟體 WebGL 重繪頻率，保留原本的狀態與輸入迴圈。
        const now = performance.now();
        if (now - last >= 100) { last = now; render(); }
      };
    });
    await check('對局');
    await p.click('.info-btn'); await p.waitForTimeout(1200); await check('對局(資訊欄切換後)');
    if (await p.evaluate(() => document.querySelector('.game').classList.contains('panel-open'))) await p.click('.side-head .icon-btn');
    await p.waitForTimeout(400);
    await p.click('.menu-btn'); await check('暫停選單'); await p.keyboard.press('Escape');
    await p.evaluate(() => { window.__app.app.screen.debug.S.paused = true; });
    await p.click('.info-btn'); await p.waitForTimeout(1200); await check('對局(資訊欄展開)');
    if (await p.evaluate(() => document.querySelector('.game').classList.contains('panel-open'))) await p.click('.side-head .icon-btn');
    await p.waitForTimeout(300);
    await p.evaluate(() => { const d = window.__app.app.screen.debug; d.S.paused = false; d.board.currentD = () => 4.4; }); // 恢復實際流程；人類故意放到沒接到，盡快走到結算。
    for (let i = 0; i < 90 && !(await p.$('.result')); i++) {
      const t = await p.evaluate(() => document.querySelector('.turn-banner')?.textContent || '');
      if (/輪到你|你的回合|Your turn|轮到你/.test(t)) await p.keyboard.press('Space'); // 各語言的「輪到你」橫幅
      await p.waitForTimeout(1200);
    }
    if (await p.$('.result')) {
      await check('結算 overlay');
      await p.click('.res-actions .btn-primary');
      await p.waitForFunction(() => !document.querySelector('.result') && window.__app.app.screen.debug.S.canAct);
      await check('再來一局');
    } else { bad++; console.log(`✘ [${key}] 沒有出現結算`); }
    if (errs.length) { bad++; console.log(`✘ [${key}] 頁面錯誤：${errs.join(';')}`); }
    await ctx.close();
  }
  await b.close();
  console.log(sum.join('  '));
  console.log(bad ? `\n版面巡檢：${bad} 個問題` : '\n版面巡檢：全部通過');
  process.exitCode = bad ? 1 : 0;
})();
