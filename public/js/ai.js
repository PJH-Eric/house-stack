/*
 * 疊疊高樓 — 電腦對手（瀏覽器與伺服器共用，全域 HouseAI）
 * 電腦先決定想放的偏移 d，再等吊車擺到那個位置才放下，因此畫面上看起來和真人一樣在「抓時機」。
 * 四段難度的可觀察差異（電腦只有這四段；「神話」是遊戲難度，困難電腦已能穩定完美，不另設更強的電腦）：
 *   kids   幼幼班：只瞄準中央，誤差很大，不評估
 *   easy   簡單  ：瞄準中央，誤差中等；偶爾（20%）試算一次，會倒才重瞄
 *   normal 普通  ：瞄準中央，誤差小；試算，會倒就重瞄（70%）
 *   hard   困難  ：誤差極小；試算 13 個候選，挑「最穩」（會往重心回正的方向補償），不會倒就盡量完美
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HouseAI = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WIND_ERR = { kids: 0.5, easy: 0.25, normal: 0.1, hard: 0.03 }; // 電腦估計風力的誤差（比例）
  const SIGMA = { kids: 1.25, easy: 0.62, normal: 0.3, hard: 0.15 };

  function gauss(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /** 回傳 { d, thinkMs, why }；game 不會被修改。tNow：本回合已經過的秒數（吊車相位用）。 */
  function chooseMove(game, level, rng, opts) {
    rng = rng || Math.random;
    const R = typeof self !== 'undefined' && self.HouseRules ? self.HouseRules : require('./rules.js');
    const amp = game.D.amp;
    const speedMul = game.swingSpec.omega / game.D.speed; // 吊車越快，電腦抓時機的誤差越大
    const sigma = (SIGMA[level] != null ? SIGMA[level] : SIGMA.normal) * (1 + 0.9 * (speedMul - 1));
    const tNow = (opts && opts.tNow) || 0;
    const sw = game.swingSpec, bias = sw.bias || 0, drift = sw.drift || 0;
    const lo = bias - amp, hi = bias + amp; // 吊車這回合實際擺得到的範圍
    const aim = -drift * (1 + gauss(rng) * (WIND_ERR[level] != null ? WIND_ERR[level] : 0.1)); // 電腦把風算進去（有估計誤差，難度越高越準）：瞄準「被風吹走後剛好落在中央」的位置
    const clampS = (v) => clamp(v, lo, hi);
    let d = clampS(aim + gauss(rng) * sigma);
    let why = 'aim';

    if (level === 'easy' && rng() < 0.2) {
      if (game.probe(d).topple) { d = clampS(aim + gauss(rng) * sigma * 0.6); why = 'reaim'; }
    } else if (level === 'normal') {
      const pr = game.probe(d);
      if (pr.topple && rng() < 0.7) {
        // 在目標附近試幾個點，取第一個不會倒的
        for (const k of [0.4, -0.4, 0.8, -0.8, 1.2, -1.2]) {
          const c = clampS(d + k);
          if (!game.probe(c).topple) { d = c; why = 'reaim'; break; }
        }
      }
    } else if (level === 'hard') {
      // 候選：以瞄準點為中心 ±0.9，步距 0.15，挑 maxRatio 最小（最穩）者；同樣穩時偏好完美
      let best = null;
      for (let k = -6; k <= 6; k++) {
        const c = clampS(d + k * 0.15);
        const pr = game.probe(c);
        const score = pr.maxRatio + (pr.topple ? 10 : 0) - (pr.perfect ? 0.05 : 0) + Math.abs(k) * 0.004;
        if (!best || score < best.score) best = { c, score };
      }
      d = best.c; why = 'probe';
    }

    const tReach = R.timeToReach(game.swingSpec, d, tNow + 0.45); // 至少 0.45 秒「反應時間」
    const thinkMs = Math.max(500, Math.round((tReach - tNow) * 1000));
    return { d: Math.round(d * 1000) / 1000, thinkMs, why };
  }

  return { chooseMove, SIGMA };
});
