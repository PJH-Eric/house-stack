/* 共用狀態與常數（避免畫面模組之間循環相依）。 */
import { store } from './store.js';
const R = window.HouseRules;

export const app = { go: () => {}, screen: null, online: null, openSettings: () => {} };

export const DIFF_KEYS = ['kids', 'easy', 'normal', 'hard'];
export const DIFF_DESC = {
  kids: '樓層超寬、吊車很慢、愛心很多',
  easy: '樓層寬、吊車偏慢',
  normal: '樓層與速度適中',
  hard: '樓層窄、吊車快，容錯很小',
};
export const diffLabel = (k) => (R.DIFFICULTIES[k] || {}).label || k;
export const DIFF_OPTS = DIFF_KEYS.map((k) => ({ value: k, label: diffLabel(k), sub: DIFF_DESC[k] }));
export const AI_OPTS = DIFF_KEYS.map((k) => ({ value: k, label: '電腦・' + diffLabel(k) }));

export function nick() { return (store.get().nick || '').trim(); }
export function randomNick() {
  const a = ['小', '圓', '胖', '快樂', '勇敢', '呆呆', '輕輕', '穩穩'];
  const b = ['建築師', '工頭', '松鼠', '小熊', '兔子', '企鵝', '貓咪', '狐狸'];
  return a[Math.floor(Math.random() * a.length)] + b[Math.floor(Math.random() * b.length)];
}
export function ensureNick() {
  let n = nick();
  if (!n) { n = randomNick(); store.set({ nick: n }); }
  return n;
}
export function inviteLink(roomId, tok) {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('room', roomId); u.searchParams.set('t', tok);
  return u.toString();
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function reduceMotion() { return store.get().reduceMotion || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }
