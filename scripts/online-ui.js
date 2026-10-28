/*
 * 線上畫面端到端檢查（真瀏覽器、三個客戶端）：房主 + 玩家 + 觀戰者走完 大廳 → 房間 → 邀請連結 → 對局 → 結算，並截圖。
 * 需要伺服器執行中：BASE=http://localhost:3090/ node scripts/online-ui.js
 */
'use strict';
const fs = require('fs');
const { launch } = require('./browser.js');
const BASE = process.env.BASE || 'http://localhost:3090/';
const OUT = process.env.OUT || 'screenshots';
const SIZES = { 'tablet-landscape': [1180, 820], 'phone-portrait': [390, 844], 'phone-xs': [320, 640] };
const only = process.env.ONLY ? process.env.ONLY.split(',') : Object.keys(SIZES);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('✘ ' + m); } else console.log('  ✔ ' + m); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch();
  for (const key of only) {
    const [w, h] = SIZES[key];
    console.log(`[${key}]`);
    const mk = async (name) => { const ctx = await b.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); p.name = name; return p; };
    const host = await mk('host'), guest = await mk('guest'), spec = await mk('spec');
    const shot = async (p, n) => { await sleep(500); await p.screenshot({ path: `${OUT}/online-${n}-${key}.png` }); };
    const goLobby = async (p) => { await p.goto(BASE); await p.waitForTimeout(600); await p.evaluate(() => window.__app.go('lobby')); await p.waitForTimeout(900); };
    await goLobby(host);
    await host.getByRole('button', { name: '快速加入' }).click();
    await host.waitForSelector('.room-page', { timeout: 8000 }); ok(true, '房主快速加入後進入房間');
    const inviteLinks = await host.locator('.room-invite-url').allTextContents();
    ok(inviteLinks.length === 2 && inviteLinks.every(link => /^https?:\/\//.test(link.trim())), '房間直接顯示完整玩家與觀戰邀請連結');
    const difficultyLabelCount = await host.locator('.seat-ai .row-label').count();
    const difficultyValue = await host.locator('.seat.empty .sel-text').first().innerText();
    ok(difficultyLabelCount === 0 && difficultyValue.includes('普通'), '空位只顯示目前選擇，不重複顯示電腦難度標籤');
    const emptySeatHeight = await host.locator('.seat.empty').first().evaluate(el => el.getBoundingClientRect().height);
    ok(emptySeatHeight < 160, `空位卡片不再留下過多垂直空白（${Math.round(emptySeatHeight)}px）`);
    await host.getByRole('button', { name: '加入電腦' }).first().click();
    await host.getByRole('button', { name: '移除' }).first().waitFor();
    const aiSeat = host.locator('.seat:not(.empty)').filter({ has: host.locator('.seat-ai') }).first();
    const aiSeatText = await aiSeat.innerText();
    ok(aiSeatText.includes('電腦') && !aiSeatText.includes('空位') && await aiSeat.getByRole('button', { name: '加入電腦' }).count() === 0, '電腦入座後顯示電腦資訊，不再顯示空位或加入按鈕');
    ok(await aiSeat.getByRole('button', { name: '移除' }).count() === 1, '電腦入座後保留移除操作');
    await host.locator('.seat-ai .btn').first().scrollIntoViewIfNeeded();
    await shot(host, 'room-ai-removable');
    await host.getByRole('button', { name: '移除' }).first().click();
    await host.getByRole('button', { name: '加入電腦' }).first().waitFor();
    ok(true, '房主可移除電腦並恢復空位');
    await host.locator('.room-invite-url').last().scrollIntoViewIfNeeded();
    await shot(host, 'room-host');
    await goLobby(guest);
    await guest.getByRole('button', { name: '快速加入' }).click();
    await guest.waitForSelector('.room-page', { timeout: 8000 }); ok(true, '玩家快速加入同一房間');
    const guestName = await guest.evaluate(() => {
      const view = window.__app.app.online.view;
      return view.members.find(member => member.id === view.me.id)?.name || '';
    });
    const occupiedSeats = await host.locator('.seat:not(.empty)').allInnerTexts();
    const guestSeatText = occupiedSeats.find(text => text.includes(guestName)) || '';
    ok(!!guestSeatText && !guestSeatText.includes('空位'), '真人入座後該座位不顯示空位文字');
    const inv = await host.evaluate(() => { const v = window.__app.app.online.view; return { id: v.id, spec: v.invite.spectator }; });
    await spec.goto(`${BASE}?room=${inv.id}&t=${inv.spec}`); await spec.waitForTimeout(1200);
    await shot(spec, 'invite-spec');
    await spec.getByRole('button', { name: /確認並觀戰/ }).click();
    await spec.waitForSelector('.room-page', { timeout: 8000 }); ok(true, '觀戰邀請：確認暱稱後才進房');
    ok(await spec.evaluate(() => window.__app.app.online.view.me.role) === 'spectator', '觀戰者角色由 token 決定');
    await guest.evaluate(async () => { const n = await import('./js/net.js'); await n.emit('room:ready', { ready: true }); });
    await host.waitForFunction(() => window.__app.app.online.view.canStart.ok, null, { timeout: 8000 });
    await shot(host, 'room-full');
    await host.getByRole('button', { name: '開始對局' }).click();
    for (const p of [host, guest, spec]) await p.waitForSelector('.game', { timeout: 40000 });
    ok(true, '三個客戶端同時進入對局畫面');
    await sleep(2500);
    const taps = async (p) => { const can = await p.evaluate(() => { const d = window.__app.app.screen.debug; return d.S.canAct && !d.board.busy; }); return can; };
    // 先正常放兩層（看到同步），再故意放偏直到結束
    let turns = 0, shotGame = false;
    for (let i = 0; i < 320; i++) {
      for (const p of [host, guest]) {
        if (await p.$('.result')) continue;
        if (await taps(p)) {
          await sleep(500);
          const d = turns < 3 ? 0 : 4.4;
          await p.evaluate((d) => { window.__app.app.screen.debug.board.currentD = () => d; }, d);
          await p.keyboard.press('Space'); turns++;
        }
      }
      if (!shotGame && turns >= 3) { shotGame = true; await sleep(1800); await shot(host, 'game-host'); await shot(spec, 'game-spec'); }
      if ((await host.$('.result')) && (await guest.$('.result')) && (await spec.$('.result'))) break;
      await sleep(900);
    }
    ok(!!(await spec.$('.result')), '觀戰者同步看到結算 overlay');
    ok(!!(await host.$('.result')) && !!(await guest.$('.result')), '玩家看到結算 overlay');
    await shot(host, 'result-host'); await shot(spec, 'result-spec');
    ok(await spec.evaluate(() => [...document.querySelectorAll('.result .btn')].find((x) => x.textContent.includes('再來一局')).disabled), '觀戰者的「再來一局」不可用');
    await guest.locator('.result').getByRole('button', { name: /再來一局/ }).click();
    await host.locator('.result').getByRole('button', { name: '再來一局' }).click();
    await host.waitForFunction(() => window.__app.app.screen.debug && !window.__app.app.screen.debug.S.over, null, { timeout: 12000 });
    ok(true, '房主再來一局後重新開局');
    for (const p of [host, guest, spec]) if (p.errs.length) { bad++; console.log('✘ 頁面錯誤', p.name, p.errs.join(';')); }
    for (const p of [host, guest, spec]) await p.context().close();
  }
  await b.close();
  console.log(bad ? `\n線上畫面檢查：${bad} 個問題` : '\n線上畫面檢查：全部通過');
  process.exitCode = bad ? 1 : 0;
})();
