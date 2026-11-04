'use strict';
const assert = require('node:assert/strict');
const { server, io } = require('../server.js');
const { launch } = require('../scripts/browser.js');

(async () => {
  let browser;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    browser = await launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const switchLanguage = async lang => {
      await page.click('.lang-btn');
      await page.click(`.lang-opt[lang="${lang}"]`);
      await page.waitForFunction(lang => document.documentElement.lang === lang && window.__app, lang);
      assert.equal(await page.evaluate(() => window.__languageDocument), 'original', '切換語言不可重新載入網頁');
    };
    await page.goto(`http://127.0.0.1:${server.address().port}/?lang=zh-Hant`);
    await page.evaluate(() => { window.__languageDocument = 'original'; });
    await page.evaluate(() => window.__app.go('setup', { mode: 'vs' }));
    await page.locator('.tf-input').fill('RouteTester');
    for (const [select, option] of [[0, 3], [1, 1], [2, 2]]) {
      await page.locator('.sel-btn').nth(select).click();
      await page.locator('[role="option"]').nth(option).click();
    }
    await switchLanguage('en');
    assert.equal(await page.evaluate(() => window.__app.app.screen.name), 'setup', '切換語言應保留開局設定畫面');
    assert.equal(await page.locator('.tf-input').inputValue(), 'RouteTester');
    assert.match(await page.locator('h1').innerText(), /Computer/);
    assert.equal(await page.locator('.sel-text').nth(0).innerText(), 'Hard');
    assert.equal(await page.locator('.sel-text').nth(1).innerText(), 'One random shape');
    assert.match(await page.locator('.sel-text').nth(2).innerText(), /15/);
    await switchLanguage('zh-Hans');
    await switchLanguage('zh-Hant');
    assert.equal(await page.evaluate(() => window.__app.app.screen.name), 'setup');
    assert.equal(await page.locator('.sel-text').nth(0).innerText(), '困難');
    assert.equal(await page.evaluate(() => history.state.languageScreen), undefined);
    for (const screen of ['tutorial', 'records', 'lobby', 'home']) {
      await page.evaluate(screen => window.__app.go(screen), screen);
      if (screen === 'records') await page.locator('.rec-tab').nth(1).click();
      if (screen === 'tutorial') await page.locator('.page-scroll > .sa-view').evaluate(el => { el.scrollTop = 300; });
      await switchLanguage('en');
      assert.equal(await page.evaluate(() => window.__app.app.screen.name), screen);
      if (screen === 'records') assert.equal(await page.locator('.rec-tab.on').getAttribute('data-tab'), 'ach');
      if (screen === 'tutorial') await page.waitForFunction(() => document.querySelector('.page-scroll > .sa-view').scrollTop > 0);
      await switchLanguage('zh-Hant');
    }
    await page.evaluate(() => window.__app.go('tutorial'));
    await page.click('.gear-btn');
    await page.evaluate(() => window.I18N.setLang('en'));
    await page.waitForSelector('.modal');
    assert.equal(await page.evaluate(() => window.__app.app.screen.name), 'tutorial');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__app.go('lobby'));
    await page.click('.lobby-actions .autofocus');
    await page.waitForSelector('.room-page');
    await page.evaluate(() => { window.__roomBeforeLanguage = window.__app.app.online; });
    await page.locator('.room-chat .tf-input').fill('Keep this message');
    await switchLanguage('zh-Hant');
    assert.equal(await page.evaluate(() => window.__app.app.screen.name), 'room');
    assert.ok(await page.evaluate(() => window.__app.app.online === window.__roomBeforeLanguage), '切換語言保持原房間與連線身分');
    assert.equal(await page.locator('.room-chat .tf-input').inputValue(), 'Keep this message');
    await page.click('.room-page [data-back]');
    await page.evaluate(() => {
      window.__app.go('game', { kind: 'local', mode: 'solo', diff: 'normal', lives: 1, players: [{ id: 'me', name: 'RouteTester', kind: 'human' }], setupMode: 'solo' });
      const { g, board, S } = window.__app.app.screen.debug;
      S.paused = true;
      window.__gameBeforeLanguage = g;
      window.__boardBeforeLanguage = board;
    });
    await page.waitForTimeout(700);
    await page.click('.lang-btn');
    await page.click('.lang-opt[lang="zh-Hant"]');
    assert.equal(await page.evaluate(() => window.__app.app.screen.name), 'game');
    assert.ok(await page.evaluate(() => {
      const { g, board } = window.__app.app.screen.debug;
      return g === window.__gameBeforeLanguage && board === window.__boardBeforeLanguage && g.turnNo === 0;
    }), '對局切換語言保持原本遊戲與場景');
    assert.equal(await page.locator('.drop-btn .btn-label').innerText(), '放下');
    await page.click('.lang-btn');
    await page.click('.lang-opt[lang="en"]');
    assert.equal(await page.locator('.drop-btn .btn-label').innerText(), 'Drop');
    assert.equal(await page.locator('.drop-btn').getAttribute('aria-label'), 'Drop');
    await page.evaluate(() => {
      const { board, S } = window.__app.app.screen.debug;
      S.paused = false;
      board.currentD = () => 4.4;
    });
    await page.click('.drop-btn');
    await page.waitForSelector('.result');
    const resultsBefore = await page.evaluate(() => JSON.stringify(window.__app.store.get()));
    await page.evaluate(() => window.I18N.setLang('zh-Hant'));
    assert.equal(await page.locator('.result h2').innerText(), '挑戰結束');
    await page.evaluate(() => window.I18N.setLang('en'));
    assert.equal(await page.evaluate(() => JSON.stringify(window.__app.store.get())), resultsBefore, '翻譯結算不重複計入紀錄或成就');
    assert.deepEqual(errors, []);
    console.log('PASS language routes, setup choices, records tab, settings dialog, repeated switches and live game state');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => io.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
