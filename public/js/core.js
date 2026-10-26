/* 共用狀態與常數（避免畫面模組之間循環相依）。 */
import { t } from './i18n.js';
import { store } from './store.js';
const R = window.HouseRules;

export const app = { go: () => {}, screen: null, online: null, openSettings: () => {} };

export const DIFF_KEYS = ['kids', 'easy', 'normal', 'hard'];
export const DIFF_DESC = {
  kids: t('樓層超寬、吊車很慢、愛心很多'),
  easy: t('樓層寬、吊車偏慢'),
  normal: t('樓層與速度適中'),
  hard: t('樓層窄、吊車快，容錯很小'),
};
export const diffLabel = (k) => t((R.DIFFICULTIES[k] || {}).label || k); // 幼幼班／簡單／普通／困難（字典見 locales.js）
export const DIFF_OPTS = DIFF_KEYS.map((k) => ({ value: k, label: diffLabel(k), sub: DIFF_DESC[k] }));
export const AI_OPTS = DIFF_KEYS.map((k) => ({ value: k, label: t('電腦・') + diffLabel(k) }));

export function nick() { return (store.get().nick || '').trim(); }
export function randomNick() {
  const a = [t('小'), t('圓'), t('胖'), t('快樂'), t('勇敢'), t('呆呆'), t('輕輕'), t('穩穩')];
  const b = [t('建築師'), t('工頭'), t('松鼠'), t('小熊'), t('兔子'), t('企鵝'), t('貓咪'), t('狐狸')];
  return (a[Math.floor(Math.random() * a.length)] + b[Math.floor(Math.random() * b.length)]).slice(0, 12);
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
