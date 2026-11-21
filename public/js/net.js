/* Socket.IO 連線管理：單一連線、ack 逾時、斷線自動重連與房間續連。 */
import { t, tm } from './i18n.js';
import { CONFIG } from './config.js';
import { app } from './core.js';

let socket = null;
let opening = null;
let generation = 0;
const listeners = new Map();
const pending = new Set();
export const net = { connected: false, ever: false, onStatus: null, statusHook: null };
const status = (v) => { net.onStatus && net.onStatus(v); net.statusHook && net.statusHook(v); };
const SESSION_KEY = 'house-stack:session';

export function saveSession(s) {
  try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  if (s) window.GameBackend?.rememberRoom?.();
  else window.GameBackend?.forgetRoom?.();
}
export function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }

/* 伺服器送來的中文訊息（msg／reason／系統聊天）轉成目前語言 */
function loc(d, depth = 0) {
  if (!d || typeof d !== 'object' || depth > 5) return d;
  if (Array.isArray(d)) return d.map((x) => loc(x, depth + 1));
  const o = {};
  for (const k of Object.keys(d)) {
    const v = d[k];
    if ((k === 'msg' || k === 'reason') && typeof v === 'string') o[k] = tm(v);
    else if (k === 'text' && d.sys === true && typeof v === 'string') o[k] = tm(v);
    else o[k] = loc(v, depth + 1);
  }
  return o;
}

export function on(ev, fn) { listeners.set(ev, fn); }

export function disconnect() {
  generation++;
  opening = null;
  for (const cancel of [...pending]) cancel();
  if (socket) socket.disconnect();
  socket = null;
  net.connected = false;
  net.ever = false;
}

export function getSocket() {
  if (!socket && CONFIG.serverUrl && !window.GameBackend?.canRoute(CONFIG.serverUrl)) {
    return openSocket(CONFIG.serverUrl);
  }
  return socket;
}

export function connect() {
  const existing = getSocket();
  if (existing || !CONFIG.serverUrl) return Promise.resolve(existing);
  if (opening) return opening;
  const attempt = generation;
  const selected = window.GameBackend?.select(CONFIG.serverUrl) ?? CONFIG.serverUrl;
  const pendingConnection = Promise.resolve(selected).then(base => {
    return attempt === generation ? openSocket(base) : null;
  }).catch(() => {
    if (attempt === generation) status('down');
    return null;
  }).finally(() => {
    if (opening === pendingConnection) opening = null;
  });
  opening = pendingConnection;
  return opening;
}

function openSocket(base) {
  socket = window.io(base, { transports: ['websocket', 'polling'], reconnectionDelay: 700, reconnectionDelayMax: 3500 });
  const currentSocket = socket;
  socket.on('connect', () => {
    const was = net.ever && !net.connected;
    net.connected = true; net.ever = true;
    status('up');
    const s = loadSession();
    if (was && s && app.online) {
      const online = app.online;
      socket.emit('room:resume', s, (r0) => {
        if (socket !== currentSocket || app.online !== online) return;
        const r = loc(r0);
        if (r && r.ok) { app.online.memberId = r.memberId; app.online.key = r.key; listeners.get('room:state') && listeners.get('room:state')(r.view); }
        else { saveSession(null); listeners.get('lost') && listeners.get('lost')(r && r.msg); }
      });
    } else if (was && !app.online) {
      socket.emit('lobby:watch', {}, (r) => {
        if (socket !== currentSocket || app.online || !r || !r.ok) return;
        listeners.get('lobby:list') && listeners.get('lobby:list')(r.rooms);
        listeners.get('lobby:online') && listeners.get('lobby:online')(r.online);
      });
    }
    listeners.get('connect') && listeners.get('connect')();
  });
  socket.on('disconnect', () => { net.connected = false; status('down'); });
  socket.on('connect_error', () => { status('down'); });
  for (const ev of ['room:state', 'room:chat', 'room:closed', 'room:kicked', 'game:start', 'game:turn', 'game:drop', 'game:preview', 'game:forfeit', 'lobby:list', 'lobby:online']) {
    socket.on(ev, (d) => listeners.get(ev) && listeners.get(ev)(loc(d)));
  }
  /* 大廳聊天是玩家原文，不做伺服器訊息翻譯 */
  for (const ev of ['lobbychat:history', 'lobbychat:msg', 'lobbychat:online', 'lobbychat:error']) {
    socket.on(ev, (d) => listeners.get(ev) && listeners.get(ev)(d));
  }
  return socket;
}

export function emit(ev, data, timeout = 9000) {
  const existing = getSocket();
  if (existing) return emitWhenConnected(existing, ev, data, timeout);
  return connect().then(s => {
    if (!s || socket !== s) return { ok: false, code: 'offline', msg: t('尚未設定線上伺服器') };
    return emitWhenConnected(s, ev, data, timeout);
  });
}

function emitWhenConnected(s, ev, data, timeout) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.off('connect', send);
      pending.delete(cancel);
      resolve(r);
    };
    const send = () => {
      if (!done && socket === s && s.connected) s.emit(ev, data, (r) => finish(loc(r) || { ok: false }));
    };
    const cancel = () => finish({ ok: false, code: 'offline' });
    const timer = setTimeout(() => finish({ ok: false, code: 'timeout', msg: t('伺服器沒有回應（免費主機喚醒中，請稍候再試）') }), timeout);
    pending.add(cancel);
    // 連上才送出，避免逾時或離開畫面後，傳輸層重送已放棄的建房／加入請求。
    if (s.connected) send();
    else s.once('connect', send);
  });
}
export function emitQuiet(ev, data) { if (socket && socket.connected) socket.emit(ev, data); }
