/* Socket.IO 連線管理：單一連線、ack 逾時、斷線自動重連與房間續連。 */
import { CONFIG } from './config.js';
import { app } from './core.js';

let socket = null;
const listeners = new Map();
export const net = { connected: false, ever: false, onStatus: null };
const SESSION_KEY = 'house-stack:session';

export function saveSession(s) { try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } }
export function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }

export function on(ev, fn) { listeners.set(ev, fn); }

export function getSocket() {
  if (!CONFIG.serverUrl) return null;
  if (socket) return socket;
  socket = window.io(CONFIG.serverUrl, { transports: ['websocket', 'polling'], reconnectionDelay: 700, reconnectionDelayMax: 3500 });
  socket.on('connect', () => {
    const was = net.ever && !net.connected;
    net.connected = true; net.ever = true;
    net.onStatus && net.onStatus('up');
    const s = loadSession();
    if (was && s && app.online) {
      socket.emit('room:resume', s, (r) => {
        if (r && r.ok) { app.online.memberId = r.memberId; app.online.key = r.key; listeners.get('room:state') && listeners.get('room:state')(r.view); }
        else { saveSession(null); listeners.get('lost') && listeners.get('lost')(r && r.msg); }
      });
    }
    listeners.get('connect') && listeners.get('connect')();
  });
  socket.on('disconnect', () => { net.connected = false; net.onStatus && net.onStatus('down'); });
  socket.on('connect_error', () => { net.onStatus && net.onStatus('down'); });
  for (const ev of ['room:state', 'room:chat', 'room:closed', 'room:kicked', 'game:start', 'game:turn', 'game:drop', 'game:preview', 'game:forfeit', 'lobby:list']) {
    socket.on(ev, (d) => listeners.get(ev) && listeners.get(ev)(d));
  }
  return socket;
}

export function emit(ev, data, timeout = 9000) {
  return new Promise((resolve) => {
    const s = getSocket();
    if (!s) return resolve({ ok: false, code: 'offline', msg: '尚未設定線上伺服器' });
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, code: 'timeout', msg: '伺服器沒有回應（免費主機喚醒中，請稍候再試）' }); } }, timeout);
    s.emit(ev, data, (r) => { if (done) return; done = true; clearTimeout(t); resolve(r || { ok: false }); });
  });
}
export function emitQuiet(ev, data) { const s = getSocket(); if (s && s.connected) s.emit(ev, data); }
