'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const embedded = fs.existsSync(path.join(__dirname, '../lib/sio-compat.js'));
const { io: clientIo } = embedded ? require('../../../packages/web-core/sio-client.js') : require('socket.io-client');
const { server, io, rm } = require('../server.js');

async function until(fn) {
  for (let i = 0; i < 150; i++) {
    if (fn()) return;
    await wait(20);
  }
  assert.fail('等待生命週期更新逾時');
}

test('真實連線：重複進房、離場、觀戰通知與在線人數推送', { timeout: 10000 }, async () => {
  const clients = [];
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const emit = (s, event, data = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(event + ' 沒有回應')), 2000);
    s.emit(event, data, (r) => { clearTimeout(timer); resolve(r); });
  });
  const connect = () => new Promise((resolve, reject) => {
    const s = clientIo(url, { transports: ['websocket'], reconnection: false });
    clients.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
  try {
    const lobby = await connect();
    const counts = [];
    lobby.on('lobby:online', (n) => counts.push(n));
    assert.equal((await emit(lobby, 'lobby:watch')).online, 1);
    await until(() => counts.at(-1) === 1);
    const host = await connect(); // 不訂閱大廳也必須推送人數
    await until(() => counts.at(-1) === 2);
    const created = await emit(host, 'room:create');
    assert.equal(created.ok, true);
    for (const event of ['room:create', 'room:quick', 'room:join']) {
      const r = await emit(host, event, { roomId: created.view.id });
      assert.equal(r.ok, false, event);
      assert.equal(rm.rooms.size, 1);
      assert.equal(rm.locate(host.id).member.id, created.memberId);
    }
    const watcher = await connect();
    await until(() => counts.at(-1) === 3);
    await emit(watcher, 'room:join', { roomId: created.view.id, role: 'spectator' });
    let closed = false;
    watcher.on('room:closed', () => { closed = true; });
    await emit(host, 'room:ai:add');
    await emit(host, 'room:leave');
    await until(() => closed);
    assert.equal(rm.rooms.size, 0);
    assert.equal(rm.bySid.size, 0);
    assert.equal((await emit(watcher, 'room:resume', {
      roomId: created.view.id, memberId: created.memberId, key: created.key,
    })).ok, false);
    watcher.disconnect(); host.disconnect();
    await until(() => counts.at(-1) === 1);
    lobby.disconnect();
    await until(() => io.engine.clientsCount === 0);
  } finally {
    for (const s of clients) s.disconnect();
    await until(() => io.engine.clientsCount === 0);
    for (const room of [...rm.rooms.values()]) rm.closeRoom(room);
    io.close();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
});
