/* 規則／AI／房間 的單元與整合測試：npm run verify（會接著跑 scripts/online-check.js） */
'use strict';
const assert = require('assert');
const T = require('../public/js/rules.js');
const AI = require('../public/js/ai.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✔ ' + name); } catch (e) { console.error('  ✘ ' + name + '\n    ' + (e.stack || e)); process.exitCode = 1; }
}

(async () => {
  console.log('規則核心');
  const mk = (o = {}) => T.createGame({ seed: 11, difficulty: 'normal', mode: 'solo', wind: false, irregular: false, ...o });
  await test('決定性：同種子、同操作 → 完全相同結果', () => {
    const run = () => { const g = mk(); const out = []; for (const d of [0, 0.5, -1.2, 0.1, 2.2, 0]) { const r = g.drop({ d }); out.push(r && [r.placed.x, r.placed.z, r.toppled, r.fallFrom]); } return JSON.stringify([out, g.publicState().floors]); };
    assert.strictEqual(run(), run());
  });
  await test('完美放置：偏移在容許內只吸附一部分並累積連擊與加分', () => {
    const g = mk();
    const r1 = g.drop({ d: 0.1 }); assert.ok(r1.perfect && Math.abs(r1.placed.x - 0.1 * T.SNAP_KEEP.normal) < 1e-9 && r1.placed.z === 0 && r1.combo === 1);
    const r2 = g.drop({ d: -0.1 }); assert.ok(r2.perfect && r2.combo === 2 && r2.gain > r1.gain, '連擊加分遞增');
    assert.strictEqual(g.height(), 3);
  });
  await test('吊車軸向：永遠沿畫面左右（X），偏移相對於頂層', () => {
    const g = mk();
    assert.strictEqual(g.swingSpec.axis, 'x');
    const a = g.drop({ d: 1.0 }); assert.ok(!a.toppled && a.placed.x === 1 && a.placed.z === 0);
    assert.strictEqual(g.swingSpec.axis, 'x');
    const b = g.drop({ d: -0.8 }); assert.ok(!b.toppled && Math.abs(b.placed.x - 0.2) < 1e-9 && b.placed.z === 0);
  });
  await test('風：低樓層無風；風力隨高度增強、太空無風；落下途中會被吹走', () => {
    assert.strictEqual(T.windBase(2), 0); assert.ok(T.windBase(30) > 0.5 && T.windBase(60) === 1 && T.windBase(100) < 1 && T.windBase(140) === 0);
    const g = mk({ wind: true, difficulty: 'hard' });
    assert.strictEqual(g.swingSpec.wind, 0, '一開始無風');
    for (let i = 0; i < 60; i++) g.drop({ d: -g.swingSpec.drift });
    const sw = g.swingSpec; assert.ok(Math.abs(sw.drift) > 0, '蓋高後有風');
    assert.ok(Math.abs(sw.bias) <= T.WIND.hard.bias + 1e-9 && Math.abs(sw.drift) <= T.WIND.hard.drift + 1e-9);
    const r = g.drop({ d: 0 }); assert.ok(Math.abs(r.off - sw.drift) < 1e-9 || r.perfect, '放在 0 會被吹偏 drift');
    const g2 = mk({ wind: true }); for (let i = 0; i < 60; i++) g2.drop({ d: -g2.swingSpec.drift });
    const s2 = g2.swingSpec; const r2 = g2.drop({ d: -s2.drift }); assert.ok(r2.perfect, '預判風向放置可以完美');
    const spec = { amp: 4.4, omega: 1.5, phase: 0.3, bias: 1.2 };
    const t = T.timeToReach(spec, 2.0, 0.5); assert.ok(Math.abs(T.swingPos(spec, t) - 2.0) < 1e-6, '含偏移的吊車時間反解正確');
  });
  await test('風：同種子同操作結果完全相同（決定性）', () => {
    const run = () => { const g = mk({ wind: true, seed: 5 }); const o = []; for (let i = 0; i < 40; i++) { const r = g.drop({ d: 0.3 * Math.sin(i) }); o.push([r.placed.x, r.toppled]); } return JSON.stringify([o, g.swingSpec]); };
    assert.strictEqual(run(), run());
  });
  await test('重心判定：偏移過大，上方整段倒塌並扣命；地基保底', () => {
    const g = mk({ lives: 3 });
    const r = g.drop({ d: 3.9 }); // 邊長 4：只剩 0.1 重疊
    assert.ok(r.toppled && r.fallen.length === 1 && g.height() === 1);
    assert.strictEqual(g.currentPlayer().lives, 2);
    const g2 = mk({ lives: 5 });
    g2.drop({ d: 1.9 }); g2.drop({ d: 1.9 }); // 愈堆愈歪
    let fell = null;
    for (let i = 0; i < 6 && !fell; i++) { const r2 = g2.drop({ d: 1.9 }); if (r2.toppled) fell = r2; }
    assert.ok(fell && fell.fallFrom >= 0 && fell.fallen.length >= 1, '一路往同側偏最終會倒');
  });
  await test('重心判定：多層一起倒（最低違規接合面以上全倒）', () => {
    const g = mk({ lives: 9 });
    for (const d of [1.5, 1.5, 1.5, 1.5, 1.5]) { const r = g.drop({ d }); if (r.toppled) { assert.ok(r.fallen.length >= 2 || r.fallFrom === g.height(), '倒塌段落至少含新層'); return; } }
    assert.ok(false, '應該要倒');
  });
  await test('完全沒接到：新層單獨掉落，塔不受影響', () => {
    const g = mk({ lives: 3 });
    g.drop({ d: 0 }); g.drop({ d: 0 });
    const h = g.height();
    const r = g.drop({ d: 4.4 });
    assert.ok(r.toppled && r.fallen.length === 1 && g.height() === h);
  });
  await test('單人：命用完結束；分數保留', () => {
    const g = mk({ lives: 2 });
    g.drop({ d: 0 }); g.drop({ d: 0 });
    const sc = g.currentPlayer().score;
    g.drop({ d: 4.4 }); assert.ok(!g.over);
    const r = g.drop({ d: 4.4 }); assert.ok(r.over && r.eliminated && g.currentPlayer().score === sc);
    assert.strictEqual(g.drop({ d: 0 }), null, '結束後不可再放');
  });
  await test('輪流：回合順序、掉塊的人扣命→淘汰；剩一人勝', () => {
    const g = T.createGame({ seed: 3, difficulty: 'hard', mode: 'versus', players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] });
    assert.strictEqual(g.currentPlayer().id, 'a');
    assert.strictEqual(g.drop({ d: 0 }).nextPlayerId, 'b');
    assert.strictEqual(g.drop({ d: 0 }).nextPlayerId, 'c');
    g.drop({ d: 0 }); // c
    const ra = g.drop({ d: 4.4 }); assert.ok(ra.eliminated && ra.nextPlayerId === 'b', 'hard 多人 1 命：a 淘汰，換 b');
    const rb = g.drop({ d: 4.4 }); assert.ok(rb.eliminated && rb.over && rb.winnerId === 'c');
  });
  await test('離場：玩家離開被淘汰；輪到他時順延；剩一人時結束', () => {
    const g = T.createGame({ seed: 3, difficulty: 'normal', mode: 'versus', players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] });
    const e = g.removePlayer('a'); assert.ok(e.wasTurn && !e.over && g.currentPlayer().id === 'b');
    const e2 = g.removePlayer('c'); assert.ok(e2.over && g.winnerId === 'b');
  });
  await test('樓層上限：預設無上限；指定 maxFloors 時達到即登頂結束', () => {
    const g0 = mk({ lives: 3 }); for (let i = 0; i < 150; i++) g0.drop({ d: 0 });
    assert.ok(!g0.over && g0.height() === 151, '預設可蓋到 150+ 層');
    const g = mk({ lives: 3, maxFloors: 60 });
    let r; let n = 0; while (!g.over && n++ < 200) r = g.drop({ d: 0 });
    assert.ok(g.over && g.summit && g.height() === 60 && r.summit);
  });
  await test('穩定度：完美堆疊為 1，歪掉後降低；吊車時間反解正確', () => {
    const g = mk(); g.drop({ d: 0 }); assert.strictEqual(g.stability().stability, 1);
    g.drop({ d: 1.4 }); assert.ok(g.stability().stability < 1);
    const sw = { axis: 'x', amp: 4.4, omega: 1.5, phase: 0.7 };
    for (const d of [-3, -1, 0, 2.2, 4]) { const t = T.timeToReach(sw, d, 0.9); assert.ok(t >= 0.9 - 1e-6 && Math.abs(T.swingPos(sw, t) - d) < 1e-6, 'd=' + d); }
  });
  await test('probe 不修改狀態且與 drop 結論一致', () => {
    const g = mk({ lives: 5 });
    for (const d of [0.2, 1.1, 3.0, 4.2, -2.5]) {
      const h = g.height(), pr = g.probe(d); assert.strictEqual(g.height(), h);
      const r = g.drop({ d }); assert.strictEqual(pr.topple, r.toppled, 'd=' + d);
    }
  });
  await test('快照：publicState 可重建同樣的塔', () => {
    const g = mk(); g.drop({ d: 0 }); g.drop({ d: 0.9 });
    const st = g.publicState(); assert.strictEqual(st.floors.length, g.height());
    const ev = T.evaluate(st.floors.map((f) => ({ x: f[0], z: f[1], w: f[6], h: f[7] })), st.size, st.ground);
    assert.strictEqual(ev.fallFrom, -1);
  });

  await test('開局選項防呆：命數負數／NaN／過大、未知難度與形狀、亂填的放下位置都不會壞', () => {
    assert.strictEqual(T.createGame({ lives: -3 }).players[0].lives, 3);
    assert.strictEqual(T.createGame({ lives: NaN }).players[0].lives, 3);
    assert.strictEqual(T.createGame({ lives: 1e9 }).players[0].lives, 99);
    const g = T.createGame({ difficulty: 'zzz', mode: 'zzz', shapes: 'zzz', lives: 50 });
    assert.deepStrictEqual([g.difficulty, g.mode, g.publicState().shapes], ['normal', 'solo', 'off']);
    for (const d of [NaN, undefined, 'x', Infinity, null, {}, []]) { const r = g.drop({ d }); assert.ok(r && Number.isFinite(r.off)); }
    g.drop(); g.drop(null);
  });
  await test('樓層形狀：off 全標準；fixed 開局隨機一種、整場相同；every 每層不同；決定性', () => {
    for (let n = 0; n < 30; n++) assert.deepStrictEqual(T.shapeFor(9, 'normal', n, 'off'), { w: 1, h: 1 });
    const f = T.shapeFor(9, 'normal', 1, 'fixed'); assert.ok(f.w !== 1 || f.h !== 1);
    for (let n = 2; n < 100; n++) assert.deepStrictEqual(T.shapeFor(9, 'normal', n, 'fixed'), f);
    assert.notDeepStrictEqual(T.shapeFor(10, 'normal', 1, 'fixed'), f, '不同種子形狀不同');
    assert.deepStrictEqual(T.shapeFor(9, 'normal', 0, 'every'), { w: 1, h: 1 });
    const set = new Set(); for (let n = 1; n < 100; n++) { const a = T.shapeFor(9, 'hard', n, 'every'); assert.deepStrictEqual(a, T.shapeFor(9, 'hard', n, 'every')); assert.ok(a.w >= 0.55 && a.w <= 1.5 && a.h >= 0.7 && a.h <= 1.4); set.add(a.w + ',' + a.h); }
    assert.ok(set.size > 90, '每層外形都不同');
    const gf = T.createGame({ seed: 3, difficulty: 'normal', shapes: 'fixed' });
    for (let i = 0; i < 20; i++) gf.drop({ d: 0 });
    const ws = new Set(gf.floors.slice(1).map((x) => x.w + ',' + x.h)); assert.strictEqual(ws.size, 1);
    const ge = T.createGame({ seed: 3, difficulty: 'normal', shapes: 'every' });
    for (let i = 0; i < 20; i++) ge.drop({ d: 0 });
    assert.ok(new Set(ge.floors.slice(1).map((x) => x.w + ',' + x.h)).size > 10);
    assert.strictEqual(ge.publicState().floors[5].length, 8); assert.strictEqual(ge.publicState().shapes, 'every');
    const off = T.createGame({ seed: 3, difficulty: 'normal' });
    for (let i = 0; i < 20; i++) off.drop({ d: 0 });
    assert.ok(off.floors.every((x) => x.w === 1 && x.h === 1));
  });
  await test('風：方向與風速每回合都不固定（有左有右、強弱不一）', () => {
    const g = T.createGame({ seed: 12, difficulty: 'normal', wind: true });
    const ws = [];
    for (let i = 0; i < 60; i++) { g.drop({ d: -g.swingSpec.drift }); if (i > 25) ws.push(g.swingSpec.wind); }
    assert.ok(ws.some((w) => w > 0) && ws.some((w) => w < 0), '左右都有');
    assert.ok(new Set(ws.map((w) => Math.abs(w))).size > 20, '風速各不同');
    let flips = 0; for (let i = 1; i < ws.length; i++) if (Math.sign(ws[i]) !== Math.sign(ws[i - 1])) flips++;
    assert.ok(flips >= 5, '方向常變');
  });
  await test('重心判定（不規則）：窄樓層接合面較小，較寬的頂層較容易站穩；沒重疊就沒接到', () => {
    const E = (arr) => T.evaluate(arr, 4, 7);
    const base = [{ x: 0, z: 0 }, { x: 0, z: 0, w: 0.6 }]; // 窄層坐在標準層上，置中穩定
    assert.strictEqual(E(base.concat([{ x: 0, z: 0 }])).fallFrom, -1);
    // 支撐的樓層越窄，同樣偏移的上層越不穩
    const wide = E([{ x: 0, z: 0 }, { x: 0, z: 0, w: 1.4 }, { x: 1, z: 0 }]), narrow = E([{ x: 0, z: 0 }, { x: 0, z: 0, w: 0.6 }, { x: 1, z: 0 }]);
    assert.ok(narrow.maxRatio > wide.maxRatio, '窄的支撐更不穩');
    assert.strictEqual(E([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 3.2, z: 0, w: 0.5 }]).missed, true, '沒重疊 = 沒接到');
    // 質量：厚（h 大）的上層把重心拉向自己
    const heavy = E([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 1.7, z: 0, h: 1.4 }]).ratios[2], light = E([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 1.7, z: 0, h: 0.7 }]).ratios[2];
    assert.ok(Math.abs(heavy - light) < 1e-9, '單層頂端的重心比例與質量無關');
  });
  await test('太空無重力：140 層以上無風、有磁吸；磁吸讓偏移縮小並更容易完美', () => {
    const g = T.createGame({ seed: 4, difficulty: 'normal', irregular: false, wind: true, spaceFloors: 8 });
    assert.strictEqual(g.swingSpec.space, false); assert.strictEqual(g.swingSpec.mag, 0);
    for (let i = 0; i < 7; i++) g.drop({ d: 0 });
    const sw = g.swingSpec; assert.strictEqual(sw.space, true); assert.strictEqual(sw.mag, T.MAG.normal);
    assert.strictEqual(sw.wind, 0, '太空無風');
    const r = g.drop({ d: 1.0 });
    assert.ok(Math.abs(r.off - 1.0 * (1 - T.MAG.normal)) < 1e-9, '偏移被吸向中心 20%');
    const g2 = T.createGame({ seed: 4, difficulty: 'normal', irregular: false, wind: false, spaceFloors: 8 });
    for (let i = 0; i < 7; i++) g2.drop({ d: 0 });
    assert.ok(g2.drop({ d: 0.3 }).perfect, '0.3 × 0.8 = 0.24 ≤ 容許 0.27 → 完美');
    assert.strictEqual(T.SPACE_FLOORS, 140);
  });
  await test('電腦在太空與不規則樓層下仍能正常蓋樓（困難：50 層內不會全倒）', () => {
    const g = T.createGame({ seed: 8, difficulty: 'normal', lives: 9, shapes: 'every', spaceFloors: 30 });
    const rng = T.mulberry32(5); let n = 0;
    while (!g.over && n < 60) { const m = AI.chooseMove(g, 'hard', rng, { tNow: 0 }); g.drop({ d: m.d }); n++; }
    assert.ok(g.peak >= 25, '最高 ' + g.peak);
  });

  console.log('電腦對手');
  await test('四段 AI 都能產生合法移動，且等吊車到位才放', () => {
    for (const lv of ['kids', 'easy', 'normal', 'hard']) {
      const g = T.createGame({ seed: 5, difficulty: 'normal', mode: 'versus', players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
      const m = AI.chooseMove(g, lv, T.mulberry32(1), { tNow: 0 });
      assert.ok(Number.isFinite(m.d) && Math.abs(m.d) <= g.D.amp && m.thinkMs >= 500, lv);
      const t = m.thinkMs / 1000; assert.ok(Math.abs(T.swingPos(g.swingSpec, t) - m.d) < 0.02 || m.thinkMs === 500, lv + ' 吊車位置');
    }
  });
  await test('難度有可觀察差異：單人 1 命存活層數 困難 > 簡單 > 幼幼班', () => {
    const survive = (level, seed) => {
      const g = T.createGame({ seed, difficulty: 'normal', mode: 'solo', lives: 1 });
      const rng = T.mulberry32(seed * 7 + 1); let n = 0;
      while (!g.over && n < 100) { const m = AI.chooseMove(g, level, rng, { tNow: 0 }); g.drop({ d: m.d }); n++; }
      return n;
    };
    const avg = (lv) => { let s = 0; for (let k = 1; k <= 20; k++) s += survive(lv, k); return s / 20; };
    const kids = avg('kids'), easy = avg('easy'), normal = avg('normal'), hard = avg('hard');
    console.log(`    平均存活：幼幼班 ${kids}、簡單 ${easy}、普通 ${normal}、困難 ${hard}`);
    assert.ok(hard > normal && normal > easy && easy > kids, '難度單調遞增');
  });

  await test('神話難度：參數比困難更嚴苛（樓層更窄、吊車更快、容許值更小、風更強、1 顆愛心），可開單人／對戰', () => {
    const order = ['kids', 'easy', 'normal', 'hard', 'mythic'], D = T.DIFFICULTIES;
    for (let i = 1; i < order.length; i++) {
      const a = D[order[i - 1]], b = D[order[i]];
      assert.ok(b.size < a.size && b.speed > a.speed && b.tol < a.tol && b.maxSpeedMul > a.maxSpeedMul && b.turnSec < a.turnSec && b.lives <= a.lives && b.versusLives <= a.versusLives, order[i] + ' 比 ' + order[i - 1] + ' 更難');
      assert.ok(T.WIND[order[i]].bias > T.WIND[order[i - 1]].bias && T.WIND[order[i]].drift > T.WIND[order[i - 1]].drift, '風力遞增');
    }
    assert.strictEqual(D.mythic.label, '神話');
    assert.strictEqual(T.createGame({ difficulty: 'mythic', mode: 'solo' }).players[0].lives, 1);
    assert.strictEqual(T.createGame({ difficulty: 'mythic', mode: 'versus', players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }).players[0].lives, 1);
    assert.strictEqual(T.createGame({ difficulty: 'mythic', mode: 'versus' }).turnSec, 10, '對戰預設 10 秒');
    const g = T.createGame({ seed: 4, difficulty: 'mythic', mode: 'solo', lives: 3 }); for (let i = 0; i < 20 && !g.over; i++) g.drop({ d: 0 });
    assert.ok(g.floors.length > 1, '神話可正常放樓層');
  });

  console.log('房間生命週期');
  const { RoomManager } = require('../lib/rooms.js');
  await test('零實體玩家自動關閉（AI 與觀戰者不算）、邀請失效、不可復活', () => {
    const events = [];
    const rm = new RoomManager({ onEvent: (room, ev, data) => events.push([room.id, ev, data]) });
    const { room, member } = rm.createRoom({ sid: 's1', name: 'Eric' });
    rm.addAi(room, member.id, 'normal');
    const inv = rm.inviteInfo(room.id, room.tokens.player);
    assert.ok(inv.ok);
    const spec = rm.join({ sid: 's2', name: 'Watcher', roomId: room.id, token: room.tokens.spectator, role: 'player' });
    assert.ok(spec.ok && spec.member.role === 'spectator');
    rm.leave('s1');
    assert.ok(!rm.rooms.has(room.id), '房間應已關閉');
    assert.ok(events.some((e) => e[1] === 'closed'));
    assert.strictEqual(rm.inviteInfo(room.id, 'x').ok, false);
    const re = rm.join({ sid: 's3', name: 'Late', roomId: room.id, token: 'p_old', role: 'player' });
    assert.strictEqual(re.ok, false);
  });
  await test('房間：樓層形狀設定可建立／修改（亂填會被擋）並帶進對局；非房主不能改', () => {
    const rm = new RoomManager({ onEvent() {} });
    const { room, member } = rm.createRoom({ sid: 'h', name: 'Host', shapes: 'fixed' });
    assert.strictEqual(room.settings.shapes, 'fixed');
    assert.strictEqual(rm.createRoom({ sid: 'x', name: 'X', shapes: '<b>' }).room.settings.shapes, 'off');
    assert.ok(rm.setSettings(room, member.id, { shapes: 'every' })); assert.strictEqual(room.settings.shapes, 'every');
    rm.setSettings(room, member.id, { shapes: 'zzz' }); assert.strictEqual(room.settings.shapes, 'every', '非法值忽略');
    const j = rm.join({ sid: 'g', name: 'G', roomId: room.id, token: room.tokens.player, role: 'player' });
    assert.strictEqual(rm.setSettings(room, j.member.id, { shapes: 'off' }), false, '非房主不能改'); assert.strictEqual(room.settings.shapes, 'every');
    rm.setReady(room, j.member.id, true);
    const st = rm.start(room, member.id); assert.ok(st.ok, JSON.stringify(st));
    assert.strictEqual(room.game.publicState().shapes, 'every');
  });
  await test('每回合限時：只有 5/10/15、預設 10、亂填被擋；房間設定帶進對局', () => {
    assert.strictEqual(T.createGame({ mode: 'solo' }).turnSec, 10, '單人預設 10 秒');
    assert.strictEqual(T.createGame({ mode: 'versus', difficulty: 'hard' }).turnSec, 10, '對戰預設 10 秒');
    assert.strictEqual(T.createGame({ mode: 'solo', turnLimit: 10 }).turnSec, 10);
    assert.strictEqual(T.createGame({ mode: 'versus', turnLimit: 5 }).publicState().turnSec, 5);
    for (const bad of [-3, NaN, 7, 8, 20, 1e9, '<b>', null]) assert.strictEqual(T.createGame({ mode: 'solo', turnLimit: bad }).turnSec, 10, '非法值回到預設：' + bad);
    const rm = new RoomManager({ onEvent() {} });
    const { room, member } = rm.createRoom({ sid: 'h', name: 'Host', turnLimit: 10 });
    assert.strictEqual(room.settings.turnLimit, 10);
    assert.strictEqual(rm.createRoom({ sid: 'x', name: 'X', turnLimit: 99 }).room.settings.turnLimit, 10);
    assert.ok(rm.setSettings(room, member.id, { turnLimit: 15 })); assert.strictEqual(room.settings.turnLimit, 15);
    rm.setSettings(room, member.id, { turnLimit: 8 }); assert.strictEqual(room.settings.turnLimit, 15, '非法值忽略');
    const j = rm.join({ sid: 'g', name: 'G', roomId: room.id, token: room.tokens.player, role: 'player' });
    assert.strictEqual(rm.setSettings(room, j.member.id, { turnLimit: 5 }), false, '非房主不能改');
    rm.setReady(room, j.member.id, true);
    assert.ok(rm.start(room, member.id).ok); assert.strictEqual(room.game.turnSec, 15);
  });
  await test('邀請：token 決定角色；玩家席滿 → 轉觀戰；撤銷後無效', () => {
    const rm = new RoomManager({ onEvent() {} });
    const { room } = rm.createRoom({ sid: 'h', name: 'Host', maxPlayers: 2 });
    const j2 = rm.join({ sid: 'p2', name: 'P2<script>', roomId: room.id, token: room.tokens.player, role: 'player' });
    assert.ok(j2.ok && j2.member.role === 'player');
    assert.ok(!/[<>]/.test(j2.member.name), '暱稱應被消毒');
    const j3 = rm.join({ sid: 'p3', name: 'P3', roomId: room.id, token: room.tokens.player, role: 'player' });
    assert.ok(j3.ok && j3.member.role === 'spectator' && j3.converted);
    const bad = rm.join({ sid: 'x', name: 'X', roomId: room.id, token: 'nope', role: 'player' });
    assert.strictEqual(bad.ok, false);
    const old = room.tokens.player;
    rm.revokeInvite(room, room.hostId);
    const after = rm.join({ sid: 'y', name: 'Y', roomId: room.id, token: old, role: 'player' });
    assert.strictEqual(after.ok, false);
  });

  console.log(`\n通過 ${passed} 項` + (process.exitCode ? '，有失敗' : ''));
})();
