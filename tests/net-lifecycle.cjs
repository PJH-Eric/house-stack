'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function setup() {
  const handlers = new Map(), onceHandlers = new Map(), sent = [], storage = new Map();
  const socket = {
    connected: true,
    on: (event, fn) => handlers.set(event, fn),
    once: (event, fn) => onceHandlers.set(event, fn),
    off: (event, fn) => { if (onceHandlers.get(event) === fn) onceHandlers.delete(event); },
    emit: (event, data, ack) => sent.push({ event, data, ack }),
    disconnect: () => {},
  };
  const app = { online: null };
  const source = fs.readFileSync(path.join(__dirname, '../public/js/net.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const context = vm.createContext({
    app, CONFIG: { serverUrl: 'http://localhost' }, window: { io: () => socket },
    t: (s) => s, tm: (s) => s, setTimeout, clearTimeout,
    sessionStorage: { setItem: (k, v) => storage.set(k, v), getItem: (k) => storage.get(k), removeItem: (k) => storage.delete(k) },
  });
  vm.runInContext(source + '\nglobalThis.api = { getSocket, on, saveSession, disconnect, emit };', context);
  context.api.getSocket();
  handlers.get('connect')();
  return { app, handlers, onceHandlers, sent, socket, api: context.api };
}

test('大廳重連重新訂閱並更新房間列表與在線人數', () => {
  const { api, handlers, sent } = setup();
  const updates = [];
  api.on('lobby:list', (rooms) => updates.push(rooms));
  api.on('lobby:online', (n) => updates.push(n));
  handlers.get('disconnect')();
  handlers.get('connect')();
  assert.equal(sent[0].event, 'lobby:watch');
  sent[0].ack({ ok: true, rooms: [], online: 3 });
  assert.deepEqual(updates, [[], 3]);
});

test('續連回覆晚於離開房間時不會復活房間或操作已清除的身分', () => {
  const { app, api, handlers, sent } = setup();
  api.saveSession({ roomId: 'ABCD', memberId: 'm1', key: 'key' });
  app.online = { memberId: 'm1' };
  handlers.get('disconnect')();
  handlers.get('connect')();
  assert.equal(sent[0].event, 'room:resume');
  app.online = null;
  assert.doesNotThrow(() => sent[0].ack({ ok: true, memberId: 'm1', key: 'key', view: {} }));
  assert.equal(app.online, null);
});

test('已離開線上模式後丟棄舊連線的大廳回覆', () => {
  const { api, handlers, sent } = setup();
  api.on('lobby:online', () => assert.fail('離線後不應接受舊回覆'));
  handlers.get('disconnect')();
  handlers.get('connect')();
  api.disconnect();
  sent[0].ack({ ok: true, rooms: [], online: 3 });
});

test('冷啟動等待逾時後不再傳送建房請求，避免產生幽靈房間', async () => {
  const { api, socket, sent, onceHandlers } = setup();
  socket.connected = false;
  const r = await api.emit('room:create', {}, 5);
  assert.equal(r.code, 'timeout');
  assert.equal(onceHandlers.size, 0);
  assert.equal(sent.length, 0);
});

test('退出線上模式取消尚未送出的加入請求', async () => {
  const { api, socket, sent, onceHandlers } = setup();
  socket.connected = false;
  const result = api.emit('room:join', { roomId: 'ABCD' });
  api.disconnect();
  assert.equal((await result).code, 'offline');
  assert.equal(onceHandlers.size, 0);
  assert.equal(sent.length, 0);
});
