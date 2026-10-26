/* 每回合限時：單人設 5 秒 → 顯示倒數、逾時自動放下、暫停時倒數停住；預設單人不顯示倒數；設定頁可選。 */
'use strict';
const { launch } = require('./browser.js');
const BASE = process.env.BASE || 'http://localhost:3090/';
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('✘ ' + m); } else console.log('  ✔ ' + m); };
const cfg = (turnLimit) => ({ kind: 'local', mode: 'solo', diff: 'easy', players: [{ id: 'me', name: 'Eric', kind: 'human' }], lives: 3, turnLimit, setupMode: 'solo' });
(async () => {
  const b = await launch(); const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE); await p.waitForTimeout(500);
  // 設定頁
  await p.evaluate(() => window.__app.go('setup', { mode: 'solo' })); await p.waitForTimeout(500);
  ok(/每回合限時/.test(await p.locator('.page').innerText()) && /單人不限時/.test(await p.locator('.page').innerText()), '單人設定頁有「每回合限時」且預設說明為不限時');
  // 預設：沒有倒數
  await p.evaluate((c) => window.__app.go('game', c), cfg(0)); await p.waitForSelector('.game'); await p.waitForTimeout(2500);
  ok((await p.locator('.turn-timer').innerText()) === '', '預設單人不顯示倒數');
  // 5 秒
  await p.evaluate((c) => window.__app.go('game', c), cfg(5)); await p.waitForSelector('.game'); await p.waitForTimeout(1600);
  const t0 = parseInt(await p.locator('.turn-timer').innerText(), 10);
  ok(t0 >= 1 && t0 <= 5, `顯示倒數（${t0} 秒）`);
  await p.evaluate(() => { window.__d = 0; const d = window.__app.app.screen.debug; const o = d.board.currentD; d.board.currentD = function () { window.__d++; return o.apply(this, arguments); }; });
  // 暫停時倒數停住
  await p.click('.menu-btn'); await p.waitForTimeout(300);
  const a = await p.locator('.turn-timer').innerText(); await p.waitForTimeout(3500);
  const c = await p.locator('.turn-timer').innerText();
  ok(a === c && await p.evaluate(() => window.__d) === 0, `暫停時倒數停住（${a}→${c}）且不會自動放下`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.waitForFunction(() => window.__d >= 1, null, { timeout: 12000 }).catch(() => {});
  ok(await p.evaluate(() => window.__d) >= 1, '時間到自動放下');
  await p.waitForTimeout(2500);
  ok((await p.evaluate(() => window.__app.app.screen.debug.S.sec)) === 5, '下一回合重新倒數 5 秒');
  if (errs.length) { bad++; console.log('✘ 頁面錯誤 ' + errs.join(';')); }
  await b.close();
  console.log(bad ? `\n限時機制：${bad} 個問題` : '\n限時機制：全部通過'); process.exitCode = bad ? 1 : 0;
})();
