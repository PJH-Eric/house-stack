'use strict';
const assert = require('node:assert/strict');
const { server, io } = require('../server.js');
const { launch } = require('../scripts/browser.js');

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.__app);
    await page.evaluate(() => {
      window.__app.go('game', { kind: 'local', mode: 'solo', diff: 'normal', lives: 1,
        players: [{ id: 'me', name: '玩家', kind: 'human' }], setupMode: 'solo' });
    });
    const drop = async offset => {
      await page.waitForFunction(() => {
        const { S } = window.__app.app.screen.debug;
        return S.canAct && performance.now() - S.turnStartPerf >= 380;
      });
      await page.evaluate(offset => {
        const { board, g } = window.__app.app.screen.debug;
        board.currentD = () => offset - g.swingSpec.drift;
      }, offset);
      await page.keyboard.press('Space');
      await page.waitForFunction(() => !window.__app.app.screen.debug.board.busy);
    };
    const state = () => page.evaluate(() => {
      const { S, g } = window.__app.app.screen.debug;
      return { combo: S.combo, best: S.bestCombo, rulesBest: g.bestCombo };
    });
    for (let i = 0; i < 5; i++) await drop(0);
    assert.deepEqual(await state(), { combo: 5, best: 5, rulesBest: 5 });
    await drop(0.5);
    assert.deepEqual(await state(), { combo: 0, best: 5, rulesBest: 5 });
    await drop(0);
    await drop(4.4);
    await page.waitForSelector('.result');
    assert.match(await page.locator('.res-stats').innerText(), /×5/);
    if (process.env.COMBO_OUT) {
      const fs = require('node:fs');
      const path = require('node:path');
      fs.mkdirSync(process.env.COMBO_OUT, { recursive: true });
      for (const [width, height] of [[390, 844], [844, 390], [820, 1180], [1180, 820], [1440, 900]]) {
        await page.setViewportSize({ width, height });
        await page.screenshot({ path: path.join(process.env.COMBO_OUT, `combo-${width}x${height}.png`) });
      }
    }
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('house-stack:v1')));
    assert.equal(saved.stats.bestCombo, 5);
    assert.ok(saved.ach.combo5, '五連擊成就應解鎖');
    await page.locator('.res-actions .btn-primary').click();
    await page.waitForFunction(() => !document.querySelector('.result') && window.__app.app.screen.debug.S.canAct);
    assert.deepEqual(await state(), { combo: 0, best: 0, rulesBest: 0 });
    await page.reload();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('house-stack:v1')).stats.bestCombo), 5);
    console.log('PASS combo: perfect streak, interruption, collapse, result, saved records, achievement, replay reset');
  } finally {
    await browser.close();
    await new Promise(resolve => io.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
