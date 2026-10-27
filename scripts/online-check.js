/* 線上整合檢查：啟動真實伺服器，用 socket.io-client 模擬房主、玩家、觀戰者完整走一遍。 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const { io } = require('socket.io-client');

const PORT = 3190 + Math.floor(Math.random() * 500);
const URL = `http://localhost:${PORT}`;
let passed = 0;
const step = (name) => { passed++; console.log('  ✔ ' + name); };
const emit = (s, ev, d) => new Promise((res) => s.emit(ev, d, res));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function client() {
  const s = io(URL, { transports: ['websocket'], reconnection: false });
  s.view = null; s.events = [];
  s.on('room:state', (v) => { s.view = v; });
  for (const ev of ['game:turn', 'game:drop', 'room:closed', 'game:start', 'room:chat', 'game:forfeit']) s.on(ev, (d) => s.events.push([ev, d]));
  return new Promise((res, rej) => { s.on('connect', () => res(s)); s.on('connect_error', rej); });
}
const until = async (fn, ms = 20000, label = '') => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(40); }
  throw new Error('逾時：' + label);
};

(async () => {
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  proc.stdout.on('data', () => {});
  try {
    console.log('線上整合檢查');
    await until(async () => true, 100);
    let health;
    for (let i = 0; i < 50; i++) { try { health = await (await fetch(URL + '/health')).json(); break; } catch { await wait(100); } }
    assert.ok(health && health.ok); step('/health 可用');

    { // 連線延遲量測：latency:ping 只回 ack
      const lc = await client();
      const t0 = Date.now(); const lr = await Promise.race([emit(lc, 'latency:ping', { at: t0 }), wait(1500).then(() => 'timeout')]);
      assert.notStrictEqual(lr, 'timeout', 'latency:ping 沒有回 ack'); lc.close();
      step('latency:ping 會回 ack（連線延遲徽章用）');
    }
    { // 惡意／錯誤的事件資料不能讓伺服器掛掉，也都要有回應
      const f = await client();
      const bads = [undefined, null, 5, 'x', [], {}, { name: {} }, { maxPlayers: 'NaN', difficulty: {}, shapes: [] }, { roomId: {}, token: [] }];
      for (const ev of ['room:create', 'room:join', 'room:quick', 'room:resume', 'invite:info', 'room:settings', 'room:ai:add', 'room:ready', 'room:kick', 'room:start', 'game:drop', 'chat:send', 'room:seat', 'room:watch', 'room:revoke', 'room:leave']) {
        for (const d of bads) { const r = await Promise.race([emit(f, ev, d), wait(1500).then(() => 'timeout')]); assert.notStrictEqual(r, 'timeout', ev + ' 沒有回應'); }
      }
      const h2 = await (await fetch(URL + '/health')).json(); assert.ok(h2.ok); f.close();
      step('亂填的事件資料不會讓伺服器當掉（皆有回應）');
    }
    { // 建房頻率限制：每個連線 10 秒最多 5 間
      const f = await client(); let okN = 0, lastCode = '';
      for (let i = 0; i < 7; i++) { const r = await emit(f, 'room:create', { name: 'Spam' }); if (r.ok) okN++; else lastCode = r.code; }
      assert.strictEqual(okN, 5); assert.strictEqual(lastCode, 'rate'); f.close();
      step('連續建房被限速（5 間後回 rate）');
    }

    const host = await client(), p2 = await client(), watcher = await client(), late = await client();
    const lw = await emit(late, 'lobby:watch', undefined);
    assert.ok(lw.ok && Array.isArray(lw.rooms)); step('大廳訂閱可取得房間列表');
    const created = await emit(host, 'room:create', { name: 'Eric<b>', maxPlayers: 3, difficulty: 'kids' });
    assert.ok(created.ok); assert.ok(!/[<>]/.test(created.view.members[0].name));
    const roomId = created.view.id; const inv = created.view.invite;
    assert.ok(inv && inv.player && inv.spectator); step('建立房間、暱稱被伺服器消毒');

    const info = await emit(watcher, 'invite:info', { roomId, token: inv.spectator });
    assert.ok(info.ok && info.role === 'spectator'); step('邀請資訊：token 決定角色');

    const j2 = await emit(p2, 'room:join', { roomId, token: inv.player, name: 'Guest', role: 'spectator' }); // 嘗試改角色
    assert.ok(j2.ok && j2.view.me.role === 'player', '玩家 token 不因宣稱角色而變'); step('玩家邀請加入且不能自改角色');
    const jw = await emit(watcher, 'room:join', { roomId, token: inv.spectator, name: '觀眾', role: 'player' });
    assert.ok(jw.ok && jw.view.me.role === 'spectator'); assert.ok(jw.view.invite === null, '觀戰者看不到邀請 token'); step('觀戰邀請加入且不能自升玩家');

    assert.strictEqual((await emit(host, 'room:ai:add', { level: 'hard' })).ok, true);
    const full = await emit(late, 'room:join', { roomId, token: inv.player, name: 'Late' });
    assert.ok(full.ok && full.view.me.role === 'spectator' && full.converted === 'full'); step('玩家席滿 → 轉為觀戰');

    const notReady = await emit(host, 'room:start', {});
    assert.strictEqual(notReady.ok, false); step('未全員準備不能開局');
    await emit(p2, 'room:ready', { ready: true });
    const st = await emit(host, 'room:start', {});
    assert.ok(st.ok); step('全員準備後開局');

    // 輪流：真人故意放偏讓樓倒（幼幼班 3 命，多回合後結束）
    let guard = 0;
    const seen = new Set();
    while (!(host.view && host.view.status === 'ended') && guard++ < 400) {
      for (const [c, id] of [[host, created.memberId], [p2, j2.memberId]]) {
        const last = c.events.filter((e) => e[0] === 'game:turn').pop();
        if (last && last[1].playerId === id && !seen.has(id + ':' + last[1].no)) {
          seen.add(id + ':' + last[1].no);
          assert.ok(last[1].swing && Number.isFinite(last[1].swing.omega) && last[1].now, '回合含吊車參數與伺服器時間');
          await emit(c, 'game:drop', { d: 4.4 }); // 故意放到完全沒接到
        }
      }
      await wait(60);
    }
    const drops = host.events.filter((e) => e[0] === 'game:drop').map((e) => e[1]);
    assert.ok(drops.length >= 3, '應有多次放置');
    assert.ok(drops.some((d) => d.playerId.startsWith('m') && d.toppled), '有人讓樓倒');
    const aiDrop = drops.find((d) => d.playerId !== created.memberId && d.playerId !== j2.memberId);
    assert.ok(aiDrop, 'AI 也有出手'); step(`輪流對局（含電腦）跑完，共 ${drops.length} 次放置`);
    await until(() => host.view.status === 'ended', 20000, '等待結束');
    const watchers = [watcher, late];
    for (const w of watchers) await until(() => w.events.some((e) => e[0] === 'game:drop'), 3000, '觀戰者收到 drop');
    step('觀戰者同步收到對局事件');

    // 非自己回合不能放
    const bad = await emit(p2, 'game:drop', { d: 0 });
    assert.strictEqual(bad.ok, false); step('對局結束後不能再放');

    // 聊天
    await emit(watcher, 'chat:send', { text: '加油<script>' });
    await until(() => host.events.some((e) => e[0] === 'room:chat' && e[1].text && !/[<>]/.test(e[1].text) && e[1].role === 'spectator'), 3000, '聊天');
    step('聊天室（觀戰者可發言、內容消毒）');

    // 再來一局
    await emit(p2, 'room:ready', { ready: true });
    const again = await emit(host, 'room:start', {});
    assert.ok(again.ok); assert.strictEqual(host.view.rounds >= 1, true); step('再來一局');

    // 重連：p2 斷線後以 key 回來
    const key = j2.key; p2.close();
    await wait(200);
    const p2b = await client();
    const rs = await emit(p2b, 'room:resume', { roomId, memberId: j2.memberId, key });
    assert.ok(rs.ok && rs.view.me.role === 'player'); step('斷線重連回到原席位');
    const wrong = await emit(await client(), 'room:resume', { roomId, memberId: j2.memberId, key: 'xxx' });
    assert.strictEqual(wrong.ok, false); step('錯誤 key 不能冒用席位');

    // 零實體玩家自動關閉：兩位真人都離開，只剩電腦與觀戰者
    await emit(host, 'room:leave', {});
    await emit(p2b, 'room:leave', {});
    await until(() => watcher.events.some((e) => e[0] === 'room:closed'), 3000, '房間關閉');
    step('實體玩家降為 0 → 房間立即關閉並通知觀戰者');
    const re = await emit(await client(), 'room:join', { roomId, token: inv.player, name: 'Zombie' });
    assert.strictEqual(re.ok, false); step('已關閉房間不可復活、邀請失效');
    const re2 = await emit(p2b, 'room:resume', { roomId, memberId: j2.memberId, key });
    assert.strictEqual(re2.ok, false); step('重新連線也無法復活已關閉房間');

    console.log(`\n線上檢查通過 ${passed} 項`);
  } catch (e) {
    console.error('✘ 線上檢查失敗：', e.stack || e);
    process.exitCode = 1;
  } finally {
    proc.kill();
    setTimeout(() => process.exit(process.exitCode || 0), 100);
  }
})();
