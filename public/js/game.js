/*
 * 對局畫面（單人／對電腦／線上共用）：3D 主區最大化、左側資訊欄（摘要＋聊天室）、
 * 底部操作列、疊在遊戲畫面上的結算 overlay（再來一局／回到房間／回到首頁）。
 * 操作：點一下畫面／按「放下」／空白鍵 = 放下吊車上的樓層；鏡頭固定正對樓房。
 */
import { t } from './i18n.js';
import { h, icon, Btn, IconBtn, Modal, Hearts, Badge, toast, hideToast, hasModal, KeyCap, ScrollArea } from './ui.js';
import { Board, PLAYER_COLORS } from './art.js';
import * as A from './audio.js';
import { store } from './store.js';
import { app, diffLabel, sleep, reduceMotion, ACH_TEXT } from './core.js';
import { recordGame } from './records.js';
import { Chat } from './chat.js';
import { emit, emitQuiet } from './net.js';

const R = window.HouseRules;
const HouseAI = window.HouseAI;

export function GameScreen(cfg) {
  const online = cfg.kind === 'online';
  const S = {
    diff: cfg.diff, mode: cfg.mode, players: [], myId: null, role: 'player', turnId: null, swing: null,
    deadline: 0, sec: 0, height: 1, peak: 1, turnNo: 0, over: false, winnerId: null, summit: false, canAct: false, paused: false,
    combo: 0, bestCombo: 0, stability: 1, unread: 0, spectators: 0, view: cfg.view || null, resultShown: false,
    pending: null, newBest: false, isHost: false, maxLives: 1, turnStartPerf: 0, thinking: false,
  };
  let g = null;
  let destroyed = false;
  let turnToken = 0;

  const colorOf = (id) => { const p = S.players.find((q) => q.id === id); return PLAYER_COLORS[((p ? p.seat : 0) || 0) % PLAYER_COLORS.length]; };
  const seatOf = (id) => { const p = S.players.find((q) => q.id === id); return p ? p.seat : 0; };
  const nameOf = (id) => (S.players.find((p) => p.id === id) || {}).name || t('玩家');
  const playerOf = (id) => S.players.find((p) => p.id === id);

  const canvas = h('canvas', { class: 'stage-canvas', role: 'img', 'aria-label': t('疊疊高樓 3D 遊戲畫面：吊車正在放下新的樓層') });
  const board = new Board(canvas);
  board.sky.onStage = (name, k) => { if (k > 0 && !destroyed && !S.over) toast(t('進入「{name}」', { name }), 2200); };
  board.sky.onThunder = () => { if (!destroyed) A.sfx.thunder(); };
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  const popLayer = h('div', { class: 'pop-layer', 'aria-hidden': 'true' });

  function initFromState(gs) {
    S.mode = gs.mode; S.diff = gs.difficulty; S.shapes = gs.shapes || 'off';
    board.setConfig(gs);
    S.players = gs.players.map((p) => ({ ...p }));
    S.maxLives = Math.max(S.maxLives, ...S.players.map((p) => p.lives));
    board.setFloors(gs.floors);
    S.height = gs.floors.length; S.peak = gs.peak; S.turnNo = gs.turnNo; S.turnId = gs.currentId;
    S.over = gs.over; S.winnerId = gs.winnerId; S.summit = gs.summit; S.combo = gs.combo; S.bestCombo = gs.bestCombo;
    S.stability = gs.stability ? gs.stability.stability : 1;
    board.setStability(gs.stability ? gs.stability.maxRatio : 0);
  }

  if (online) {
    const v = cfg.view;
    S.myId = v.me.id; S.role = v.me.role; S.isHost = v.hostId === v.me.id; S.mode = 'versus';
    initFromState(v.game);
  } else {
    S.myId = 'me';
    g = R.createGame({ seed: (Math.random() * 2 ** 31) >>> 0, difficulty: S.diff, mode: S.mode, lives: cfg.lives || undefined, shapes: cfg.shapes || 'off', turnLimit: cfg.turnLimit || 0, players: cfg.players });
    initFromState(g.publicState());
  }

  /* ---------- 統計（GA4，僅送固定維度；沒有設定時完全不動作） ---------- */
  const GA = window.GameAnalytics;
  const gaKey = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const gaParams = () => ({ mode: online ? 'online' : S.mode === 'solo' ? 'solo' : 'ai', players: S.players.length, difficulty: S.diff, variant: S.shapes, spectator: S.role === 'spectator' });
  GA && GA.start(gaParams(), gaKey);

  /* ---------- 左側資訊欄 ---------- */
  const summaryBox = h('div', { class: 'sum' });
  const chat = online ? Chat({ onSend: (text) => emitQuiet('chat:send', { text }) }) : null;
  if (chat && cfg.view) chat.set(cfg.view.chat);
  const unreadBadge = h('span', { class: 'btn-badge', hidden: true });

  function section(title, body, open = true, extra, cls) {
    const wrap = h('section', { class: 'acc' + (open ? ' open' : '') + (cls ? ' ' + cls : '') });
    const head = h('button', { type: 'button', class: 'acc-head', 'aria-expanded': String(open) }, h('span', null, title), extra || null, h('span', { class: 'acc-caret', 'aria-hidden': 'true' }, '▾'));
    head.addEventListener('click', () => { const o = !wrap.classList.contains('open'); wrap.classList.toggle('open', o); head.setAttribute('aria-expanded', String(o)); if (o && title === t('聊天室')) { S.unread = 0; syncUnread(); chat.refresh(); } });
    wrap.append(head, h('div', { class: 'acc-body' }, body));
    return wrap;
  }
  const chatSection = online ? section(t('聊天室'), chat.el, true, null, 'acc-chat') : null;
  const aside = h('aside', { class: 'side', 'aria-label': t('資訊欄') },
    h('div', { class: 'side-head' }, h('b', null, t('對局資訊')), IconBtn({ ico: 'chevL', label: t('收合資訊欄'), onClick: () => togglePanel(false), size: 20 })),
    h('div', { class: 'side-body' }, section(t('對局摘要'), ScrollArea(summaryBox, { cls: 'sum-scroll' }), true, null, 'acc-sum'), chatSection));

  function stabClass(v) { return v > 0.55 ? 'ok' : v > 0.25 ? 'warn' : 'bad'; }
  function renderSummary() {
    summaryBox.textContent = '';
    const solo = S.mode === 'solo';
    const me = playerOf(S.myId);
    summaryBox.append(h('div', { class: 'sum-badges' }, Badge(solo ? t('單人挑戰') : online ? t('線上輪流') : t('對電腦輪流'), 'wood'), Badge(diffLabel(S.diff), 'toy')));
    summaryBox.append(h('div', { class: 'sum-stats' },
      h('div', { class: 'stat' }, h('small', null, t('目前樓層')), h('b', null, S.height, h('em', null, t(' 層', { n: S.height })))),
      h('div', { class: 'stat' }, h('small', null, solo ? t('本局最高') : t('回合')), h('b', null, solo ? S.peak : S.turnNo, h('em', null, solo ? t(' 層', { n: S.peak }) : t(' 次', { n: S.turnNo }))))));
    if (solo) summaryBox.append(h('div', { class: 'stat wide' }, h('small', null, t('得分')), h('b', null, me ? me.score : 0), S.combo > 1 ? h('em', { class: 'combo' }, t(' 完美連擊 ×{combo}', { combo: S.combo })) : null));
    summaryBox.append(h('div', { class: 'stab-box' }, h('small', null, t('穩定度（太低樓會倒）')), h('div', { class: 'stab ' + stabClass(S.stability), role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(S.stability * 100) }, h('i', { style: { width: Math.round(S.stability * 100) + '%' } }))));
    if (solo) summaryBox.append(h('div', { class: 'sum-note' }, t('歷史最高 {v0} 層', { v0: Math.max(store.best(S.diff, S.shapes), S.peak) })));
    const ul = h('ul', { class: 'plist' });
    for (const p of S.players) {
      const mine = p.id === S.myId, turn = p.id === S.turnId && !S.over;
      ul.append(h('li', { class: 'pl' + (turn ? ' turn' : '') + (p.alive ? '' : ' out') },
        h('span', { class: 'dot', style: { background: PLAYER_COLORS[p.seat % PLAYER_COLORS.length] } }),
        h('span', { class: 'pl-name' }, p.name, mine ? h('i', null, t('（你）')) : null, p.kind === 'ai' ? h('i', null, `・${diffLabel(p.ai)}`) : null),
        p.alive ? Hearts(p.lives, Math.max(S.maxLives, p.lives)) : h('span', { class: 'pl-out' }, t('淘汰')),
        turn ? h('span', { class: 'pl-turn' }, t('輪到')) : null));
    }
    summaryBox.append(ul);
    if (S.role === 'spectator') summaryBox.append(h('div', { class: 'sum-note spec' }, icon('eye', 16), t(' 你是觀戰者，可以聊天但不能操作')));
    summaryBox.append(h('div', { class: 'keys' },
      h('div', null, KeyCap(t('空白')), t(' 放下樓層')), h('div', null, KeyCap('Esc'), t(' 選單')),
      h('div', { class: 'keys-note' }, t('點一下螢幕任何位置（滑鼠左鍵或觸控）或按「放下」。樓層重心要落在下方樓層的重疊範圍內，否則整段會倒！約 50～90 層風最強：風會把吊車吹偏，樓層落下時也會被吹走，白框是已算入風的預測落點。'))));
  }
  function syncUnread() { unreadBadge.hidden = !S.unread; unreadBadge.textContent = S.unread > 9 ? '9+' : S.unread; }

  /* ---------- 舞台：上方列、操作列、結算 ---------- */
  const banner = h('div', { class: 'turn-banner', role: 'status' });
  const timerEl = h('span', { class: 'turn-timer' });
  const infoBtn = Btn({ ico: 'info', label: t('資訊'), size: 'sm', onClick: () => togglePanel(), badge: null, cls: 'info-btn' });
  infoBtn.append(unreadBadge);
  const menuBtn = IconBtn({ ico: 'home', label: online ? t('離開房間') : t('暫停選單'), onClick: () => openMenu(), size: 20, cls: 'menu-btn' });
  menuBtn.dataset.back = '1';
  const heightChip = h('div', { class: 'hud-chip', role: 'img', 'aria-label': t('目前樓層') }, h('b', null, '1'));
  const towerIco = h('span', { class: 'hud-tower', 'aria-hidden': 'true' });
  towerIco.innerHTML = '<svg viewBox="0 0 24 56" width="30" height="70"><path fill="#f2b632" stroke="#a8741a" stroke-width="1.2" d="M12 1l1.2 8h-2.4L12 1Zm-3.5 9h7l-.8 8h2.3l-.5 6h-3l.6 5h2l1.4 18h-12l1.4-18h2l.6-5h-3l-.5-6h2.3l-.8-8Z"/><rect x="9" y="33" width="6" height="6" rx="3" fill="#fff6c9"/></svg>';
  const hudCol = h('div', { class: 'hud-col' }, towerIco, heightChip);
  const stabMini = h('div', { class: 'stab mini ok', 'aria-hidden': 'true' }, h('i'));
  const starIco = h('span', { class: 'star-ico', 'aria-hidden': 'true' });
  starIco.innerHTML = '<svg viewBox="-12 -12 24 24" width="44" height="44"><path fill="#ffd23c" stroke="#d9941a" stroke-width="1.4" stroke-linejoin="round" d="M0-10l2.9 6.2 6.8.8-5 4.6 1.4 6.7L0 4.8l-6.1 3.5 1.4-6.7-5-4.6 6.8-.8Z"/></svg>';
  const heartsCol = h('div', { class: 'hud-hearts', 'aria-label': t('剩餘愛心') });
  const hudBL = h('div', { class: 'hud-bl' }, hudCol, heartsCol);
  const windChip = h('div', { class: 'wind-chip', role: 'status', 'aria-live': 'off' });
  const windArrow = h('span', { class: 'wind-arrow', 'aria-hidden': 'true' });
  windArrow.innerHTML = '<svg viewBox="0 0 28 18" width="30" height="20"><path fill="currentColor" d="M1 7h17V3.2L27 9l-9 5.8V11H1z"/></svg>';
  const windTxt = h('b', null, ''); const windBars = h('span', { class: 'wind-bars', 'aria-hidden': 'true' }, ...[0, 1, 2, 3, 4].map(() => h('i')));
  windChip.append(windArrow, windTxt, windBars);
  function setWindUI(sw) {
    const w = (sw && sw.wind) || 0, lvl = Math.min(5, Math.round(Math.abs(w) * 5));
    const space = !!(sw && sw.space);
    windChip.classList.toggle('calm', lvl === 0 && !space); windChip.classList.toggle('space', space); windArrow.style.transform = w < 0 ? 'scaleX(-1)' : '';
    windTxt.textContent = space ? t('無重力・磁吸') : lvl === 0 ? t('無風') : t('風 {lvl} 級', { lvl });
    [...windBars.children].forEach((b, i) => b.classList.toggle('on', i < lvl));
    if (space) { windChip.setAttribute('aria-label', t('太空無重力：樓層會被磁力吸向中心，下落與搖晃都變慢')); return; }
    windChip.setAttribute('aria-label', lvl === 0 ? t('目前無風') : t('{v0}吹，風力 {lvl} 級（最大 5 級）', { v0: w > 0 ? t('向右') : t('向左'), lvl }));
  }
  const topbar = h('div', { class: 'topbar' }, h('div', { class: 'tb-left' }, infoBtn, menuBtn), h('div', { class: 'tb-center' }, banner, timerEl), h('div', { class: 'tb-right' }, starIco, stabMini));

  const btnDrop = Btn({ ico: 'drop', label: t('放下'), kind: 'primary', size: 'lg', keycap: t('空白'), onClick: () => drop(), cls: 'drop-btn' });
  const controls = h('div', { class: 'controls' }, btnDrop);
  const specBar = h('div', { class: 'spec-bar' }, icon('eye', 18), h('span', null, t('觀戰中')));
  const statusbar = h('div', { class: 'stage-status' }, hudBL, windChip);
  const view = h('div', { class: 'stage-view' }, canvas, popLayer, topbar, statusbar);
  const stage = h('main', { class: 'stage' }, view, S.role === 'spectator' ? specBar : controls, live);
  const root = h('div', { class: 'game' + (matchMedia('(min-width: 900px)').matches ? ' panel-open' : '') }, aside, stage);

  function togglePanel(force) {
    const open = force == null ? !root.classList.contains('panel-open') : force;
    root.classList.toggle('panel-open', open);
    if (open) { S.unread = 0; syncUnread(); setTimeout(() => chat && chat.refresh(), 260); }
    setTimeout(() => board.resize(), 280); setTimeout(() => board.resize(), 120);
  }

  /* ---------- 操作 ---------- */
  function drop() {
    if (!S.canAct || board.busy || S.over) return;
    if (performance.now() - S.turnStartPerf < 380) return; // 吊車剛換手時避免誤觸
    S.canAct = false; syncControls();
    if (board.turn) board.turn.active = false;
    const d = board.currentD();
    A.sfx.drop(); A.vibrate(14);
    if (!online) { handleDrop(g.drop({ d })); return; }
    emit('game:drop', { d }, 6000).then((r) => { if (!r.ok && !destroyed) { S.canAct = S.turnId === S.myId && !S.over; if (board.turn) board.turn.active = S.canAct; syncControls(); if (r.msg) toast(r.msg); } });
  }
  // 點螢幕任何位置都能「放下」（滑鼠左鍵／觸控），但按鈕、資訊欄、聊天、彈窗、結算層、選單等互動元素自己處理
  const NO_TAP = 'button, a, input, textarea, [role="button"], [role="menu"], [role="menuitemradio"], [role="dialog"], [role="alertdialog"], .side, .modal, .modal-mask, .result, .sel-pop, .gear-wrap, .toast, .sa-bar, .tf';
  function onScreenPointer(e) {
    if (destroyed || (e.pointerType === 'mouse' && e.button !== 0) || e.isPrimary === false) return;
    if (hasModal() || S.resultShown || S.over) return;
    if (e.target && e.target.closest && e.target.closest(NO_TAP)) return;
    if (!root.isConnected) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) { ae.blur(); return; } // 正在打字：先收起輸入，不放下
    if (root.classList.contains('panel-open') && !matchMedia('(min-width: 900px)').matches) { togglePanel(false); return; } // 窄版抽屜開著：點外面只收合
    drop();
  }
  window.addEventListener('pointerdown', onScreenPointer);

  function onKey(e) {
    if (destroyed) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (hasModal()) return;
    if (e.target && e.target.closest && e.target.closest('.gear-wrap, .lang-pop')) { if (e.key === 'Escape' && !document.querySelector('.lang-pop')) { /* 設定／語言鈕上按 Esc 仍開暫停選單 */ } else return; } // 右上角按鈕與語言選單自己處理 Enter／空白／方向鍵
    if (e.key === 'Escape' && !S.over && !S.resultShown) { e.preventDefault(); openMenu(); return; }
    if (!S.canAct || S.over) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); if (document.activeElement && document.activeElement.blur && (e.key === ' ' || e.key === 'Enter')) document.activeElement.blur(); drop(); }
  }
  window.addEventListener('keydown', onKey);

  function syncControls() { btnDrop.disabled = !(S.canAct && !board.busy); controls.classList.toggle('idle', btnDrop.disabled); }

  /* ---------- 回合 / 結果處理 ---------- */
  function beginTurn(info) {
    if (destroyed || S.over) return;
    turnToken++;
    S.turnId = info.playerId; S.swing = info.swing;
    const me = S.turnId === S.myId && S.role === 'player';
    S.canAct = me; S.sec = info.sec || 0;
    S.deadline = info.deadline || (S.sec ? Date.now() + S.sec * 1000 : 0);
    S.turnStartPerf = performance.now();
    board.setTurn({ swing: info.swing, t0: info.t0, offset: info.offset || 0, active: me, seat: seatOf(S.turnId) });
    setWindUI(info.swing);
    if (info.stability) { S.stability = info.stability.stability; board.setStability(info.stability.maxRatio); }
    renderSummary(); syncControls();
    const p = playerOf(S.turnId);
    live.textContent = me ? t('輪到你了，吊車正在擺動') : t('輪到 {v0}', { v0: p ? p.name : '' });
    if (me) { A.sfx.turn(); A.vibrate([20, 40, 20]); }
    if (!online && p && p.kind === 'ai') aiTurn(p, turnToken);
  }

  async function aiTurn(p, token) {
    S.thinking = true; updateBanner();
    const rng = R.mulberry32(((g.seed ^ Math.imul(g.turnNo + 1, 2654435761)) >>> 0) || 1);
    let mv;
    try { mv = HouseAI.chooseMove(g, p.ai || 'normal', rng, { tNow: 0 }); } catch (e) { mv = { d: 0, thinkMs: 1000 }; }
    await sleep(Math.max(500, mv.thinkMs || 800));
    while (S.paused && !destroyed) await sleep(120);
    if (destroyed || token !== turnToken) return;
    S.thinking = false;
    A.sfx.drop();
    handleDrop(g.drop({ d: mv.d }));
  }

  function handleDrop(res) {
    S.canAct = false; S.pending = null; syncControls();
    const before = playerOf(res.playerId);
    const prevLives = before ? before.lives : 0;
    board.playDrop(res, {
      onImpact: (str) => { A.sfx.tock(str); A.vibrate(Math.round(6 + str * 14)); },
      onPerfect: (pos) => { A.sfx.perfect(res.combo); showPop(pos, res); },
      onFall: () => { A.sfx.fall(); },
      onDone: () => afterDrop(res, prevLives),
    });
    syncControls();
  }

  function showPop(pos, res) {
    if (store.get().reduceMotion) return;
    const pr = board.project(pos.x, pos.y, pos.z);
    const el = h('div', { class: 'pop' + (res.combo >= 3 ? ' big' : ''), style: { left: pr.x + 'px', top: pr.y + 'px' } }, res.combo > 1 ? t('完美 ×{combo}！', { combo: res.combo }) : t('完美！'), h('small', null, `+${res.gain}`));
    popLayer.append(el); setTimeout(() => el.remove(), 1300);
  }

  function afterDrop(res, prevLives) {
    if (destroyed) return;
    S.players = res.players.map((p) => ({ ...p }));
    S.height = res.height; S.peak = Math.max(S.peak, res.height); S.turnNo = res.no; S.combo = res.combo;
    S.stability = res.stability.stability; board.setStability(res.stability.maxRatio);
    const p = playerOf(res.playerId);
    if (res.toppled) {
      const lost = p && p.lives < prevLives;
      const cnt = res.fallen.length;
      toast(`${p ? p.name : ''} ${res.missed ? t('沒接到樓層') : t('讓 {cnt} 層樓倒了', { cnt })}${lost ? t('，失去 1 顆愛心') : ''}`);
      if (res.playerId === S.myId) { A.sfx.lose(); A.vibrate([60, 40, 60]); }
      if (p && !p.alive && !res.over) toast(t('{name} 被淘汰了', { name: p.name }));
    }
    renderSummary();
    A.setAltitude(board.altitude);
    if (res.over) {
      S.over = true; S.winnerId = res.winnerId; S.summit = res.summit; S.canAct = false; S.turnId = null;
      if (res.summit) board.confettiAtTop();
      renderSummary();
      setTimeout(showResult, res.summit ? 1200 : 650);
      return;
    }
    if (!online) {
      S.turnId = res.nextPlayerId;
      setTimeout(() => beginTurn({ playerId: res.nextPlayerId, swing: res.nextSwing, t0: Date.now(), offset: 0, sec: g.turnSec || 0 }), 150);
    } else if (S.pending) { const t = S.pending; S.pending = null; beginTurn(t); }
    else { S.turnId = res.nextPlayerId; renderSummary(); }
  }

  /* ---------- 結算 overlay：疊在遊戲畫面上，不卸載 3D 場景 ---------- */
  let resultEl = null;
  function showResult() {
    hideToast();
    if (destroyed || resultEl) return;
    S.resultShown = true;
    if (GA) GA.end({ result: S.mode === 'solo' ? (S.summit ? 'complete' : 'dnf') : S.winnerId ? (S.winnerId === S.myId ? 'win' : 'lose') : 'draw', variant: S.shapes }, gaKey);
    const solo = S.mode === 'solo';
    const me = playerOf(S.myId);
    let title, sub, tone = 'lose';
    if (solo) {
      store.set({ played: store.get().played + 1 });
      S.newBest = store.setBest(S.diff, S.peak, S.shapes);
      title = S.summit ? t('登上天際！') : t('挑戰結束'); sub = t('最高蓋到 {peak} 層', { peak: S.peak }); tone = S.summit || S.newBest ? 'win' : 'plain';
    } else if (S.winnerId) {
      const win = S.winnerId === S.myId;
      title = S.role === 'spectator' ? t('{v0} 獲勝', { v0: nameOf(S.winnerId) }) : win ? t('你贏了！') : t('{v0} 獲勝', { v0: nameOf(S.winnerId) });
      sub = S.summit ? t('大家一起登頂，由愛心和得分決勝') : win ? t('你是最後留下來的人') : t('樓倒太多次的人出局了'); tone = win ? 'win' : S.role === 'spectator' ? 'plain' : 'lose';
    } else { title = S.summit ? t('登頂平手！') : t('對局結束'); sub = ''; tone = 'plain'; }
    let unlocked = [];
    if (S.role !== 'spectator') {
      const rec = recordGame(store.get(), { mode: solo ? 'solo' : online ? 'online' : 'ai', peak: S.peak, bestCombo: S.bestCombo, win: !!S.winnerId && S.winnerId === S.myId, me }, Date.now());
      store.set({ stats: rec.stats, ach: rec.ach }); unlocked = rec.unlocked;
    }
    (tone === 'win' ? A.sfx.win : A.sfx.lose)();
    if (tone === 'win') board.confettiAtTop();

    const rows = h('ul', { class: 'res-list' }, S.players.map((p) => h('li', { class: p.id === S.winnerId ? 'win' : '' },
      h('span', { class: 'dot', style: { background: PLAYER_COLORS[p.seat % PLAYER_COLORS.length] } }), h('span', null, p.name, p.id === S.myId ? t('（你）') : ''),
      p.id === S.winnerId ? icon('crown', 18) : null, h('em', null, t('{score} 分・倒 {topples} 次', { score: p.score, topples: p.topples })))));
    const statLine = h('div', { class: 'res-stats' },
      h('div', null, h('small', null, solo ? t('最高樓層') : t('塔高')), h('b', null, (solo ? S.peak : S.height) + t(' 層', { n: solo ? S.peak : S.height }))),
      h('div', null, h('small', null, solo ? t('得分') : t('總回合')), h('b', null, solo ? (me ? me.score : 0) : S.turnNo)),
      solo ? h('div', null, h('small', null, t('最佳連擊')), h('b', null, '×' + S.bestCombo)) : null);

    const again = Btn({ label: t('再來一局'), kind: 'primary', size: 'lg', block: true, onClick: () => doAgain(again) });
    const room = Btn({ label: t('回到房間'), size: 'md', block: true, onClick: () => exitTo('room') });
    const home = Btn({ label: t('回到首頁'), size: 'md', block: true, onClick: () => exitTo('home') });
    if (online && !S.isHost && S.role === 'player') again.querySelector('.btn-label').textContent = t('再來一局（準備）');
    if (online && S.role === 'spectator') { again.disabled = true; again.title = t('觀戰者無法開局，請到房間入座'); }
    resultEl = h('div', { class: 'result', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('結算') }, ScrollArea(h('div', { class: 'res-wrap' },
      h('div', { class: `res-card ${tone}`, 'data-result-share': '' },
        h('h2', null, title), sub ? h('p', { class: 'res-sub' }, sub) : null,
        S.newBest ? h('div', { class: 'res-new' }, t('新紀錄！')) : null,
        unlocked.length ? h('ul', { class: 'res-ach' }, unlocked.map((id) => h('li', null, icon('trophy', 16), h('b', null, ACH_TEXT[id][0]), h('small', null, ACH_TEXT[id][1])))) : null,
        statLine, solo ? null : rows,
        h('div', { class: 'res-actions' }, again, room, home),
        h('p', { class: 'res-hint', id: 'res-hint' }, !online ? t('「回到房間」會回到開局設定') : S.isHost ? t('房主按「再來一局」立即開局（需全員準備）') : t('按「再來一局」代表你已準備好')))), { cls: 'res-scroll' }));
    stage.append(resultEl);
    resultEl.setAttribute('tabindex', '-1'); // 焦點放在對話框本身，避免玩家連按空白時誤觸「再來一局」
    setTimeout(() => resultEl.focus({ preventScroll: true }), 60);
    resultEl.again = again;
  }

  async function doAgain(btn) {
    if (!online) { cfg.onAgain && cfg.onAgain(); return; }
    if (S.isHost) {
      const r = await emit('room:start', {});
      if (!r.ok) toast(r.msg || t('還不能開始'));
    } else {
      const r = await emit('room:ready', { ready: true });
      if (r.ok) { btn.disabled = true; btn.querySelector('.btn-label').textContent = t('已準備，等待房主…'); }
    }
  }
  function exitTo(where) { cfg.onExit && cfg.onExit(where); }

  function openMenu() {
    if (hasModal() || S.over || S.resultShown) return;
    S.paused = !online;
    const m = Modal({
      title: online ? t('選單') : t('暫停'), cls: 'modal-sm',
      body: h('p', { class: 'muted' }, online ? t('對局不會因為你開選單而暫停。') : t('遊戲已暫停，吊車停在原地。')),
      actions: [
        Btn({ label: t('繼續'), kind: 'primary', block: true, onClick: () => m.close() }),
        !online ? Btn({ label: t('重新開始'), block: true, onClick: () => { m.close(true); S.paused = false; cfg.onAgain && cfg.onAgain(); } }) : null,
        Btn({ label: online ? t('離開房間回首頁') : t('回到首頁'), kind: 'danger', block: true, onClick: () => { m.close(true); S.paused = false; exitTo('home'); } }),
      ],
      onClose: () => { S.paused = false; },
    });
  }

  /* ---------- 橫幅 ---------- */
  function updateBanner() {
    let text, color = '#35507a';
    if (S.over) text = S.summit ? t('登頂！') : t('對局結束');
    else if (!S.turnId) text = t('準備開始…');
    else if (S.mode === 'solo') text = S.canAct ? t('抓準時機，點一下放下！') : t('準備中…');
    else if (S.canAct) { text = t('輪到你了！點一下放下'); color = colorOf(S.myId); }
    else { const p = playerOf(S.turnId); text = `${p ? p.name : ''}${p && p.kind === 'ai' ? t(' 瞄準中…') : t(' 正在操作吊車')}`; color = colorOf(S.turnId); }
    banner.textContent = text; banner.style.setProperty('--accent', color);
    if (S.over || !S.deadline || !S.sec || (playerOf(S.turnId) || {}).kind === 'ai') timerEl.textContent = ''; // 電腦的回合不倒數（它不受限時約束）
    else { const left = Math.max(0, Math.ceil((S.deadline - Date.now()) / 1000)); timerEl.textContent = `${left}`; timerEl.classList.toggle('low', left <= 5); }
    heightChip.firstChild.textContent = S.height;
    const me = playerOf(S.myId);
    const lv = me ? me.lives : 0, mx = Math.max(S.maxLives, lv);
    const key = lv + '/' + mx; if (heartsCol.dataset.k !== key) { heartsCol.dataset.k = key; heartsCol.textContent = ''; heartsCol.append(Hearts(lv, mx)); }
    stabMini.className = 'stab mini ' + stabClass(S.stability); stabMini.firstChild.style.width = Math.round(S.stability * 100) + '%';
  }

  /* ---------- 主迴圈 ---------- */
  let raf = 0, bannerLast = 0, last = performance.now(), creakAcc = 0;
  function tick(now) {
    if (destroyed) return;
    const real = (now - last) / 1000, dt = Math.min(0.05, real); last = now;
    board.reduceMotion = reduceMotion(); board.guide = store.get().guide;
    if (S.paused) { S.deadline += real * 1000; if (board.turn) board.turn.t0 += real * 1000; } // 暫停期間用真實經過時間補回，畫面很慢時倒數也不會偷跑
    board.update(dt); board.render();
    if (now - bannerLast > 200) { // 用真實時間（不是被夾住的 dt），畫面很慢時倒數與逾時放下也不會拖延
      bannerLast = now; updateBanner();
      if (!online && S.canAct && S.deadline && Date.now() > S.deadline && !S.paused) { S.turnStartPerf = 0; drop(); }
    }
    creakAcc += dt;
    if (creakAcc > 2.4 && S.stability < 0.3 && !S.over) { creakAcc = 0; A.sfx.creak(); }
    A.setAltitude(board.altitude);
    raf = requestAnimationFrame(tick);
  }
  const ro = new ResizeObserver(() => board.resize());

  /* ---------- 外部事件（線上） ---------- */
  const api = {
    el: root,
    debug: { S, board, get g() { return g; } },
    mount() {
      ro.observe(canvas); board.resize(); renderSummary(); updateBanner(); syncControls();
      raf = requestAnimationFrame(tick);
      if (!online) setTimeout(() => { if (!destroyed) beginTurn({ playerId: g.currentPlayer().id, swing: g.swingSpec, t0: Date.now(), offset: 0, sec: g.turnSec || 0 }); }, 500);
      else {
        const v = cfg.view;
        if (v.status === 'ended') { S.over = true; S.winnerId = v.game && v.game.winnerId; setTimeout(showResult, 300); }
        else if (v.turn && v.game && v.game.swing) {
          // 重連／中途加入：吊車相位由快照的 swing 與回合開始時間推回
          beginTurn({ playerId: v.turn.playerId, swing: v.game.swing, t0: v.turn.t0, offset: v.turn.now ? v.turn.now - Date.now() : 0, deadline: v.turn.deadline, sec: (v.game && v.game.turnSec) || R.DIFFICULTIES[S.diff].turnSec });
        }
      }
    },
    destroy() {
      destroyed = true; GA && GA.reset(); cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onScreenPointer);
      try { board.dispose(); } catch (e) { /* ignore */ }
    },
    onTurn(info) {
      const t = { ...info, offset: (info.now || Date.now()) - Date.now() };
      if (board.busy) S.pending = t; else beginTurn(t);
    },
    onDrop(res) { if (S.over && !board.busy) return; handleDrop(res); },
    onPreview() {},
    onChat(m) { chat && chat.add(m); if (!root.classList.contains('panel-open') && !m.sys) { S.unread++; syncUnread(); } },
    onState(view) {
      S.view = view; S.isHost = view.hostId === (view.me && view.me.id); S.role = view.me ? view.me.role : S.role;
      S.spectators = view.members.filter((m) => m.role === 'spectator').length;
      if (view.game && !board.busy && !S.over) {
        S.players = view.game.players.map((p) => ({ ...p }));
        if (view.game.floors.length !== board.entries.length) board.setFloors(view.game.floors);
        S.height = view.game.floors.length; S.peak = view.game.peak; S.turnNo = view.game.turnNo;
        renderSummary();
      }
      if (resultEl) {
        const hint = resultEl.querySelector('#res-hint');
        if (hint) hint.textContent = S.isHost ? t('房主按「再來一局」立即開局（需全員準備）') : t('按「再來一局」代表你已準備好');
      }
    },
    onForfeit(d) { S.players = d.players.map((p) => ({ ...p })); S.over = true; S.winnerId = d.winnerId; S.canAct = false; syncControls(); renderSummary(); if (!board.busy) setTimeout(showResult, 300); },
  };
  return api;
}
