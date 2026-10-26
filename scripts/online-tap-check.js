/* 線上對局的點擊操作：輪到的玩家點螢幕任何位置會放下；不是自己的回合、觀戰者點擊不會送出；聊天輸入框聚焦時點外面只失焦。 */
'use strict';
const { launch } = require('./browser.js');
const BASE = process.env.BASE || 'http://localhost:3090/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('✘ ' + m); } else console.log('  ✔ ' + m); };
(async () => {
  const b = await launch();
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true }); const p = await c.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); return p; };
  const host = await mk(), guest = await mk(), spec = await mk();
  const lobby = async (p) => { await p.goto(BASE); await p.waitForTimeout(600); await p.evaluate(() => window.__app.go('lobby')); await p.waitForTimeout(900); };
  await lobby(host); await host.getByRole('button', { name: '快速加入' }).click(); await host.waitForSelector('.room-page');
  await lobby(guest); await guest.getByRole('button', { name: '快速加入' }).click(); await guest.waitForSelector('.room-page');
  const inv = await host.evaluate(() => { const v = window.__app.app.online.view; return { id: v.id, spec: v.invite.spectator }; });
  await spec.goto(`${BASE}?room=${inv.id}&t=${inv.spec}`); await spec.waitForTimeout(1000);
  await spec.getByRole('button', { name: /確認並觀戰/ }).click(); await spec.waitForSelector('.room-page');
  await guest.evaluate(async () => { const n = await import('./js/net.js'); await n.emit('room:ready', { ready: true }); });
  await host.waitForFunction(() => window.__app.app.view?.canStart?.ok || window.__app.app.online.view.canStart.ok, null, { timeout: 8000 });
  await host.getByRole('button', { name: '開始對局' }).click();
  for (const p of [host, guest, spec]) await p.waitForSelector('.game', { timeout: 40000 });
  await sleep(2500);
  const state = (p) => p.evaluate(() => { const d = window.__app.app.screen.debug; return { can: d.S.canAct && !d.board.busy, floors: d.S.floors ?? null, turn: d.S.turnId }; });
  // 找出目前輪到的人
  let actor = null, other = null;
  for (let i = 0; i < 40 && !actor; i++) { for (const [p, q] of [[host, guest], [guest, host]]) if ((await state(p)).can) { actor = p; other = q; } if (!actor) await sleep(500); }
  ok(!!actor, '找到輪到的玩家');
  await sleep(700);
  // 非輪到者與觀戰者點螢幕：不會送出 game:drop
  for (const [p, n] of [[other, '非輪到的玩家'], [spec, '觀戰者']]) {
    await p.evaluate(() => { window.__sent = 0; const d = window.__app.app.screen.debug; const o = d.board.currentD; d.board.currentD = function () { window.__sent++; return o.apply(this, arguments); }; });
    await p.touchscreen.tap(600, 700); await sleep(500);
    ok(await p.evaluate(() => window.__sent) === 0, `${n}點螢幕不會放下`);
  }
  // 聊天輸入框聚焦時點外面：只失焦
  await actor.evaluate(() => { window.__sent = 0; const d = window.__app.app.screen.debug; d.board.currentD = () => { window.__sent++; return 0; }; });
  const inp = await actor.$('.game .tf-input'); 
  if (inp) { await inp.focus(); await actor.touchscreen.tap(700, 700); await sleep(400);
    ok(await actor.evaluate(() => window.__sent) === 0 && await actor.evaluate(() => document.activeElement.tagName !== 'INPUT'), '輸入框聚焦時點外面只失焦、不放下'); await sleep(700); }
  await actor.touchscreen.tap(700, 700);
  await actor.waitForFunction(() => window.__sent >= 1, null, { timeout: 4000 }).catch(() => {});
  ok(await actor.evaluate(() => window.__sent) === 1, '輪到的玩家點螢幕任何位置放下');
  await sleep(2500);
  for (const p of [host, guest, spec]) if (p.errs.length) { bad++; console.log('✘ 頁面錯誤 ' + p.errs.join(';')); }
  await b.close();
  console.log(bad ? `\n線上點擊：${bad} 個問題` : '\n線上點擊：全部通過'); process.exitCode = bad ? 1 : 0;
})();
