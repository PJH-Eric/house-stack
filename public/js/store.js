/* 設定與本機紀錄（localStorage，全程 try/catch：私密視窗或被封鎖時仍可遊玩）。 */
const KEY = 'house-stack:v1';
export const DEFAULTS = { music: true, musicVol: 50, sfx: true, sfxVol: 80, vibrate: true, reduceMotion: false, guide: true, nick: '', best: {}, played: 0 };
let data = { ...DEFAULTS };
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') data = { ...DEFAULTS, ...s, best: { ...(s.best || {}) } }; } catch (e) { /* ignore */ }
const subs = new Set();
function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ } }
export const store = {
  get: () => data,
  set(patch) { data = { ...data, ...patch }; save(); subs.forEach((f) => f(data)); },
  reset() { const keep = { best: data.best, played: data.played, nick: data.nick }; data = { ...DEFAULTS, ...keep }; save(); subs.forEach((f) => f(data)); },
  best(diff) { return data.best[diff] || 0; },
  setBest(diff, v) { if (v > (data.best[diff] || 0)) { this.set({ best: { ...data.best, [diff]: v } }); return true; } return false; },
  subscribe(f) { subs.add(f); return () => subs.delete(f); },
};
