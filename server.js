'use strict';
/**
 * 疊疊高樓 後端：Express（靜態檔 + /health）+ Socket.IO（大廳、房間、對局、聊天）。
 * 環境變數：PORT（預設 3090）、GAME_ALLOWED_ORIGIN（逗號分隔；正式環境務必設定）。
 * 注意（Render 免費層）：服務可能休眠或重啟，房間只存在記憶體，視為可清理的暫時狀態。
 */
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const T = require('./public/js/rules.js');
const AI = require('./public/js/ai.js');
const { RoomManager } = require('./lib/rooms.js');

const PORT = Number(process.env.PORT) || 3090;
const allowed = (process.env.GAME_ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
const isProd = process.env.NODE_ENV === 'production';
if (isProd && !allowed.length) console.warn('[警告] production 未設定 GAME_ALLOWED_ORIGIN，將拒絕跨來源連線');

const app = express();
const server = http.createServer(app);
const originCheck = (origin, cb) => {
  if (!origin) return cb(null, true); // 同源或非瀏覽器
  if (allowed.includes(origin)) return cb(null, true);
  if (!isProd && !allowed.length) return cb(null, true);
  cb(null, false);
};
const io = new Server(server, { cors: { origin: originCheck, methods: ['GET', 'POST'] }, pingInterval: 10000, pingTimeout: 12000 });

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const o = req.headers.origin;
  if (o && (allowed.includes(o) || (!isProd && !allowed.length))) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
  }
  next();
});
app.get('/health', (req, res) => res.json({ ok: true, rooms: rm.rooms.size, uptime: Math.round(process.uptime()) }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], setHeaders: (res, file) => { if (file.includes(`${path.sep}vendor${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=604800'); } })); // 第三方函式庫快取 7 天，自己的程式每次驗證 ETag

// ---------------- 房間管理與推播 ----------------
let lobbyTimer = null;
function pushLobby() {
  if (lobbyTimer) return;
  lobbyTimer = setTimeout(() => { lobbyTimer = null; io.to('lobby').emit('lobby:list', rm.lobbyList()); }, 250);
}
function pushState(room) {
  for (const m of room.members.values()) if (m.sid) io.to(m.sid).emit('room:state', rm.view(room, m.id));
}

const rm = new RoomManager({
  onEvent(room, ev, data) {
    if (ev === 'state') { pushState(room); pushLobby(); }
    else if (ev === 'chat') io.to(room.id).emit('room:chat', data);
    else if (ev === 'closed') {
      io.to(room.id).emit('room:closed', data);
      io.in(room.id).socketsLeave(room.id);
      pushLobby();
    }
  },
});

// ---------------- 對局流程 ----------------
function clearTurnTimer(room) {
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.timers.delete(room.turnTimer); room.turnTimer = null; }
}

function beginTurn(room) {
  if (room.closed || room.status !== 'playing' || !room.game || room.game.over) return;
  clearTurnTimer(room);
  const g = room.game;
  const p = g.currentPlayer();
  const sec = g.turnSec || T.DIFFICULTIES[g.difficulty].turnSec;
  const no = g.turnNo + 1;
  const t0 = Date.now();
  const swing = g.swingSpec;
  room.turn = { playerId: p.id, no, t0, deadline: t0 + sec * 1000, last: null, swing };
  io.to(room.id).emit('game:turn', { playerId: p.id, no, t0, now: t0, deadline: room.turn.deadline, sec, swing, height: g.height(), stability: g.stability() });
  if (p.kind === 'ai') {
    const rng = T.mulberry32((g.seed ^ Math.imul(no, 2654435761)) >>> 0);
    let mv;
    try { mv = AI.chooseMove(g, p.ai || 'normal', rng, { tNow: 0 }); } catch (e) { console.error('AI 失敗', e); mv = { d: 0, thinkMs: 1200 }; }
    rm.timer(room, () => {
      if (room.game === g && g.currentPlayer().id === p.id && room.turn && room.turn.no === no) doDrop(room, p.id, { d: mv.d });
    }, mv.thinkMs);
  } else {
    // 逾時：依伺服器時鐘取吊車當下位置自動放下
    room.turnTimer = rm.timer(room, () => {
      const t = (Date.now() - t0) / 1000;
      doDrop(room, p.id, { d: T.swingPos(swing, t) });
    }, sec * 1000 + 300);
  }
  pushLobby();
}

function doDrop(room, playerId, move) {
  if (room.closed || room.status !== 'playing' || !room.game) return false;
  const g = room.game;
  if (g.over || g.currentPlayer().id !== playerId) return false;
  clearTurnTimer(room);
  const res = g.drop({ d: Number(move && move.d) || 0 });
  if (!res) return false;
  room.turn = null;
  if (res.over) room.status = 'ended';
  io.to(room.id).emit('game:drop', res);
  const wait = (res.toppled ? 2000 : 800);
  rm.timer(room, () => {
    if (res.over) { for (const m of room.members.values()) if (m.role === 'player' && m.id !== room.hostId) m.ready = false; pushState(room); pushLobby(); }
    else beginTurn(room);
  }, wait);
  return true;
}

function afterRemoved(room, out) {
  if (!out || out.closed || !room || room.closed) return;
  const ev = out.gameEv;
  if (!ev) return;
  if (ev.over) {
    io.to(room.id).emit('game:forfeit', { over: true, winnerId: room.game.winnerId, players: room.game.publicPlayers() });
    pushState(room);
  } else if (ev.wasTurn) {
    beginTurn(room);
  }
}

// ---------------- Socket 事件 ----------------
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

const MAX_ROOMS = +process.env.MAX_ROOMS || 300;
process.on('uncaughtException', (e) => console.error('[未預期的例外]', e && e.stack || e)); // 單一房間的計時器／AI 出錯不應讓整個服務停掉
process.on('unhandledRejection', (e) => console.error('[未處理的拒絕]', e && e.stack || e));

io.on('connection', (socket) => {
  const sid = socket.id;
  // 統一輸入防護：事件資料不是一般物件（null、字串、陣列…）就當成空物件；沒帶回呼就補空函式；處理中的例外只回報失敗，不讓整個伺服器掛掉
  const rawOn = socket.on.bind(socket);
  socket.on = (ev, fn) => (ev === 'disconnect' ? rawOn(ev, fn) : rawOn(ev, (...args) => {
    const cb = [...args].reverse().find((x) => typeof x === 'function');
    try {
      let d = args[0];
      if (typeof d !== 'function' && (d === null || typeof d !== 'object' || Array.isArray(d))) d = {};
      fn(d, cb || (() => {}), ...args.slice(2));
    } catch (e) {
      console.error('[socket] ' + ev + ' 處理失敗：' + (e && e.message));
      if (cb) { try { cb({ ok: false, code: 'server_error', msg: '伺服器處理失敗，請稍後再試' }); } catch (e2) { /* ignore */ } }
    }
  }));
  let chatBucket = { n: 0, t: Date.now() };
  let createBucket = { n: 0, t: Date.now() };
  const ok = (cb, data) => typeof cb === 'function' && cb({ ok: true, ...data });
  const fail = (cb, code, msg) => typeof cb === 'function' && cb({ ok: false, code, msg });

  socket.on('lobby:watch', (d, cb) => { socket.join('lobby'); ok(typeof d === 'function' ? d : cb, { rooms: rm.lobbyList() }); });
  socket.on('lobby:unwatch', () => socket.leave('lobby'));

  socket.on('invite:info', ({ roomId, token } = {}, cb) => {
    const r = rm.inviteInfo(roomId, token);
    typeof cb === 'function' && cb(r);
  });

  function enter(room, member, converted, cb) {
    socket.leave('lobby');
    socket.join(room.id);
    ok(cb, { memberId: member.id, key: member.key, converted, view: rm.view(room, member.id) });
    pushState(room);
  }

  // 連線延遲量測：只回 ack，不帶任何資料
  socket.on('latency:ping', (_d, cb) => { if (typeof cb === 'function') cb(); });

  socket.on('room:create', (d = {}, cb) => {
    const now = Date.now(); // 防濫用：每個連線 10 秒最多建 5 間，全服務最多 300 間
    createBucket = now - createBucket.t > 10000 ? { n: 0, t: now } : createBucket;
    if (++createBucket.n > 5) return fail(cb, 'rate', '建立房間太頻繁，請稍後再試');
    if (rm.rooms.size >= MAX_ROOMS) return fail(cb, 'full', '伺服器房間已滿，請稍後再試');
    const { room, member } = rm.createRoom({ sid, name: d.name, maxPlayers: num(d.maxPlayers, 4), difficulty: d.difficulty, shapes: d.shapes, turnLimit: num(d.turnLimit, T.DEFAULT_TURN_SEC) });
    enter(room, member, null, cb);
  });

  socket.on('room:join', (d = {}, cb) => {
    const r = rm.join({ sid, name: d.name, roomId: d.roomId, token: d.token, role: d.role });
    if (!r.ok) return fail(cb, r.code, '無法加入：' + r.code);
    enter(r.room, r.member, r.converted, cb);
  });

  socket.on('room:quick', (d = {}, cb) => {
    const open = rm.findOpenRoom();
    if (open) {
      const r = rm.join({ sid, name: d.name, roomId: open.id, role: 'player' });
      if (r.ok) return enter(r.room, r.member, r.converted, cb);
    }
    const { room, member } = rm.createRoom({ sid, name: d.name });
    enter(room, member, null, cb);
  });

  socket.on('room:resume', (d = {}, cb) => {
    const r = rm.resume({ sid, roomId: d.roomId, memberId: d.memberId, key: d.key });
    if (!r.ok) return fail(cb, r.code, '房間已不存在或已結束');
    enter(r.room, r.member, null, cb);
  });

  const withRoom = (fn) => (d, cb) => {
    const loc = rm.locate(sid);
    if (!loc) return fail(cb, 'no_room', '尚未加入房間');
    return fn(loc.room, loc.member, d || {}, cb);
  };

  socket.on('room:leave', withRoom((room, member, d, cb) => {
    socket.leave(room.id);
    const out = rm.leave(sid);
    afterRemoved(room, out);
    ok(cb, {});
  }));

  socket.on('room:settings', withRoom((room, member, d, cb) => (rm.setSettings(room, member.id, d) ? ok(cb, {}) : fail(cb, 'denied'))));
  socket.on('room:ai:add', withRoom((room, member, d, cb) => (rm.addAi(room, member.id, d.level) ? ok(cb, {}) : fail(cb, 'denied', '無法新增電腦'))));
  socket.on('room:ai:level', withRoom((room, member, d, cb) => (rm.setAiLevel(room, member.id, d.id, d.level) ? ok(cb, {}) : fail(cb, 'denied'))));
  socket.on('room:ai:remove', withRoom((room, member, d, cb) => (rm.removeAi(room, member.id, d.id) ? ok(cb, {}) : fail(cb, 'denied'))));
  socket.on('room:ready', withRoom((room, member, d, cb) => (rm.setReady(room, member.id, d.ready) ? ok(cb, {}) : fail(cb, 'denied'))));
  socket.on('room:seat', withRoom((room, member, d, cb) => (rm.takeSeat(room, member.id) ? ok(cb, {}) : fail(cb, 'denied', '目前不能入座'))));
  socket.on('room:watch', withRoom((room, member, d, cb) => (rm.watch(room, member.id) ? ok(cb, {}) : fail(cb, 'denied'))));
  socket.on('room:revoke', withRoom((room, member, d, cb) => (rm.revokeInvite(room, member.id) ? ok(cb, {}) : fail(cb, 'denied'))));

  socket.on('room:kick', withRoom((room, member, d, cb) => {
    const r = rm.kick(room, member.id, d.id);
    if (!r) return fail(cb, 'denied');
    if (r.sid) {
      io.to(r.sid).emit('room:kicked', {});
      const s = io.sockets.sockets.get(r.sid);
      if (s) s.leave(room.id);
    }
    afterRemoved(room, r.res);
    ok(cb, {});
  }));

  socket.on('room:start', withRoom((room, member, d, cb) => {
    const r = rm.start(room, member.id);
    if (!r.ok) return fail(cb, 'cannot_start', r.msg);
    ok(cb, {});
    io.to(room.id).emit('game:start', { rounds: room.rounds });
    rm.timer(room, () => beginTurn(room), 900);
  }));

  socket.on('game:drop', withRoom((room, member, d, cb) => {
    if (room.status !== 'playing' || !room.turn || room.turn.playerId !== member.id) return fail(cb, 'not_your_turn', '還沒輪到你');
    doDrop(room, member.id, d) ? ok(cb, {}) : fail(cb, 'bad_drop');
  }));

  socket.on('chat:send', withRoom((room, member, d, cb) => {
    const now = Date.now();
    if (now - chatBucket.t > 3000) chatBucket = { n: 0, t: now };
    if (++chatBucket.n > 5) return fail(cb, 'rate', '說話太快了');
    rm.chat(room, member.id, d.text);
    ok(cb, {});
  }));

  socket.on('disconnect', () => {
    const loc = rm.markDisconnected(sid);
    if (!loc) return;
    const { room, member } = loc;
    if (member.role === 'spectator') { afterRemoved(room, rm.removeMember(room, member.id, '離開了房間')); return; }
    // 玩家 30 秒內可重新連線（room:resume），逾時視為離場
    rm.timer(room, () => {
      const m = room.members.get(member.id);
      if (m && !m.connected) afterRemoved(room, rm.removeMember(room, member.id, '斷線超過 30 秒，已離場'));
    }, 30000);
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`疊疊高樓 伺服器啟動：http://localhost:${PORT}`));
}
// Render 更新或重啟時會送 SIGTERM：先告知所有房間（顯示「房間已結束」並回大廳），再結束，避免玩家只看到莫名斷線
function shutdown(sig) {
  console.log(`收到 ${sig}，通知房間後結束`);
  for (const room of [...rm.rooms.values()]) io.to(room.id).emit('room:closed', { reason: '伺服器更新重啟，房間已結束，請稍後重新建立' });
  setTimeout(() => process.exit(0), 800).unref();
}
if (require.main === module) { process.once('SIGTERM', () => shutdown('SIGTERM')); process.once('SIGINT', () => shutdown('SIGINT')); }

module.exports = { app, server, io, rm };
