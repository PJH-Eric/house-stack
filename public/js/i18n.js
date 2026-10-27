/* 多語系核心（繁體中文 zh-Hant／簡體中文 zh-Hans／English en）。
 * 沿用遊戲小小島各專案的做法：語言偏好存在同一個 localStorage key（game-island-lang），
 * 網址 ?lang= 優先，預設繁體中文。
 *
 * 字典以「繁體中文原文」當 key：t('開始') 在繁中直接回傳原文；
 * 其他語言查 locales.js（en）與 locales-hans.js（zh-Hans），查不到就退回原文，不會顯示 key 代碼。
 * 含變數的字串用 {名稱}：t('最高蓋到 {peak} 層', { peak: 12 })。
 * 伺服器回傳的中文訊息用 tm() 轉成目前語言（含變數的訊息以樣式比對）。
 */
import { EN, SERVER_KEYS } from './locales.js';
import { HANS } from './locales-hans.js';

export const SUPPORTED = ['zh-Hant', 'zh-Hans', 'en'];
export const LANG_NAMES = { 'zh-Hant': '繁體中文', 'zh-Hans': '简体中文', en: 'English' };
/* 網頁標題與說明：繁中原文必須與 seo.config.json 一致（tests/seo.js 會檢查） */
export const META_TITLE = "疊疊高樓｜免費線上 3D 疊房子・單人與多人對戰";
export const META_DESC = "免費免下載的 3D 吊車疊房子遊戲，用重心判定疊高樓，中段樓層風力最強、太空還有無重力。單人挑戰、對電腦輪流，也能線上多人對戰與觀戰，手機平板都能玩。";
const KEY = 'game-island-lang';
const DEFAULT = 'zh-Hant';
const dicts = { 'zh-Hant': {}, 'zh-Hans': HANS, en: EN };

function normalize(v) {
  if (!v) return null;
  v = String(v).toLowerCase().replace(/_/g, '-');
  if (v === 'en' || v.startsWith('en-')) return 'en';
  if (v.startsWith('zh')) return /^zh-(hans|cn|sg)/.test(v) ? 'zh-Hans' : 'zh-Hant';
  return null;
}
function readUrl() { try { return normalize(new URLSearchParams(location.search).get('lang')); } catch (e) { return null; } }
function readStored() { try { return normalize(localStorage.getItem(KEY)); } catch (e) { return null; } }
function writeStored(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* 隱私模式：忽略 */ } }

let lang = readUrl() || readStored() || DEFAULT;
const listeners = [];

/* 變數與英文單複數：{n} 取代為數值；{n|floor|floors} 依 n 是否為 1 選單數／複數（只用於英文字典） */
function fill(text, params) {
  if (!params) return text;
  return text
    .replace(/\{(\w+)\|([^|}]*)\|([^|}]*)\}/g, (m, k, one, many) => (params[k] == null ? many : Number(params[k]) === 1 ? one : many))
    .replace(/\{(\w+)\}/g, (m, k) => (params[k] == null ? m : String(params[k])));
}
export function t(key, params) {
  const d = dicts[lang];
  let v = d && Object.prototype.hasOwnProperty.call(d, key) ? d[key] : undefined;
  if (v === undefined) v = key.includes('|') ? key.split('|')[0] : key; /* 「原文|標記」：同一原文在不同位置需要不同譯文時，用標記區分 */
  return fill(v, params);
}

/* 伺服器／舊流程回傳的中文訊息 → 目前語言。完全相符先查；含 {變數} 的條目用樣式比對。 */
let patterns = null;
function buildPatterns() {
  const src = SERVER_KEYS.filter((k) => k.includes('{'));
  patterns = src.map((key) => {
    const names = [];
    const re = key.split(/(\{\w+\})/).map((p) => {
      if (/^\{\w+\}$/.test(p)) { names.push(p.slice(1, -1)); return '(.+?)'; }
      return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    return { key, names, size: key.length, re: new RegExp('^' + re + '$') };
  }).sort((a, b) => b.size - a.size);
}
export function tm(value) {
  if (value == null) return '';
  const text = String(value);
  if (lang === DEFAULT) return text;
  const d = dicts[lang];
  if (Object.prototype.hasOwnProperty.call(d, text)) return d[text];
  if (!patterns) buildPatterns();
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (m) { const params = {}; p.names.forEach((n, i) => { params[n] = m[i + 1]; }); return t(p.key, params); }
  }
  return text;
}

export function getLang() { return lang; }
export function onLangChange(fn) { listeners.push(fn); }

/* 套用到靜態頁面（標題、說明、<html lang>） */
export function applyDocument() {
  document.documentElement.lang = lang;
  document.documentElement.dataset.lang = lang;
  document.title = t(META_TITLE);
  const d = document.querySelector('meta[name="description"]');
  if (d) d.setAttribute('content', t(META_DESC));
}

export function setLang(next) {
  next = normalize(next) || DEFAULT;
  if (next === lang) return lang;
  lang = next;
  writeStored(lang);
  try {
    const u = new URL(location.href);
    if (u.searchParams.has('lang')) { u.searchParams.set('lang', lang); history.replaceState(history.state, '', u); }
  } catch (e) { /* 忽略 */ }
  applyDocument();
  listeners.slice().forEach((fn) => { try { fn(lang); } catch (e) { console.error(e); } });
  document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang } }));
  return lang;
}

/* 給連結加上 ?lang=，跨來源（遊戲大廳）同步語言 */
export function withLang(url) {
  try { const u = new URL(url, location.href); u.searchParams.set('lang', lang); return u.toString(); } catch (e) { return url; }
}

const api = { SUPPORTED, LANG_NAMES, t, tm, get lang() { return lang; }, setLang, onChange: onLangChange, withLang };
window.I18N = api;
applyDocument();
export default api;
