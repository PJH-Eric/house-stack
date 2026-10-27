/*
 * 疊疊高樓 — 規則核心（UMD：Node 與瀏覽器共用，全域名稱 HouseRules）。
 *
 * 玩法（吊車投放 + 重心物理混合）：
 *  1. 吊車沿單一軸向左右擺盪（永遠沿畫面左右，鏡頭正對樓房）。風：隨高度增強並有陣風，會把吊車擺盪中心吹偏（bias），
 *     也會在樓層落下途中把它吹走一段（drift）；140 層以上的太空無風。，玩家在合適的瞬間放下新樓層。
 *  2. 樓層不會被裁切；（可選規則 irregular：第 5 層起寬窄高矮不一，預設關閉）；太空（140 層）無風，改無重力磁吸；偏移後保留完整尺寸，由「重心穩定」決定是否倒塌：
 *     對每個接合面 j（第 j 層坐在第 j-1 層上），j 層以上所有樓層的重心，
 *     必須落在 j 層與 j-1 層的重疊區域內；最低的違規接合面以上全部倒塌。
 *  3. 倒塌（含完全沒接到）= 損失 1 條命。命用完淘汰；單人以得分計，多人最後留下者勝。
 *  4. 連續「完美」（偏移小於容許值）累積連擊，加倍得分；樓越高吊車越快。
 * 本檔無 DOM / 網路依賴，伺服器、AI、單機模式共用同一份規則。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HouseRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FLOOR_H = 3.4; // 樓層高度（世界單位）；樓層近乎立方體，和參考作品一樣
  const SKY_FLOORS = Infinity; // 預設沒有樓層上限，背景一路換到太空與銀河；測試或特殊規則可用 createGame({ maxFloors })
  const PALETTE_COUNT = 12;
  const SPACE_FLOORS = 140; // 到達這個高度進入太空：沒有風，改為無重力（磁吸 + 漂浮）
  /** 完美對齊：偏移在容許內仍判完美，但只被吸回一部分，保留這個比例的偏移 */
  const SNAP_KEEP = 0.5;
  /** 太空磁吸：放下偏移被磁力往中心拉回的比例（依難度） */
  const MAG = { kids: 0.3, easy: 0.25, normal: 0.2, hard: 0.15, mythic: 0.1 };
  /** 不規則樓層：寬度／高度的最大變化幅度（第 5 層起，約 30 層內逐漸增加到最大） */
  const IRR = { kids: { w: 0.3, h: 0.25 }, easy: { w: 0.4, h: 0.3 }, normal: { w: 0.55, h: 0.35 }, hard: { w: 0.65, h: 0.4 }, mythic: { w: 0.7, h: 0.45 } };
  const VARIANT_COUNT = 4;
  const EPS = 1e-6;

  const DIFFICULTIES = {
    kids: { label: '幼幼班', size: 4.8, ground: 9, amp: 4.4, speed: 0.95, ramp: 0.010, maxSpeedMul: 1.5, tol: 0.42, lives: 5, versusLives: 3, turnSec: 40 },
    easy: { label: '簡單', size: 4.4, ground: 8, amp: 4.4, speed: 1.2, ramp: 0.014, maxSpeedMul: 1.7, tol: 0.34, lives: 3, versusLives: 2, turnSec: 30 },
    normal: { label: '普通', size: 4.0, ground: 7, amp: 4.4, speed: 1.5, ramp: 0.017, maxSpeedMul: 1.9, tol: 0.27, lives: 3, versusLives: 2, turnSec: 25 },
    hard: { label: '困難', size: 3.6, ground: 6, amp: 4.4, speed: 1.85, ramp: 0.02, maxSpeedMul: 2.1, tol: 0.2, lives: 2, versusLives: 1, turnSec: 20 },
    mythic: { label: '神話', size: 3.2, ground: 5, amp: 4.4, speed: 2.2, ramp: 0.024, maxSpeedMul: 2.4, tol: 0.14, lives: 1, versusLives: 1, turnSec: 15 },
  };

  /** 風：bias = 吊車擺盪中心被吹偏的量；drift = 放下後落下途中被吹走的量（|風|=1 時的最大值，依難度） */
  const WIND = {
    kids: { bias: 0.4, drift: 0.35 }, easy: { bias: 0.8, drift: 0.7 },
    normal: { bias: 1.2, drift: 1.1 }, hard: { bias: 1.6, drift: 1.5 }, mythic: { bias: 2.0, drift: 1.9 },
  };
  const WIND_LIMIT = 2; // 放下位置的容許範圍 = 吊車振幅 + 這個值
  /** 依高度的風力曲線：低樓層無風，逐漸增強，約 50–90 層最強（噴射氣流），之後減弱，140 層以上（太空）無風。 */
  function windBase(n) {
    if (n <= 2) return 0;
    if (n <= 50) return (n - 2) / 48;
    if (n <= 90) return 1;
    if (n < 140) return (140 - n) / 50;
    return 0;
  }

  /** 第 n 層（0 起算）的外形倍率 {w,h}：只由種子、難度、層數決定，各端點一致。 */
  function shapeFor(seed, diffKey, n, mode) {
    mode = mode || 'every';
    if (mode === 'off' || n < 1) return { w: 1, h: 1 };
    const S = IRR[diffKey] || IRR.normal;
    if (mode === 'fixed') { // 開局隨機一種形狀，整場都是它（幅度取該難度最大值的 55%~100%，並避開接近標準的外形）
      const r = mulberry32((seed ^ 0x5bd1e995) >>> 0);
      const u = r(), v = r(), k = 0.55 + 0.45 * r();
      let w = 1 + (u * 2 - 1) * S.w * k, hh = 1 + (v * 2 - 1) * S.h * k;
      if (Math.abs(w - 1) < 0.12 && Math.abs(hh - 1) < 0.1) w += u < 0.5 ? -0.25 : 0.25;
      return { w: r3(clamp(w, 0.55, 1.5)), h: r3(clamp(hh, 0.7, 1.4)) };
    }
    const ramp = Math.min(1, 0.45 + n * 0.1); // 每層都不同：第 1 層起就有明顯差異，6 層內增加到最大幅度
    const r = mulberry32((seed ^ Math.imul(n + 5, 2654435769)) >>> 0);
    const u = r(), v = r();
    return { w: r3(clamp(1 + (u * 2 - 1) * S.w * ramp, 0.55, 1.5)), h: r3(clamp(1 + (v * 2 - 1) * S.h * ramp, 0.7, 1.4)) };
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r3 = (v) => Math.round(v * 1000) / 1000;

  /** 吊車位置：相對於頂層中心的偏移，t 為本回合開始後的秒數。 */
  function swingPos(sw, tSec) { return (sw.bias || 0) + sw.amp * Math.sin(sw.omega * tSec + sw.phase); }

  /** 求吊車下一次經過偏移 d 的時間（秒，>= tNow）。AI 用來決定何時放下。 */
  function timeToReach(sw, d, tNow) {
    const x = clamp((d - (sw.bias || 0)) / sw.amp, -1, 1);
    const a = Math.asin(x); // sin(θ)=x 的兩族解：a + 2πk、π − a + 2πk
    let best = Infinity;
    for (const base of [a, Math.PI - a]) {
      let k = Math.ceil((sw.omega * tNow + sw.phase - base) / (2 * Math.PI));
      const t = (base + 2 * Math.PI * k - sw.phase) / sw.omega;
      if (t >= tNow - 1e-9 && t < best) best = t;
    }
    return best;
  }

  const axisFor = () => 'x'; // 吊車永遠沿畫面左右擺盪（和 Tower Bloxx 一樣只有單一軸向）

  /**
   * 穩定度評估。floors：[{x,z,w?,h?}]（w、h 為相對 size 的寬度／高度倍率，預設 1；質量 = w·h）；size：標準邊長；ground：地基半寬。
   * 回傳 { fallFrom, maxRatio, ratios[] }；fallFrom=-1 表示穩定。
   */
  function evaluate(floors, size, ground) {
    const n = floors.length;
    const hw = (f) => (size * (f.w || 1)) / 2, hd = size / 2; // 半寬（x 向依 w 變化）、半深
    const mass = (f) => (f.w || 1) * (f.h || 1);
    if (n >= 2) { // 新層完全沒接到：單獨掉落，塔不受影響
      const a = floors[n - 1], b = floors[n - 2];
      if (hw(a) + hw(b) - Math.abs(a.x - b.x) <= EPS || size - Math.abs(a.z - b.z) <= EPS) {
        const sub = evaluate(floors.slice(0, n - 1), size, ground);
        return { fallFrom: n - 1, maxRatio: 9, ratios: sub.ratios.concat([9]), missed: true };
      }
    }
    const ratios = new Array(n).fill(0);
    let fallFrom = -1, maxRatio = 0;
    // 由上往下累計質量與力矩（j..n-1）
    const sm = new Array(n + 1).fill(0), sx = new Array(n + 1).fill(0), sz = new Array(n + 1).fill(0);
    for (let i = n - 1; i >= 0; i--) { const m = mass(floors[i]); sm[i] = sm[i + 1] + m; sx[i] = sx[i + 1] + floors[i].x * m; sz[i] = sz[i + 1] + floors[i].z * m; }
    for (let j = 0; j < n; j++) {
      const cx = sx[j] / sm[j], cz = sz[j] / sm[j];
      let loX, hiX, loZ, hiZ;
      if (j === 0) { loX = -ground; hiX = ground; loZ = -ground; hiZ = ground; }
      else {
        const a = floors[j], b = floors[j - 1];
        loX = Math.max(a.x - hw(a), b.x - hw(b)); hiX = Math.min(a.x + hw(a), b.x + hw(b));
        loZ = Math.max(a.z, b.z) - hd; hiZ = Math.min(a.z, b.z) + hd;
      }
      let ratio;
      if (hiX - loX <= EPS || hiZ - loZ <= EPS) ratio = 9; // 完全沒接到
      else {
        const rx = Math.abs(cx - (loX + hiX) / 2) / ((hiX - loX) / 2);
        const rz = Math.abs(cz - (loZ + hiZ) / 2) / ((hiZ - loZ) / 2);
        ratio = Math.max(rx, rz);
      }
      ratios[j] = ratio;
      if (ratio > maxRatio) maxRatio = ratio;
      if (ratio >= 1 - EPS && fallFrom < 0) fallFrom = j;
    }
    return { fallFrom, maxRatio, ratios };
  }

  /** 每回合限時（秒）：可選值；0 = 預設（單人不限時、對戰依難度的 turnSec）。 */
  const TURN_LIMITS = [0, 5, 10, 15];
  function turnSecFor(diffKey, mode, turnLimit) {
    const n = Math.floor(+turnLimit);
    if (n > 0 && TURN_LIMITS.includes(n)) return n;
    return mode === 'versus' ? (DIFFICULTIES[diffKey] || DIFFICULTIES.normal).turnSec : 0;
  }

  function createGame(opts) {
    const diffKey = DIFFICULTIES[opts.difficulty] ? opts.difficulty : 'normal';
    const D = DIFFICULTIES[diffKey];
    const mode = opts.mode === 'versus' ? 'versus' : 'solo';
    const seed = (opts.seed >>> 0) || 1;
    const reqLives = Math.floor(+opts.lives);
    const startLives = reqLives >= 1 ? Math.min(reqLives, 99) : (mode === 'versus' ? D.versusLives : D.lives); // 不合理的命數（負數、NaN、過大）回到難度預設或上限
    const rng = mulberry32(seed);
    const maxFloors = opts.maxFloors > 0 ? opts.maxFloors : SKY_FLOORS;
    const windOn = opts.wind !== false;
    const shapes = opts.shapes === 'fixed' || opts.shapes === 'every' ? opts.shapes : opts.irregular === true ? 'every' : 'off'; // 樓層形狀：off 一般｜fixed 開局隨機一種、整場相同｜every 每層都不同
    const spaceAt = opts.spaceFloors > 0 ? opts.spaceFloors : SPACE_FLOORS;

    const g = {
      seed, difficulty: diffKey, mode, D, turnSec: turnSecFor(diffKey, mode, opts.turnLimit),
      floors: [], // {x,z,color,variant,seat,perfect}
      players: [],
      current: 0, turnNo: 0, over: false, winnerId: null, summit: false,
      combo: 0, bestCombo: 0, peak: 1, totalPlaced: 0,
      swingSpec: null,
    };

    const visual = (n) => { // 以樓層序號決定外觀，避免與其他隨機消耗互相影響
      const r = mulberry32((seed ^ Math.imul(n + 1, 2654435761)) >>> 0);
      return { color: Math.floor(r() * PALETTE_COUNT), variant: Math.floor(r() * VARIANT_COUNT) };
    };
    const shape = (n) => shapeFor(seed, diffKey, n, shapes);

    g.players = (opts.players && opts.players.length ? opts.players : [{ id: 'p1', name: '玩家' }]).map((p, i) => ({
      id: p.id, name: p.name, kind: p.kind || 'human', ai: p.ai, seat: p.seat != null ? p.seat : i,
      lives: startLives, alive: true, score: 0, placed: 0, perfects: 0, topples: 0,
    }));
    g.floors.push({ x: 0, z: 0, ...visual(0), w: 1, h: 1, seat: -1, perfect: false, base: true });

    const arr8 = (f) => [f.x, f.z, f.color, f.variant, f.seat, f.perfect ? 1 : 0, f.w || 1, f.h || 1];
    g.currentPlayer = () => g.players[g.current];
    g.alive = () => g.players.filter((p) => p.alive);
    g.top = () => g.floors[g.floors.length - 1];
    g.height = () => g.floors.length;
    g.axis = () => axisFor(g.floors.length);

    function speedMul() { return Math.min(D.maxSpeedMul, 1 + D.ramp * (g.floors.length - 1)); }
    /** 下一回合的吊車參數（由種子 + 回合序號決定，所有端點一致）。 */
    g.nextSwing = () => {
      const r = mulberry32((seed ^ Math.imul(g.turnNo + 7, 40503) ^ Math.imul(g.floors.length, 9973)) >>> 0);
      const n = g.floors.length;
      let wind = 0;
      if (windOn && n < spaceAt) {
        const dir = mulberry32((seed ^ Math.imul(g.turnNo + 3, 2246822519) ^ Math.imul(n, 7919)) >>> 0)() < 0.5 ? -1 : 1; // 每回合風向都可能不同
        const gust = 0.2 + 0.8 * mulberry32((seed ^ Math.imul(g.turnNo + 11, 3266489917) ^ Math.imul(n, 101)) >>> 0)(); // 每回合風速也不同
        wind = r3(dir * windBase(n) * gust);
      }
      const W = WIND[diffKey];
      const space = n >= spaceAt;
      return { axis: g.axis(), amp: D.amp, omega: r3(D.speed * speedMul() * (space ? 0.85 : 1)), phase: r3(r() * Math.PI * 2), look: { ...visual(g.turnNo + 1 + g.floors.length * 131), ...shape(n) }, wind, bias: r3(wind * W.bias), drift: r3(wind * W.drift), space, mag: space ? MAG[diffKey] : 0 };
    };
    g.swingSpec = g.nextSwing();

    function placeAt(d) {
      const dd = clamp(+d || 0, -(D.amp + WIND_LIMIT), D.amp + WIND_LIMIT);
      const top = g.top();
      const ax = g.axis();
      const drift = g.swingSpec ? g.swingSpec.drift || 0 : 0; // 落下途中被風吹走
      let off = dd + drift, perfect = false;
      const mag = g.swingSpec ? g.swingSpec.mag || 0 : 0; // 太空磁吸：偏移被拉回中心一部分
      if (mag) off *= 1 - mag;
      if (Math.abs(off) <= D.tol) { off *= SNAP_KEEP; perfect = true; }
      const look = g.swingSpec ? g.swingSpec.look : null;
      const nf = { x: top.x + (ax === 'x' ? off : 0), z: top.z + (ax === 'z' ? off : 0), w: look && look.w || 1, h: look && look.h || 1 };
      return { nf, perfect, d: dd, off, axis: ax, drift, mag };
    }

    /** 不修改狀態的試算：AI 與預覽用。 */
    g.probe = (d) => {
      const { nf, perfect, off } = placeAt(d);
      const test = g.floors.concat([nf]);
      const ev = evaluate(test, D.size, D.ground);
      return {
        perfect, off, fallFrom: ev.fallFrom, maxRatio: ev.maxRatio,
        topple: ev.fallFrom >= 0, lost: ev.fallFrom >= 0 ? test.length - ev.fallFrom : 0,
        ratios: ev.ratios,
      };
    };

    /** 目前塔的穩定度：1 = 非常穩，0 = 瀕臨倒塌。 */
    g.stability = () => {
      const ev = evaluate(g.floors, D.size, D.ground);
      return { stability: r3(clamp(1 - ev.maxRatio, 0, 1)), maxRatio: r3(ev.maxRatio), ratios: ev.ratios.map(r3) };
    };

    function nextAliveIndex(from) {
      const n = g.players.length;
      for (let k = 1; k <= n; k++) {
        const i = (from + k) % n;
        if (g.players[i].alive) return i;
      }
      return from;
    }

    function finish() {
      g.over = true;
      if (g.mode === 'versus') {
        const alive = g.alive();
        if (alive.length === 1) g.winnerId = alive[0].id;
        else if (alive.length > 1) { // 登頂：命多者勝，再比得分
          alive.sort((a, b) => b.lives - a.lives || b.score - a.score);
          g.winnerId = alive[0].lives === alive[1].lives && alive[0].score === alive[1].score ? null : alive[0].id;
        } else g.winnerId = null;
      }
    }

    g.drop = (move) => {
      if (g.over) return null;
      const p = g.currentPlayer();
      const sw = g.swingSpec;
      const { nf, perfect, d, off, axis, drift, mag } = placeAt(move && move.d);
      const look = sw.look;
      const placed = { x: r3(nf.x), z: r3(nf.z), color: look.color, variant: look.variant, w: nf.w, h: nf.h, seat: p.seat, perfect };
      const test = g.floors.concat([placed]);
      const ev = evaluate(test, D.size, D.ground);
      const toppled = ev.fallFrom >= 0;
      const res = {
        no: g.turnNo + 1, playerId: p.id, seat: p.seat, d: r3(d), drift: r3(drift), mag, off: r3(off), axis, perfect, placed,
        toppled, missed: !!ev.missed, fallFrom: ev.fallFrom, fallen: [], pivot: null, gain: 0, combo: 0,
        eliminated: false, over: false, winnerId: null, summit: false,
        swing: sw,
      };
      g.turnNo++;
      p.placed++;
      g.totalPlaced++;
      if (toppled) {
        res.fallen = test.slice(ev.fallFrom).map((f) => ({ ...f }));
        if (ev.fallFrom >= 1) { // 傾倒方向：上部重心相對支撐中心的偏向
          const cnt = test.length - ev.fallFrom;
          let cx = 0, cz = 0;
          for (let i = ev.fallFrom; i < test.length; i++) { cx += test[i].x; cz += test[i].z; }
          res.pivot = { j: ev.fallFrom, dx: r3(cx / cnt - test[ev.fallFrom - 1].x), dz: r3(cz / cnt - test[ev.fallFrom - 1].z) };
        } else res.pivot = { j: 0, dx: placed.x, dz: placed.z };
        g.floors = test.slice(0, ev.fallFrom);
        if (g.floors.length === 0) g.floors = [{ x: 0, z: 0, ...visual(0), w: 1, h: 1, seat: -1, perfect: false, base: true }]; // 保底：地基不會消失
        g.combo = 0;
        p.topples++;
        p.lives--;
        if (p.lives <= 0) { p.alive = false; res.eliminated = true; }
      } else {
        g.floors = test;
        if (perfect) { g.combo++; p.perfects++; g.bestCombo = Math.max(g.bestCombo, g.combo); } else g.combo = 0;
        const gain = 10 + (perfect ? 10 * Math.min(g.combo, 8) : 0) + Math.floor(g.floors.length / 5) * 2;
        p.score += gain; res.gain = gain;
        g.peak = Math.max(g.peak, g.floors.length);
      }
      res.combo = g.combo;
      res.height = g.floors.length;
      res.remaining = g.floors.map(arr8);

      // 結束條件
      if (g.mode === 'solo') { if (!p.alive) finish(); }
      else if (g.alive().length <= 1) finish();
      if (!g.over && g.floors.length >= maxFloors) { g.summit = true; finish(); }
      res.summit = g.summit;
      if (!g.over) { g.current = nextAliveIndex(g.current); }
      res.over = g.over; res.winnerId = g.winnerId;
      res.nextPlayerId = g.over ? null : g.currentPlayer().id;
      res.players = g.publicPlayers();
      res.stability = g.stability();
      g.swingSpec = g.nextSwing();
      res.nextSwing = g.over ? null : g.swingSpec;
      return res;
    };

    g.removePlayer = (id) => {
      const idx = g.players.findIndex((p) => p.id === id);
      if (idx < 0) return { over: g.over, wasTurn: false };
      const p = g.players[idx];
      const wasTurn = !g.over && g.current === idx;
      p.alive = false; p.lives = 0;
      if (g.over) return { over: true, wasTurn: false };
      if (g.alive().length <= 1) { finish(); return { over: true, wasTurn }; }
      if (wasTurn) { g.current = nextAliveIndex(idx); g.swingSpec = g.nextSwing(); }
      return { over: false, wasTurn };
    };

    g.publicPlayers = () => g.players.map((p) => ({
      id: p.id, name: p.name, kind: p.kind, ai: p.ai, seat: p.seat, lives: p.lives, alive: p.alive,
      score: p.score, placed: p.placed, perfects: p.perfects, topples: p.topples,
    }));

    g.publicState = () => ({
      seed, difficulty: diffKey, mode, shapes, turnSec: g.turnSec, size: D.size, ground: D.ground, amp: D.amp, tol: D.tol,
      floors: g.floors.map(arr8),
      players: g.publicPlayers(), current: g.current, currentId: g.over ? null : g.currentPlayer().id,
      turnNo: g.turnNo, over: g.over, winnerId: g.winnerId, summit: g.summit,
      combo: g.combo, bestCombo: g.bestCombo, peak: g.peak, swing: g.over ? null : g.swingSpec,
      stability: g.stability(),
    });

    return g;
  }

  return {
    TURN_LIMITS, turnSecFor, FLOOR_H, SKY_FLOORS, PALETTE_COUNT, VARIANT_COUNT, DIFFICULTIES, mulberry32, createGame,
    swingPos, timeToReach, evaluate, axisFor, clamp, windBase, WIND, SPACE_FLOORS, MAG, SNAP_KEEP, IRR, shapeFor,
  };
});
