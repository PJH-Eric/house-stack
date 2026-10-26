/* 點螢幕任何位置放下：滑鼠左鍵（桌機）與觸控點擊（手機／平板）；按鈕、資訊欄、彈窗上的點擊不可誤放。 */
'use strict';
const { launch } = require('./browser.js');
const BASE = process.env.BASE || 'http://localhost:3090/';
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('✘ ' + m); } else console.log('  ✔ ' + m); };
const CFG = { kind: 'local', mode: 'solo', diff: 'easy', players: [{ id: 'me', name: 'Eric', kind: 'human' }], lives: 3, setupMode: 'solo' };
(async () => {
  const b = await launch();
  for (const [name, w, h, touch] of [['桌機滑鼠', 1440, 900, false], ['平板觸控', 1180, 820, true], ['手機觸控', 390, 844, true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch }); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE); await p.waitForTimeout(500);
    await p.evaluate((c) => window.__app.go('game', c), CFG);
    await p.waitForSelector('.game'); await p.waitForTimeout(2200);
    await p.evaluate(() => { window.__d = 0; const d = window.__app.app.screen.debug; const o = d.board.currentD; d.board.currentD = function () { window.__d++; return 0; }; });
    const drops = () => p.evaluate(() => window.__d);
    const act = async (x, y) => { if (touch) await p.touchscreen.tap(x, y); else await p.mouse.click(x, y); };
    const ready = () => p.waitForFunction(() => { const d = window.__app.app.screen.debug; return d.S.canAct && !d.board.busy; }, null, { timeout: 15000 });
    // 四個角落與中間：找一個不是按鈕的空白位置都應該能放
    await ready(); await p.waitForTimeout(500); await act(w - 40, h - 120); await p.waitForTimeout(400);
    ok(await drops() === 1, `${name}：點畫面右下方空白處放下`);
    await ready(); await p.waitForTimeout(500); await act(Math.round(w / 2), Math.round(h / 2)); await p.waitForTimeout(400);
    ok(await drops() === 2, `${name}：點畫面中央放下`);
    // 點按鈕不可放下
    await ready(); await p.waitForTimeout(500);
    const before = await drops();
    await p.click('.gear-btn'); await p.waitForTimeout(300);
    ok(await drops() === before, `${name}：點設定鈕不會放下`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await p.click('.menu-btn').catch(() => {}); await p.waitForTimeout(300);
    ok(await drops() === before, `${name}：點選單鈕不會放下`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    if (!touch) { await ready(); await p.mouse.click(w / 2, h / 2, { button: 'right' }); await p.waitForTimeout(300); ok(await drops() === before, `${name}：右鍵不會放下`); }
    if (errs.length) { bad++; console.log('✘ 頁面錯誤 ' + errs.join(';')); }
    await ctx.close();
  }
  await b.close();
  console.log(bad ? `\n點擊操作：${bad} 個問題` : '\n點擊操作：全部通過'); process.exitCode = bad ? 1 : 0;
})();
