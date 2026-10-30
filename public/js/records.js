/* 累計統計與成就（純函式，不碰 DOM／localStorage，方便測試）。資料存在 store 的 stats 與 ach。 */
export const STATS_DEFAULTS = { games: 0, floors: 0, perfects: 0, topples: 0, maxPeak: 0, bestCombo: 0, vsGames: 0, vsWins: 0, onlineGames: 0, onlineWins: 0 };

/** 成就定義：goal 為 stats[key] 需達到的值；名稱與說明在 app.js 以 t() 顯示。 */
export const ACHIEVEMENTS = [
  { id: 'first', key: 'games', goal: 1 },
  { id: 'f10', key: 'maxPeak', goal: 10 },
  { id: 'f30', key: 'maxPeak', goal: 30 },
  { id: 'f60', key: 'maxPeak', goal: 60 },
  { id: 'space', key: 'maxPeak', goal: 140 },
  { id: 'combo5', key: 'bestCombo', goal: 5 },
  { id: 'vsWin', key: 'vsWins', goal: 1 },
  { id: 'onlineWin', key: 'onlineWins', goal: 1 },
];

/** 舊資料補齊：已有的最高紀錄與遊玩場次併入統計，避免舊玩家的成績歸零。 */
export function normalize(data) {
  const s = { ...STATS_DEFAULTS, ...(data.stats || {}) };
  s.maxPeak = Math.max(s.maxPeak, ...Object.values(data.best || {}).map(Number).filter(Number.isFinite));
  s.games = Math.max(s.games, data.played || 0);
  return s;
}

export const unlockedIds = (stats) => ACHIEVEMENTS.filter((a) => stats[a.key] >= a.goal).map((a) => a.id);

/**
 * 記入一局結果。g = { mode: 'solo'|'ai'|'online', peak, bestCombo, win, me: { placed, perfects, topples } }
 * 回傳 { stats, ach, unlocked }：unlocked 是這局新解鎖的成就 id。
 */
export function recordGame(data, g, now = Date.now()) {
  const s = normalize(data);
  const me = g.me || {};
  s.games += g.mode === 'solo' ? 1 : 0;
  s.floors += me.placed || 0; s.perfects += me.perfects || 0; s.topples += me.topples || 0;
  s.maxPeak = Math.max(s.maxPeak, g.mode === 'solo' ? g.peak || 0 : 0);
  if (g.mode === 'solo') s.bestCombo = Math.max(s.bestCombo, g.bestCombo || 0);
  else if (g.mode === 'ai') { s.vsGames++; if (g.win) s.vsWins++; }
  else if (g.mode === 'online') { s.onlineGames++; if (g.win) s.onlineWins++; }
  if (g.mode !== 'solo') s.games++;
  const ach = { ...(data.ach || {}) };
  const unlocked = unlockedIds(s).filter((id) => !ach[id]);
  for (const id of unlocked) ach[id] = now;
  return { stats: s, ach, unlocked };
}
