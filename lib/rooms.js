'use strict';
/**
 * 房間與權限邏輯（不含網路層，便於測試）。
 * 規則重點：
 *  - 房間生命週期以「實體玩家」為準：至少一名真人玩家（非 AI、非觀戰者）在房才保留，降為 0 立即關閉。
 *  - 關閉後房間、邀請 token 永久失效，不可因重新連線復活。
 *  - 邀請 token 分玩家 / 觀戰兩種，由 token 決定最終角色；玩家席滿或對局進行中會轉為觀戰。
 *  - 暱稱一律由伺服器消毒；房主可撤銷並重發邀請。
 */
const crypto = require('crypto');
const T = require('../public/js/rules.js');

const MAX_SPECTATORS = 20;
const NAME_MAX = 12;
const CHAT_MAX = 120;
const DIFFS = Object.keys(T.DIFFICULTIES);
const AI_LEVELS = ['kids', 'easy', 'normal', 'hard'];

function sanitizeName(raw, fallback) {
  let s = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  s = Array.from(s).slice(0, NAME_MAX).join('');
  return s || fallback;
}
function sanitizeChat(raw) {
  return Array.from(String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f<>]/g, '').trim()).slice(0, CHAT_MAX).join('');
}
const token = (p) => p + crypto.randomBytes(9).toString('base64url');
function roomCode(existing) {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
    if (!existing.has(c)) return c;
  }
}

class RoomManager {
  constructor({ onEvent } = {}) {
    this.onEvent = onEvent || (() => {});
    this.rooms = new Map();
    this.bySid = new Map(); // sid -> {roomId, memberId}
    this._mid = 1;
  }

  emit(room, ev, data) { this.onEvent(room, ev, data); }

  // ---------- 建立 / 查詢 ----------
  createRoom({ sid, name, maxPlayers = 4, difficulty = 'normal', lives = 0, shapes = 'off', turnLimit = 0 }) {
    const id = roomCode(this.rooms);
    const room = {
      id,
      status: 'lobby', // lobby | playing | ended
      hostId: null,
      createdAt: Date.now(),
      settings: {
        maxPlayers: Math.max(2, Math.min(4, maxPlayers | 0 || 4)),
        difficulty: DIFFS.includes(difficulty) ? difficulty : 'normal',
        lives: Math.max(0, Math.min(5, lives | 0)),
        shapes: ['off', 'fixed', 'every'].includes(shapes) ? shapes : 'off',
        turnLimit: T.TURN_LIMITS.includes(turnLimit | 0) ? turnLimit | 0 : 0,
      },
      tokens: { player: token('p_'), spectator: token('s_') },
      members: new Map(),
      chat: [],
      game: null,
      turn: null,
      timers: new Set(),
      closed: false,
      rounds: 0,
    };
    this.rooms.set(id, room);
    const member = this._addMember(room, { sid, name: sanitizeName(name, '玩家'), role: 'player' });
    room.hostId = member.id;
    member.ready = true;
    this.emit(room, 'state', null);
    return { room, member };
  }

  _addMember(room, { sid, name, role, ai }) {
    const id = 'm' + this._mid++;
    const m = { id, sid: sid || null, key: sid ? crypto.randomBytes(12).toString('base64url') : null, name, role, ai: ai || null, ready: role === 'ai', connected: !!sid || role === 'ai', joinedAt: Date.now() };
    room.members.set(id, m);
    if (sid) this.bySid.set(sid, { roomId: room.id, memberId: id });
    return m;
  }

  humans(room) { return [...room.members.values()].filter((m) => m.role === 'player'); }
  seatCount(room) { return [...room.members.values()].filter((m) => m.role === 'player' || m.role === 'ai').length; }
  spectators(room) { return [...room.members.values()].filter((m) => m.role === 'spectator'); }

  inviteInfo(roomId, tok) {
    const room = this.rooms.get(String(roomId || '').toUpperCase());
    if (!room || room.closed) return { ok: false, code: 'closed' };
    let role = null;
    if (tok === room.tokens.player) role = 'player';
    else if (tok === room.tokens.spectator) role = 'spectator';
    if (!role) return { ok: false, code: 'bad_token' };
    return { ok: true, roomId: room.id, role, status: room.status, players: this.humans(room).length, seats: room.settings.maxPlayers, difficulty: room.settings.difficulty, shapes: room.settings.shapes };
  }

  // ---------- 加入 / 離開 ----------
  join({ sid, name, roomId, token: tok, role }) {
    const room = this.rooms.get(String(roomId || '').toUpperCase());
    if (!room || room.closed) return { ok: false, code: 'closed' };
    if (this.bySid.has(sid)) this.leave(sid);
    let want = role === 'spectator' ? 'spectator' : 'player';
    if (tok != null && tok !== '') {
      if (tok === room.tokens.player) want = 'player';
      else if (tok === room.tokens.spectator) want = 'spectator';
      else return { ok: false, code: 'bad_token' };
    }
    let converted = null;
    if (want === 'player') {
      if (room.status === 'playing') { want = 'spectator'; converted = 'started'; }
      else if (this.seatCount(room) >= room.settings.maxPlayers) { want = 'spectator'; converted = 'full'; }
    }
    if (want === 'spectator' && this.spectators(room).length >= MAX_SPECTATORS) return { ok: false, code: 'spectators_full' };
    const nm = sanitizeName(name, want === 'player' ? '玩家' + (this.humans(room).length + 1) : '觀眾');
    const member = this._addMember(room, { sid, name: nm, role: want });
    this.systemChat(room, `${member.name} ${want === 'player' ? '加入對戰' : '開始觀戰'}`);
    this.emit(room, 'state', null);
    return { ok: true, room, member, converted };
  }

  /** 以 memberId + key 重新綁定連線（30 秒寬限內）。已關閉的房間不會復活。 */
  resume({ sid, roomId, memberId, key }) {
    const room = this.rooms.get(String(roomId || '').toUpperCase());
    if (!room || room.closed) return { ok: false, code: 'closed' };
    const m = room.members.get(memberId);
    if (!m || m.role === 'ai' || !m.key || m.key !== key) return { ok: false, code: 'bad_resume' };
    if (m.sid) this.bySid.delete(m.sid);
    m.sid = sid; m.connected = true; m.disconnectedAt = null;
    this.bySid.set(sid, { roomId: room.id, memberId: m.id });
    this.emit(room, 'state', null);
    return { ok: true, room, member: m };
  }

  locate(sid) {
    const ref = this.bySid.get(sid);
    if (!ref) return null;
    const room = this.rooms.get(ref.roomId);
    if (!room) return null;
    const member = room.members.get(ref.memberId);
    return member ? { room, member } : null;
  }

  /** 連線中斷（保留席位，由 server 在寬限期後呼叫 removeMember）。 */
  markDisconnected(sid) {
    const loc = this.locate(sid);
    if (!loc) return null;
    loc.member.connected = false; loc.member.disconnectedAt = Date.now();
    this.bySid.delete(sid);
    loc.member.sid = null;
    this.emit(loc.room, 'state', null);
    return loc;
  }

  leave(sid) {
    const loc = this.locate(sid);
    if (!loc) return null;
    this.bySid.delete(sid);
    return this.removeMember(loc.room, loc.member.id, '離開了房間');
  }

  removeMember(room, memberId, why) {
    const m = room.members.get(memberId);
    if (!m || room.closed) return null;
    room.members.delete(memberId);
    if (m.sid) this.bySid.delete(m.sid);
    if (m.role !== 'ai') this.systemChat(room, `${m.name} ${why || '離開了房間'}`);
    let gameEv = null;
    if (room.game && room.status === 'playing' && m.role === 'player') {
      gameEv = room.game.removePlayer(m.id);
      if (gameEv.over) room.status = 'ended';
    }
    // 房主交接
    if (room.hostId === m.id) {
      const nh = this.humans(room)[0];
      room.hostId = nh ? nh.id : null;
      if (nh) { nh.ready = true; this.systemChat(room, `${nh.name} 成為房主`); }
    }
    // 生命週期：沒有任何實體玩家 → 立即關閉
    if (this.humans(room).length === 0) {
      this.closeRoom(room, '房內已沒有玩家，房間結束');
      return { room, closed: true, gameEv };
    }
    this.emit(room, 'state', null);
    return { room, closed: false, gameEv, wasTurn: !!(gameEv && gameEv.wasTurn) };
  }

  closeRoom(room, reason) {
    if (room.closed) return;
    room.closed = true;
    room.status = 'closed';
    room.tokens = { player: null, spectator: null };
    for (const t of room.timers) clearTimeout(t);
    room.timers.clear();
    this.emit(room, 'closed', { reason: reason || '房間已結束' });
    for (const m of room.members.values()) if (m.sid) this.bySid.delete(m.sid);
    this.rooms.delete(room.id);
  }

  timer(room, fn, ms) {
    const t = setTimeout(() => { room.timers.delete(t); if (!room.closed) fn(); }, ms);
    room.timers.add(t);
    return t;
  }

  // ---------- 房間設定 / AI / 邀請 ----------
  _hostOnly(room, byId) { return !room.closed && room.hostId === byId && room.status !== 'playing'; }

  setSettings(room, byId, patch) {
    if (!this._hostOnly(room, byId)) return false;
    const s = room.settings;
    if (patch.difficulty && DIFFS.includes(patch.difficulty)) s.difficulty = patch.difficulty;
    if (patch.lives != null) s.lives = Math.max(0, Math.min(5, patch.lives | 0));
    if (['off', 'fixed', 'every'].includes(patch.shapes)) s.shapes = patch.shapes;
    if (patch.turnLimit != null && T.TURN_LIMITS.includes(patch.turnLimit | 0)) s.turnLimit = patch.turnLimit | 0;
    if (patch.maxPlayers != null) s.maxPlayers = Math.max(Math.max(2, this.seatCount(room)), Math.min(4, patch.maxPlayers | 0));
    this.emit(room, 'state', null);
    return true;
  }

  addAi(room, byId, level) {
    if (!this._hostOnly(room, byId)) return null;
    if (this.seatCount(room) >= room.settings.maxPlayers) return null;
    const lv = AI_LEVELS.includes(level) ? level : 'normal';
    const n = [...room.members.values()].filter((m) => m.role === 'ai').length + 1;
    const m = this._addMember(room, { role: 'ai', name: `電腦${n}`, ai: lv });
    this.emit(room, 'state', null);
    return m;
  }

  setAiLevel(room, byId, aiId, level) {
    const m = room.members.get(aiId);
    if (!this._hostOnly(room, byId) || !m || m.role !== 'ai' || !AI_LEVELS.includes(level)) return false;
    m.ai = level;
    this.emit(room, 'state', null);
    return true;
  }

  removeAi(room, byId, aiId) {
    const m = room.members.get(aiId);
    if (!this._hostOnly(room, byId) || !m || m.role !== 'ai') return false;
    room.members.delete(aiId);
    this.emit(room, 'state', null);
    return true;
  }

  kick(room, byId, targetId) {
    const m = room.members.get(targetId);
    if (room.closed || room.hostId !== byId || !m || m.id === byId || m.role === 'ai') return null;
    const sid = m.sid;
    const res = this.removeMember(room, targetId, '被請出房間');
    return { sid, res };
  }

  revokeInvite(room, byId) {
    if (room.closed || room.hostId !== byId) return false;
    room.tokens = { player: token('p_'), spectator: token('s_') };
    this.emit(room, 'state', null);
    return true;
  }

  takeSeat(room, memberId) {
    const m = room.members.get(memberId);
    if (!m || m.role !== 'spectator' || room.status === 'playing' || this.seatCount(room) >= room.settings.maxPlayers) return false;
    m.role = 'player'; m.ready = false;
    this.systemChat(room, `${m.name} 入座加入對戰`);
    this.emit(room, 'state', null);
    return true;
  }

  watch(room, memberId) {
    const m = room.members.get(memberId);
    if (!m || m.role !== 'player' || room.status === 'playing' || room.hostId === memberId) return false;
    m.role = 'spectator';
    this.emit(room, 'state', null);
    return true;
  }

  setReady(room, memberId, ready) {
    const m = room.members.get(memberId);
    if (!m || m.role !== 'player' || room.status === 'playing') return false;
    m.ready = room.hostId === memberId ? true : !!ready;
    this.emit(room, 'state', null);
    return true;
  }

  // ---------- 聊天 ----------
  systemChat(room, text) {
    const msg = { id: room.chat.length ? room.chat[room.chat.length - 1].id + 1 : 1, sys: true, text, at: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > 60) room.chat.shift();
    this.emit(room, 'chat', msg);
  }

  chat(room, memberId, text) {
    const m = room.members.get(memberId);
    const t = sanitizeChat(text);
    if (!m || !t || room.closed) return null;
    const msg = { id: room.chat.length ? room.chat[room.chat.length - 1].id + 1 : 1, from: m.id, name: m.name, role: m.role, text: t, at: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > 60) room.chat.shift();
    this.emit(room, 'chat', msg);
    return msg;
  }

  // ---------- 對局 ----------
  canStart(room) {
    if (room.closed || room.status === 'playing') return { ok: false, msg: '對局進行中' };
    if (this.seatCount(room) < 2) return { ok: false, msg: '至少需要 2 位（可加入電腦）' };
    const waiting = this.humans(room).filter((m) => m.id !== room.hostId && !m.ready);
    if (waiting.length) return { ok: false, msg: `還有 ${waiting.length} 位玩家未準備` };
    return { ok: true };
  }

  start(room, byId) {
    if (room.hostId !== byId) return { ok: false, msg: '只有房主能開始' };
    const c = this.canStart(room);
    if (!c.ok) return c;
    const seats = [...room.members.values()].filter((m) => m.role === 'player' || m.role === 'ai');
    const lives = room.settings.lives || 0;
    room.game = T.createGame({
      seed: (crypto.randomInt(1, 2 ** 31)) >>> 0,
      difficulty: room.settings.difficulty,
      mode: 'versus',
      lives: lives || undefined,
      shapes: room.settings.shapes,
      turnLimit: room.settings.turnLimit || 0,
      players: seats.map((m, i) => ({ id: m.id, name: m.name, kind: m.role === 'ai' ? 'ai' : 'human', ai: m.ai, seat: i })),
    });
    room.status = 'playing';
    room.rounds++;
    room.turn = null;
    for (const m of room.members.values()) if (m.role === 'player' && m.id !== room.hostId) m.ready = false;
    this.systemChat(room, `第 ${room.rounds} 局開始`);
    this.emit(room, 'state', null);
    return { ok: true };
  }

  /** 對外可見的房間資料（依成員身分過濾）。 */
  view(room, memberId) {
    const me = room.members.get(memberId);
    const members = [...room.members.values()].map((m) => ({
      id: m.id, name: m.name, role: m.role, ai: m.ai, ready: m.ready, connected: m.connected, host: m.id === room.hostId,
    }));
    return {
      id: room.id, status: room.status, hostId: room.hostId, settings: { ...room.settings },
      members, me: me ? { id: me.id, role: me.role } : null,
      invite: me && me.role === 'player' ? { player: room.tokens.player, spectator: room.tokens.spectator } : null,
      game: room.game && room.status !== 'lobby' ? room.game.publicState() : null,
      turn: room.turn ? { playerId: room.turn.playerId, deadline: room.turn.deadline, no: room.turn.no, t0: room.turn.t0, now: Date.now() } : null,
      rounds: room.rounds,
      chat: room.chat.slice(-30),
      canStart: this.canStart(room),
    };
  }

  lobbyList() {
    return [...this.rooms.values()].filter((r) => !r.closed).map((r) => ({
      id: r.id, status: r.status, difficulty: r.settings.difficulty, shapes: r.settings.shapes, seats: r.settings.maxPlayers,
      players: this.seatCount(r), watchers: this.spectators(r).length,
      host: (r.members.get(r.hostId) || {}).name || '',
    })).sort((a, b) => (a.status === 'lobby' ? 0 : 1) - (b.status === 'lobby' ? 0 : 1) || a.id.localeCompare(b.id));
  }

  findOpenRoom() {
    for (const r of this.rooms.values()) {
      if (!r.closed && r.status !== 'playing' && this.seatCount(r) < r.settings.maxPlayers && this.humans(r).some((m) => m.connected)) return r;
    }
    return null;
  }
}

module.exports = { RoomManager, sanitizeName, sanitizeChat, MAX_SPECTATORS, AI_LEVELS };
