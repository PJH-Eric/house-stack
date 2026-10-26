/* 線上限時：房主設 5 秒，雙方都看到倒數；輪到的人不操作，伺服器逾時自動放下並換手。 */
'use strict';
const { launch } = require('./browser.js');
const BASE = process.env.BASE || 'http://localhost:3090/';
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('✘ ' + m); } else console.log('  ✔ ' + m); };
(async () => {
  const b = await launch();
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1180, height: 820 } }); const p = await c.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); return p; };
  const host = await mk(), guest = await mk();
  const lobby = async (p) => { await p.goto(BASE); await p.waitForTimeout(600); await p.evaluate(() => window.__app.go('lobby')); await p.waitForTimeout(900); };
  await lobby(host); await host.getByRole('button', { name: '快速加入' }).click(); await host.waitForSelector('.room-page');
  await host.evaluate(async () => { const n = await import('./js/net.js'); await n.emit('room:settings', { turnLimit: 5 }); });
  await lobby(guest); await guest.getByRole('button', { name: '快速加入' }).click(); await guest.waitForSelector('.room-page');
  ok(await guest.evaluate(() => window.__app.app.online.view.settings.turnLimit) === 5, '房間設定 5 秒同步給玩家');
  await guest.evaluate(async () => { const n = await import('./js/net.js'); await n.emit('room:ready', { ready: true }); });
  await host.waitForFunction(() => window.__app.app.online.view.canStart.ok, null, { timeout: 8000 });
  await host.getByRole('button', { name: '開始對局' }).click();
  for (const p of [host, guest]) await p.waitForSelector('.game', { timeout: 40000 });
  await host.waitForTimeout(2500);
  const st = (p) => p.evaluate(() => { const d = window.__app.app.screen.debug; return { sec: d.S.sec, no: d.S.turnNo, turn: d.S.turnId, timer: document.querySelector('.turn-timer').textContent, floors: d.S.height }; });
  const a = await st(host), g = await st(guest);
  ok(a.sec === 5 && g.sec === 5, `雙方回合秒數都是 5（${a.sec}/${g.sec}）`);
  ok(/^[0-5]$/.test(a.timer) && /^[0-5]$/.test(g.timer), `雙方都顯示倒數（${a.timer}/${g.timer}）`);
  // 不操作，等伺服器逾時自動放下並換手
  const turn0 = a.turn; let moved = false;
  for (let i = 0; i < 30 && !moved; i++) { await host.waitForTimeout(700); const s = await st(host); if (s.turn !== turn0) moved = true; }
  ok(moved, '逾時後伺服器自動放下並換到下一位');
  for (const p of [host, guest]) if (p.errs.length) { bad++; console.log('✘ 頁面錯誤 ' + p.errs.join(';')); }
  await b.close();
  console.log(bad ? `\n線上限時：${bad} 個問題` : '\n線上限時：全部通過'); process.exitCode = bad ? 1 : 0;
})();
