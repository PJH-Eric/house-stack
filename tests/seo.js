/* SEO 與 GA4 注入測試：設定格式、標題／說明與多語系字典一致、注入可重複執行、只寫進輸出目錄。 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { inject, validate, DEFAULT_GA_ID } = require('../scripts/inject-seo');
const root = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'seo.config.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
validate(cfg, DEFAULT_GA_ID);
assert.ok(source.includes('<!--SEO:HEAD-->'), 'index.html 需要 SEO 注入點');
assert.ok(source.includes('js/analytics.js'), 'index.html 需要載入 analytics.js');

// 繁中標題與說明（i18n.js 的 META_TITLE／META_DESC、index.html）必須與 SEO 設定一致
const i18n = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');
assert.ok(i18n.includes(JSON.stringify(cfg.title)), 'i18n.js META_TITLE 要等於 seo.config.json 的 title');
assert.ok(i18n.includes(JSON.stringify(cfg.description)), 'i18n.js META_DESC 要等於 seo.config.json 的 description');
assert.ok(source.includes('<title>' + cfg.title + '</title>'), 'index.html 的 title 要等於 SEO title');
assert.ok(source.includes('content="' + cfg.description + '"'), 'index.html 的 description 要等於 SEO description');
const locales = fs.readFileSync(path.join(root, 'public/js/locales.js'), 'utf8');
assert.ok(locales.includes(JSON.stringify(cfg.title) + ':') && locales.includes(JSON.stringify(cfg.description) + ':'), '英文 metadata 必須完整');
for (const f of ['favicon.svg', 'favicon-96.png', 'favicon.ico', 'apple-touch-icon.png', 'assets/images/cover.webp', 'robots.txt']) {
  assert.ok(fs.existsSync(path.join(root, 'public', f)), '缺少 public/' + f);
}
assert.ok(fs.readFileSync(path.join(root, 'public/robots.txt'), 'utf8').includes(cfg.siteUrl + 'sitemap.xml'));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'game-seo-'));
try {
  fs.mkdirSync(path.join(temp, 'public'));
  fs.writeFileSync(path.join(temp, 'seo.config.json'), JSON.stringify(cfg), 'utf8');
  fs.writeFileSync(path.join(temp, 'public/index.html'), source, 'utf8');
  const out = path.join(temp, 'dist');
  inject(temp, {}, out);
  assert.equal(fs.readFileSync(path.join(temp, 'public/index.html'), 'utf8'), source, '原始碼 index.html 不可被改動');
  const built = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.equal((built.match(/name="description"/g) || []).length, 1);
  assert.equal((built.match(/rel="canonical"/g) || []).length, 1);
  assert.ok(built.includes('href="' + cfg.siteUrl + '"'));
  assert.ok(built.includes('property="og:title"') && built.includes('name="twitter:card"'));
  assert.ok(built.includes('property="og:image" content="' + cfg.ogImage + '"'));
  const ld = JSON.parse(built.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld.url, cfg.siteUrl);
  assert.deepEqual(ld.inLanguage, ['zh-Hant', 'zh-Hans', 'en']);
  const sitemap = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
  assert.equal((sitemap.match(/<loc>/g) || []).length, 1);
  inject(temp, {}, out);
  assert.equal(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), built, '注入必須可重複執行');
  // 使用環境變數的 GA ID
  inject(temp, { GA_MEASUREMENT_ID: 'G-ABC123' }, out);
  assert.ok(fs.readFileSync(path.join(out, 'index.html'), 'utf8').includes('"measurement_id":"G-ABC123"'));
  // 啟動腳本在本機（localhost）不得初始化 GA
  const bootstrap = built.match(/<script>(window\.GAME_ANALYTICS_CONFIG[\s\S]*?)<\/script>/)[1];
  const local = { location: { hostname: 'localhost' } };
  local.window = local;
  vm.runInNewContext(bootstrap, local);
  assert.equal(local.GAME_ANALYTICS_CONFIG.manual_page_view, true);
  assert.equal(local.gtag, undefined, '本機不得初始化 GA');
  fs.writeFileSync(path.join(temp, 'public/index.html'), '<title>test</title>', 'utf8');
  assert.throws(() => inject(temp, {}, out), /SEO:HEAD/);
  assert.throws(() => validate({ ...cfg, siteUrl: cfg.siteUrl.slice(0, -1) }, 'G-TEST'), /siteUrl/);
  assert.throws(() => validate(cfg, 'bad'), /GA_MEASUREMENT_ID/);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('✓ SEO 注入、sitemap、本機隔離與多語系 metadata 測試通過');
