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
  const mk = (o = {}) => T.createGame({ seed: 11, difficulty: 'normal', mode: 'solo', ...o });
  await test('決定性：同種子、同操作 → 完全相同結果', () => {
    const run = () => { const g = mk(); const out = []; for (const d of [0, 0.5, -1.2, 0.1, 2.2, 0]) { const r = g.drop({ d }); out.push(r && [r.placed.x, r.placed.z, r.toppled, r.fallFrom]); } return JSON.stringify([out, g.publicState().floors]); };
    assert.strictEqual(run(), run());
  });
  await test('完美放置：偏移在容許內會吸附並累積連擊與加分', () => {
    const g = mk();
    const r1 = g.drop({ d: 0.1 }); assert.ok(r1.perfect && r1.placed.x === 0 && r1.placed.z === 0 && r1.combo === 1);
    const r2 = g.drop({ d: -0.1 }); assert.ok(r2.perfect && r2.combo === 2 && r2.gain > r1.gain, '連擊加分遞增');
    assert.strictEqual(g.height(), 3);
  });
  await test('吊車軸向：奇偶層交替 X / Z，偏移只影響該軸', () => {
    const g = mk();
    assert.strictEqual(g.swingSpec.axis, 'x');
    const a = g.drop({ d: 1.0 }); assert.ok(!a.toppled && a.placed.x === 1 && a.placed.z === 0);
    assert.strictEqual(g.swingSpec.axis, 'z');
    const b = g.drop({ d: -0.8 }); assert.ok(!b.toppled && b.placed.x === 1 && b.placed.z === -0.8);
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
  await test('登頂：達到最高層數結束（不無限進行）', () => {
    const g = mk({ lives: 3 });
    let r; let n = 0; while (!g.over && n++ < 200) r = g.drop({ d: 0 });
    assert.ok(g.over && g.summit && g.height() === T.SKY_FLOORS && r.summit);
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
    const ev = T.evaluate(st.floors.map((f) => ({ x: f[0], z: f[1] })), st.size, st.ground);
    assert.strictEqual(ev.fallFrom, -1);
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
