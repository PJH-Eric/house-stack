/* 語言選單行為：鍵盤開啟／↑↓／Esc、鍵盤事件不外溢到對局（↓／空白不可觸發「放下」）、點外面關閉、aria 狀態。 */
'use strict';
const { launch } = require('./browser.js');
const BASE = process.env.BASE || 'http://localhost:3090/';
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('✘ ' + m); } else console.log('  ✔ ' + m); };
(async () => {
  const b = await launch(); const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '?lang=en'); await p.waitForTimeout(600);
  ok(await p.getAttribute('.lang-btn', 'aria-label') === 'Language', '按鈕有語言 aria-label');
  await p.focus('.lang-btn'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  ok(await p.getAttribute('.lang-btn', 'aria-expanded') === 'true' && !!(await p.$('.lang-pop')), '鍵盤 Enter 開啟選單');
  ok(await p.evaluate(() => document.activeElement.classList.contains('cur')), '焦點落在目前語言');
  await p.keyboard.press('ArrowDown'); ok(await p.evaluate(() => document.activeElement.classList.contains('lang-opt') && !document.activeElement.classList.contains('cur')), '↓ 移到下一個選項');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok(!(await p.$('.lang-pop')) && await p.evaluate(() => document.activeElement.classList.contains('lang-btn')), 'Esc 關閉並把焦點還給按鈕');
  await p.click('.lang-btn'); await p.mouse.click(10, 400); await p.waitForTimeout(150);
  ok(!(await p.$('.lang-pop')), '點選單外面會關閉');
  await p.evaluate(() => window.__app.go('setup', { mode: 'solo' })); await p.waitForTimeout(400);
  await p.click('.lang-btn'); await p.waitForTimeout(150); await p.goBack(); await p.waitForTimeout(500);
  ok(!(await p.$('.lang-pop')), '按瀏覽器返回鍵時語言選單收起');
  await p.evaluate(() => window.__app.go('home')); await p.waitForTimeout(300);
  // 對局中：選單內的按鍵不可讓「放下」觸發
  await p.evaluate(() => window.__app.go('game', { kind: 'local', mode: 'versus', diff: 'normal', players: [{ id: 'me', name: 'Eric', kind: 'human' }, { id: 'ai1', name: 'AI', kind: 'ai', ai: 'hard' }], lives: 2, setupMode: 'vs' }));
  await p.waitForSelector('.game'); await p.waitForTimeout(1500);
  await p.evaluate(() => { window.__drops = 0; const d = window.__app.app.screen.debug; const o = d.board.currentD; d.board.currentD = function () { window.__drops++; return o.apply(this, arguments); }; });
  await p.focus('.lang-btn'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  for (const k of ['ArrowDown', 'ArrowDown', 'ArrowUp']) await p.keyboard.press(k);
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => window.__drops) === 0, '對局中操作語言選單不會觸發「放下」');
  ok(!!(await p.$('.lang-pop')), '選單仍開著');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok(!(await p.$('.lang-pop')) && !(await p.$('.modal')), '對局中 Esc 只關選單，不會開暫停選單');
  if (errs.length) { bad++; console.log('✘ 頁面錯誤 ' + errs.join(';')); }
  await b.close();
  console.log(bad ? `\n語言選單：${bad} 個問題` : '\n語言選單：全部通過'); process.exitCode = bad ? 1 : 0;
})();
