'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setTimeout: sleep } = require('node:timers/promises');
const { io } = require('socket.io-client');

async function exercise(base, restart) {
  const sockets = [];
  async function connect(url) {
    const ws = io(url, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 5000 });
    sockets.push(ws);
    const user = { call: (event, payload = {}) => ws.timeout(6500).emitWithAck(event, payload) };
    ws.on('room:state', view => { user.view = view; });
    ws.on('game:turn', turn => { user.turn = turn; });
    ws.on('game:drop', drop => { user.drop = drop; });
    await once(ws, 'connect');
    return user;
  }

  async function wait(get) {
    for (let i = 0; i < 200; i++) {
      const value = get();
      if (value) return value;
      await sleep(45);
    }
    assert.fail('等待疊疊高樓對局狀態逾時');
  }

  try {
    const [host, guest] = await Promise.all([connect(base), connect(base)]);
    const a = await host.call('room:create', { name: 'Recovery Host', maxPlayers: 2, turnLimit: 15 });
    assert.ok(a.ok);
    const roomId = a.view.id;
    const b = await guest.call('room:join', { name: 'Recovery Mate', roomId, token: a.view.invite.player });
    assert.ok(b.ok);
    assert.ok((await guest.call('room:ready', { ready: true })).ok);
    assert.ok((await host.call('room:start')).ok);
    const turn = await wait(() => host.turn);
    const active = turn.playerId === a.memberId ? host : guest;
    assert.ok((await active.call('game:drop', { d: 0 })).ok);
    const drop = await wait(() => guest.drop);
    assert.ok(drop.gain > 0);
    const second = await wait(() => host.turn?.no === turn.no + 1 && host.turn);
    const restarted = await restart({ roomId });
    const first = await connect(restarted);
    const bad = await first.call('room:resume', { roomId, memberId: a.memberId, key: b.key });
    assert.equal(bad.ok, false);
    const firstRoom = await first.call('room:resume', { roomId, memberId: a.memberId, key: a.key });
    assert.ok(firstRoom.ok);
    assert.equal(firstRoom.view.hostId, a.memberId);
    assert.equal(firstRoom.view.recovering, true);
    assert.equal(firstRoom.view.game.turnNo, drop.no);
    assert.deepEqual(firstRoom.view.game.floors, drop.remaining);
    assert.equal(firstRoom.view.game.players.find(p => p.id === drop.playerId).score, drop.gain);
    assert.equal(firstRoom.view.turn, null);
    assert.equal((await first.call('game:drop', { d: 0 })).code, 'recovering');
    const mate = await connect(restarted);
    const reentered = await mate.call('room:resume', { roomId, memberId: b.memberId, key: b.key });
    assert.ok(reentered.ok);
    assert.equal(reentered.memberId, b.memberId);
    const turnAfter = await wait(() => first.turn && first.turn.no === second.no && first.turn);
    assert.equal(turnAfter.playerId, second.playerId);
    assert.equal((await wait(() => first.view && !first.view.recovering && first.view)).id, roomId);
    assert.ok((await mate.call('room:leave')).ok);
    assert.ok((await first.call('room:leave')).ok);
    return { roomId, turn: second.no, floors: drop.remaining.length };
  } finally {
    for (const socket of sockets) socket.disconnect();
  }
}

function start(file) {
  const child = spawn(process.execPath, ['-e', `
    const { server } = require('./server.js');
    server.listen(0, '127.0.0.1', () => process.stdout.write('PORT=' + server.address().port + '\\n'));
  `], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, HOUSE_ROOM_DB_PATH: file },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const ready = new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', data => {
      output += data;
      const port = output.match(/PORT=(\d+)/)?.[1];
      if (port) resolve('http://127.0.0.1:' + port);
    });
    child.once('exit', code => reject(new Error('伺服器已停止：' + code)));
  });
  return { child, ready };
}

async function stop(child) {
  if (child.exitCode != null || child.signalCode != null) return;
  const done = once(child, 'exit');
  child.kill('SIGKILL');
  await done;
}

if (require.main === module) test('強制重啟保留原房、席位、已確認的樓層和輪次', { timeout: 28000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'house-restart-'));
  const file = path.join(dir, 'rooms.sqlite');
  let app = start(file);
  try {
    await exercise(await app.ready, async () => {
      await stop(app.child);
      app = start(file);
      return app.ready;
    });
  } finally {
    await stop(app.child);
    rmSync(dir, { recursive: true, force: true });
  }
});

module.exports = { exercise };
