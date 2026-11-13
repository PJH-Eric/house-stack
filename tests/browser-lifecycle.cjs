'use strict';
// 先啟動開發伺服器；整合站以 BASE 指定 /g/house-stack/。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { launch } = require('../scripts/browser.js');
const BASE = process.env.BASE || 'http://localhost:3090/';
const OUT = 'screenshots/lifecycle';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  try {
    const context = await browser.newContext({ viewport: { width: 820, height: 1180 } });
    const page = await context.newPage();
    const connections = [];
    page.on('websocket', (ws) => connections.push(ws.url()));
    await page.goto(BASE);
    await page.waitForTimeout(400);
    assert.equal(connections.length, 0, '首頁不應連線');
    await page.evaluate(() => window.__app.go('lobby'));
    const count = (n) => page.waitForFunction((n) => {
      const el = document.querySelector('.lobby-online-count');
      return el && !el.hidden && Number(el.textContent.match(/\d+/)?.[0]) === n;
    }, n);
    await count(1);
    const url = new URL('js/net.js', BASE).href;
    const old = await page.evaluate(async (url) => {
      const s = (await import(url)).getSocket();
      const id = s.id;
      if (s._ws) s._ws.close();
      else s.io.engine.close();
      return id;
    }, url);
    await page.waitForFunction(async ({ url, old }) => {
      const net = await import(url);
      return net.net.connected && net.getSocket().id !== old;
    }, { url, old });
    await count(1);
    const peer = await context.newPage();
    await peer.goto(BASE);
    await peer.evaluate(() => window.__app.go('lobby'));
    await count(2);
    await peer.close();
    await count(1);
    console.log('PASS 實際斷線重連、在線人數 1 → 2 → 1');

    for (const [name, width, height] of [
      ['phone-p', 390, 844], ['phone-l', 844, 390],
      ['tablet-p', 820, 1180], ['tablet-l', 1180, 820], ['desktop', 1440, 900],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto(BASE + '?lang=en');
      await page.evaluate(() => window.__app.go('lobby'));
      await count(1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: `${OUT}/en-lobby-${name}.png` });
      await page.click('.lobby-actions .autofocus');
      await page.waitForSelector('.room-page');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: `${OUT}/en-room-${name}.png` });
      await page.click('.room-page [data-back]');
      await page.waitForSelector('.lobby-actions');
    }
    await page.evaluate(() => window.__app.go('home'));
    assert.equal(await page.evaluate(async (url) => (await import(url)).net.connected, url), false);
    await context.close();
    console.log('PASS 英文大廳／房間五種尺寸、離房與退出線上模式');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
