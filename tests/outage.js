/* 伺服器暫停提示：重置日期文字（含 12 月跨年）。 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../public/js/outage.js'), 'utf8');
const m = src.match(/export function nextResetText[\s\S]*?\n}\n/);
assert.ok(m, '找不到 nextResetText');
const nextResetText = new Function('getLang', m[0].replace('export function', 'return function'))(() => 'zh-Hant');
assert.equal(nextResetText(new Date(2026, 9, 26), 'zh-Hant'), '11');
assert.equal(nextResetText(new Date(2026, 11, 31), 'zh-Hant'), '1', '12 月跨年');
assert.equal(nextResetText(new Date(2026, 0, 15), 'zh-Hans'), '2');
assert.equal(nextResetText(new Date(2026, 9, 26), 'en'), 'November 1');
assert.equal(nextResetText(new Date(2026, 11, 5), 'en'), 'January 1');
assert.ok(/WAIT_MS = 30000/.test(src), '等待 30 秒');
console.log('✓ 伺服器暫停提示日期測試通過');
