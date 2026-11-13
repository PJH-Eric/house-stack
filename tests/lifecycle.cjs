'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { RoomManager } = require('../lib/rooms.js');

test('重複建立不能遺留無法透過連線找到的房間', () => {
  const rm = new RoomManager();
  const first = rm.createRoom({ sid: 'host' });
  rm.createRoom({ sid: 'host' });
  rm.leave('host');
  assert.equal(rm.rooms.size, 0);
  assert.equal(first.room.closed, true);
});

test('重複加入同一房間不能關閉後又新增幽靈成員', () => {
  const rm = new RoomManager();
  const { room, member } = rm.createRoom({ sid: 'host' });
  rm.join({ sid: 'host', roomId: room.id });
  assert.equal(room.closed, false);
  assert.equal(rm.locate('host').member.id, member.id);
  assert.equal(room.members.size, 1);
  rm.leave('host');
});

test('續連不能覆蓋既有房間身分或搶走仍連線中的席位', () => {
  const rm = new RoomManager();
  const a = rm.createRoom({ sid: 'a' });
  const b = rm.createRoom({ sid: 'b' });
  const resume = (sid) => rm.resume({ sid, roomId: a.room.id, memberId: a.member.id, key: a.member.key });
  assert.equal(resume('b').ok, false);
  assert.equal(resume('other').ok, false);
  assert.equal(rm.locate('b').room, b.room);
  assert.equal(rm.locate('a').member, a.member);
  rm.leave('a'); rm.leave('b');
});

test('關閉房間釋放成員、對局、計時器與連線索引', () => {
  const rm = new RoomManager();
  const { room, member } = rm.createRoom({ sid: 'host' });
  rm.addAi(room, member.id, 'normal');
  rm.join({ sid: 'watcher', roomId: room.id, role: 'spectator' });
  rm.start(room, member.id);
  rm.timer(room, () => assert.fail('關閉後不應執行'), 1000);
  rm.leave('host');
  assert.equal(room.timers.size, 0);
  assert.equal(room.members.size, 0);
  assert.equal(room.game, null);
  assert.equal(room.turn, null);
  assert.equal(rm.bySid.size, 0);
  assert.equal(rm.rooms.size, 0);
});

test('反覆斷線重連以最近一次斷線計算寬限，逾時清除房間與邀請', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const events = [];
  const rm = new RoomManager({ onEvent: (_room, ev) => events.push(ev) });
  const { room, member } = rm.createRoom({ sid: 'first' });
  const invite = room.tokens.player;
  const resume = (sid) => rm.resume({ sid, roomId: room.id, memberId: member.id, key: member.key });
  rm.markDisconnected('first');
  assert.equal(rm.bySid.size, 0);
  assert.equal(room.timers.size, 1);
  t.mock.timers.tick(20000);
  assert.equal(resume('second').ok, true);
  assert.equal(room.timers.size, 0);
  rm.markDisconnected('second');
  t.mock.timers.tick(10000);
  assert.equal(room.closed, false, '第一次斷線的舊期限不得移除第二次斷線的席位');
  t.mock.timers.tick(19999);
  assert.equal(room.closed, false);
  t.mock.timers.tick(1);
  assert.equal(room.closed, true);
  assert.equal(events.filter((ev) => ev === 'closed').length, 1);
  assert.equal(rm.rooms.size, 0);
  assert.equal(rm.bySid.size, 0);
  assert.equal(room.timers.size, 0);
  assert.equal(rm.inviteInfo(room.id, invite).ok, false);
  assert.equal(resume('third').ok, false);
});

test('觀戰斷線立即清除，真人離場後不會由 AI 或觀戰保留房間', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const rm = new RoomManager();
  const { room, member } = rm.createRoom({ sid: 'host' });
  rm.addAi(room, member.id, 'hard');
  const watcher = rm.join({ sid: 'watcher', roomId: room.id, role: 'spectator' });
  rm.markDisconnected('watcher');
  assert.equal(room.members.has(watcher.member.id), false);
  assert.equal(room.timers.size, 0);
  rm.markDisconnected('host');
  t.mock.timers.tick(30000);
  assert.equal(room.closed, true);
  assert.equal(room.members.size, 0);
});
