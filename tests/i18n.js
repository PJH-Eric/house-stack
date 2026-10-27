/* 多語系測試：字典完整性、變數一致、伺服器訊息、語言決定順序與 tm() 轉換。 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { clientKeys, serverKeys } = require('../scripts/i18n-keys');
const root = path.join(__dirname, '..');
const CJK = /[一-鿿]/;
const UNIT_KEYS = [' 層', ' 次', ' 顆'];
const vars = (s) => [...String(s).replace(/\{(\w+)\|[^|}]*\|[^|}]*\}/g, '{$1}').matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().filter((v, i, a) => a.indexOf(v) === i).join(',');

async function load(search, stored) {
  // 為每個情境產生獨立模組實例（i18n.js 在載入時決定語言）
  const store = stored ? { 'game-island-lang': stored } : {};
  const doc = { documentElement: { dataset: {}, lang: '' }, title: '', querySelector: () => null, dispatchEvent() {} };
  Object.assign(globalThis, {
    window: globalThis, document: doc, location: { search, href: 'https://x.test/' + search },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    history: { state: null, replaceState() {} }, CustomEvent: class { constructor(n, o) { this.type = n; this.detail = o && o.detail; } },
  });
  const url = pathToFileURL(path.join(root, 'public/js/i18n.js')).href + '?' + Math.random();
  const dir = path.join(root, 'public/js');
  // locales 與 i18n 同目錄，用相對 import；.js 預設當作 CommonJS，改以暫存 .mjs 副本載入
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'i18n-'));
  for (const f of ['i18n.js', 'locales.js', 'locales-hans.js']) fs.copyFileSync(path.join(dir, f), path.join(tmp, f.replace('.js', '.mjs')));
  for (const f of ['i18n.mjs']) fs.writeFileSync(path.join(tmp, f), fs.readFileSync(path.join(tmp, f), 'utf8').replace(/'\.\/(locales(?:-hans)?)\.js'/g, "'./$1.mjs'"));
  const mod = await import(pathToFileURL(path.join(tmp, 'i18n.mjs')).href + '?' + Math.random());
  const en = await import(pathToFileURL(path.join(tmp, 'locales.mjs')).href);
  const hans = await import(pathToFileURL(path.join(tmp, 'locales-hans.mjs')).href);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { ...mod, EN: en.EN, SERVER_KEYS: en.SERVER_KEYS, HANS: hans.HANS, store };
}

(async () => {
  const base = await load('', null);
  const { EN, HANS, SERVER_KEYS } = base;

  // 1. 所有 t('…') 繁中原文都有英文與簡體，且變數一致
  const keys = clientKeys(root);
  assert.ok(keys.length > 250, '應掃到大量字串，目前 ' + keys.length);
  const dynamic = ['幼幼班', '簡單', '普通', '困難', '神話']; // t(變數) 形式使用的難度名稱
  for (const k of [...keys, ...dynamic]) {
    assert.ok(Object.prototype.hasOwnProperty.call(EN, k), '缺英文：' + k);
    assert.ok(Object.prototype.hasOwnProperty.call(HANS, k), '缺簡體：' + k + '（跑 python3 scripts/gen-hans.py）');
    if (!k.includes('|')) assert.equal(vars(EN[k]), UNIT_KEYS.includes(k) ? 'n' : vars(k), '英文變數不一致：' + k); // 單位字串（' 層'）由程式傳入 {n} 供英文單複數使用
    assert.equal(vars(HANS[k]), vars(k), '簡體變數不一致：' + k);
    assert.ok(!CJK.test(EN[k]), '英文含中文：' + k + ' → ' + EN[k]);
    assert.ok(EN[k].trim() !== '', '英文空白：' + k);
  }
  console.log('  ✔ 字典完整：' + keys.length + ' 條 t() 字串都有 English 與简体中文，變數一致');

  // 2. 伺服器訊息：rooms.js／server.js 的玩家可見訊息都有英文
  const IGNORE = new Set(['玩家', '觀眾', '電腦{n}', '無法加入：', '{name} {v}', '離開了房間', '成為房主', '被請出房間', '對局進行中', '房間已結束',
    '[警告] production 未設定 GAME_ALLOWED_ORIGIN，將拒絕跨來源連線', 'AI 失敗', '[未預期的例外]', '[未處理的拒絕]', ' 處理失敗：',
    '疊疊高樓 伺服器啟動：http://localhost:{PORT}', '收到 {sig}，通知房間後結束']);
  for (const k of serverKeys(root)) {
    if (IGNORE.has(k)) continue;
    assert.ok(Object.prototype.hasOwnProperty.call(EN, k), '伺服器訊息缺英文：' + k);
  }
  for (const k of SERVER_KEYS) assert.ok(EN[k] && HANS[k], 'SERVER_KEYS 缺翻譯：' + k);
  console.log('  ✔ 伺服器訊息都有翻譯');

  // 3. 語言決定順序：?lang= > 儲存 > 繁中；繁中 t() 回傳原文
  assert.equal(base.getLang(), 'zh-Hant');
  assert.equal(base.t('開始'), '開始');
  assert.equal((await load('?lang=en', 'zh-Hans')).getLang(), 'en', 'URL 優先於儲存');
  assert.equal((await load('', 'zh-Hans')).getLang(), 'zh-Hans');
  assert.equal((await load('?lang=zh-CN', null)).getLang(), 'zh-Hans');
  assert.equal((await load('?lang=fr', null)).getLang(), 'zh-Hant', '不支援的語言退回繁中');

  // 4. t()：英文、變數、「|標記」、查不到時退回原文
  const en = await load('?lang=en', null);
  assert.equal(en.t('開始'), 'Start');
  assert.equal(en.t('最高蓋到 {peak} 層', { peak: 12 }), 'Best: 12 floors');
  assert.equal(en.t('最高蓋到 {peak} 層', { peak: 1 }), 'Best: 1 floor', '英文單數');
  assert.equal(en.t(' 次', { n: 1 }) + '|' + en.t(' 次', { n: 0 }), ' turn| turns', '單複數');
  assert.equal(en.tm('還有 1 位玩家未準備'), '1 player is not ready yet');
  assert.equal(en.t('疊'), 'Stack');
  assert.equal(en.t('疊|2'), 'the');
  assert.equal(en.t('沒有這個字串'), '沒有這個字串', '查不到不顯示 key 代碼');
  assert.equal(en.t('沒有|標記'), '沒有', '標記後綴在查不到時被移除');
  const hans = await load('?lang=zh-Hans', null);
  assert.equal(hans.t('疊'), '叠');
  assert.equal(hans.t('疊|2'), '叠');

  // 5. tm()：伺服器訊息（完全相符與含變數）
  assert.equal(en.tm('只有房主能開始'), 'Only the host can start');
  assert.equal(en.tm('Eric 離開了房間'), 'Eric left the room');
  assert.equal(en.tm('第 3 局開始'), 'Round 3 begins');
  assert.equal(en.tm('還有 2 位玩家未準備'), '2 players are not ready yet');
  assert.equal(en.tm('完全沒有翻譯的訊息'), '完全沒有翻譯的訊息');
  assert.equal(hans.tm('只有房主能開始'), '只有房主能开始');
  assert.equal(base.tm('只有房主能開始'), '只有房主能開始', '繁中原樣');
  assert.equal(en.tm(null), '');
  // 玩家暱稱不能被當成樣式：含正規表示式符號的名字
  assert.equal(en.tm('A.*(b) 離開了房間'), 'A.*(b) left the room');
  console.log('  ✔ 語言決定順序、t()、tm() 正確');

  // 6. setLang 會寫入儲存並觸發事件
  const sw = await load('', null);
  let heard = null; sw.onLangChange((l) => { heard = l; });
  sw.setLang('en');
  assert.equal(sw.getLang(), 'en'); assert.equal(heard, 'en'); assert.equal(sw.store['game-island-lang'], 'en');
  assert.equal(sw.withLang('https://pjh-eric.github.io/game-lobby/'), 'https://pjh-eric.github.io/game-lobby/?lang=en');
  console.log('i18n 測試通過');
})().catch((e) => { console.error(e); process.exit(1); });
