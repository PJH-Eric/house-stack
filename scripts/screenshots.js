/* 擷取實際遊戲畫面（多種尺寸／方向）到 screenshots/：BASE=http://localhost:3090/ node scripts/screenshots.js */
'use strict';
const { launch } = require('./browser.js');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3090/';
const OUT = process.env.OUT || 'screenshots';
const SIZES = { 'phone-portrait': [390, 844], 'phone-landscape': [844, 390], 'tablet-portrait': [820, 1180], 'tablet-landscape': [1180, 820], desktop: [1440, 900] };
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch();
  for (const [key, [w, h]] of Object.entries(SIZES)) {
    if (ONLY && !ONLY.includes(key)) continue;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: key !== 'desktop' });
    const p = await ctx.newPage();
    await p.goto(BASE); await p.waitForTimeout(900);
    const shot = async (name) => { await p.waitForTimeout(450); await p.screenshot({ path: `${OUT}/${name}-${key}.png` }); };
    await shot('home');
    await p.evaluate(() => window.__app.go('setup', { mode: 'vs' })); await shot('setup');
    await p.evaluate(() => window.__app.go('tutorial')); await shot('tutorial');
    await p.evaluate(() => { const st = JSON.parse(localStorage.getItem('house-stack:v1') || '{}'); st.best = { normal: 42, 'hard:fixed': 18 }; st.stats = { games: 9, floors: 240, perfects: 61, topples: 12, bestCombo: 6, vsGames: 3, vsWins: 2 }; st.ach = { first: 1, f10: 1, f30: 1 }; localStorage.setItem('house-stack:v1', JSON.stringify(st)); });
    await p.reload(); await p.waitForTimeout(600);
    await p.evaluate(() => window.__app.go('records')); await shot('records'); await p.click('.rec-tab:nth-child(2)'); await shot('achievements');
    await p.evaluate(() => window.__app.go('lobby')); await p.waitForTimeout(700); await shot('lobby');
    await p.evaluate(() => window.__app.go('home')); await p.click('.gear-btn'); await shot('settings'); await p.keyboard.press('Escape');
    await p.evaluate(() => window.__app.go('game', { kind: 'local', mode: 'solo', diff: 'normal', players: [{ id: 'me', name: '玩家', kind: 'human' }], lives: 0, setupMode: 'solo' }));
    await p.waitForTimeout(1000);
    const state = () => p.evaluate(() => { const d = window.__app.app.screen.debug; return { can: d.S.canAct, busy: d.board.busy }; });
    const place = async (d) => { for (let i = 0; i < 80; i++) { const s = await state(); if (s.can && !s.busy) break; await p.waitForTimeout(150); } await p.waitForTimeout(450); await p.evaluate((d) => { window.__app.app.screen.debug.board.currentD = () => d; }, d); await p.keyboard.press('Space'); };
    for (const d of [0, 0.1, 0.6, -0.5, 0.2, -0.6, 0.3, 0.1, -0.3]) await place(d);
    for (let i = 0; i < 80; i++) { const s = await state(); if (s.can && !s.busy) break; await p.waitForTimeout(150); }
    await p.waitForTimeout(800);
    await shot('game');
    await p.evaluate(() => { window.__app.app.screen.debug.board.currentD = () => 4.4; });
    for (let k = 0; k < 5 && !(await p.$('.result')); k++) { for (let i = 0; i < 80 && !(await p.$('.result')); i++) { const s = await state(); if (s.can && !s.busy) break; await p.waitForTimeout(150); } if (await p.$('.result')) break; await p.waitForTimeout(450); await p.keyboard.press('Space'); await p.waitForTimeout(2800); }
    for (let i = 0; i < 40 && !(await p.$('.result')); i++) await p.waitForTimeout(300);
    await shot('result');
    await ctx.close();
  }
  await b.close();
  console.log('已輸出到 ' + OUT + '/');
})();
