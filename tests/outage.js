/* 伺服器暫停提示：新文案、三語系、30 秒門檻。 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');
const src = read('outage.js');
assert.ok(src.includes("t('目前伺服器過載休息中')") && src.includes("t('歡迎贊助升級')"), '使用新的過載提示文案');
assert.ok(!/額度|月 1 日|nextResetText/.test(src), '不再有額度重置說明');
assert.ok(src.includes('https://portaly.cc/pjh-eric/support'), '「贊助」連到贊助頁');
assert.ok(/WAIT_MS = 30000/.test(src), '等待 30 秒');
assert.ok(read('locales.js').includes('"目前伺服器過載休息中": "The server is overloaded and resting"'), '英文翻譯');
assert.ok(read('locales-hans.js').includes('"歡迎贊助升級": "欢迎赞助升级"'), '簡中翻譯');
console.log('✓ 伺服器暫停提示測試通過');
