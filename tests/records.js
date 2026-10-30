/* 累計統計與成就：npm test */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  fs.copyFileSync(path.join(__dirname, '../public/js/records.js'), path.join(tmp, 'records.mjs'));
  const R = await import(pathToFileURL(path.join(tmp, 'records.mjs')).href);
  fs.rmSync(tmp, { recursive: true, force: true });
  const me = { placed: 12, perfects: 4, topples: 1 };

  let r = R.recordGame({ best: {}, played: 0, stats: {}, ach: {} }, { mode: 'solo', peak: 12, bestCombo: 3, me }, 100);
  assert.deepStrictEqual(r.unlocked.sort(), ['f10', 'first']);
  assert.strictEqual(r.stats.floors, 12); assert.strictEqual(r.stats.maxPeak, 12);

  const d2 = { best: {}, played: 1, stats: r.stats, ach: r.ach };
  r = R.recordGame(d2, { mode: 'solo', peak: 12, bestCombo: 3, me }, 200);
  assert.deepStrictEqual(r.unlocked, [], '已解鎖的成就不重複通知');
  assert.strictEqual(r.ach.first, 100, '保留首次解鎖時間');

  r = R.recordGame({ best: {}, played: 0, stats: {}, ach: {} }, { mode: 'ai', peak: 99, win: true, me }, 1);
  assert.ok(r.unlocked.includes('vsWin') && !r.unlocked.includes('f10'), '對戰層數不計入單人成就');
  assert.strictEqual(r.stats.vsWins, 1); assert.strictEqual(r.stats.games, 1);

  r = R.recordGame({ best: {}, played: 0, stats: {}, ach: {} }, { mode: 'online', win: false, me }, 1);
  assert.ok(!r.unlocked.includes('onlineWin')); assert.strictEqual(r.stats.onlineGames, 1);

  const old = R.normalize({ best: { normal: 35, 'hard:fixed': 20 }, played: 7 });
  assert.strictEqual(old.maxPeak, 35); assert.strictEqual(old.games, 7, '舊紀錄併入統計');
  console.log('  ✔ records');
})().catch((e) => { console.error(e); process.exit(1); });
