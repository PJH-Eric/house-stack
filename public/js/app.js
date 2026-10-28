/* 疊疊高樓 — 主程式：路由、首頁、開局設定、教學、大廳、房間、設定彈窗、網路事件接線。 */
import { Outage } from './outage.js';
import { Latency } from './latency.js';
import { LangButton } from './langmenu.js';
import { t, withLang, onLangChange } from './i18n.js';
import { h, icon, Btn, IconBtn, Toggle, Slider, Stepper, Select, TextField, ScrollArea, Modal, Badge, Hearts, toast, Panel, KeyCap } from './ui.js';
import { Board, webglSupported } from './art.js';
import * as A from './audio.js';
import { store } from './store.js';
import { CONFIG } from './config.js';
import { app, DIFF_OPTS, DIFF_DESC, AI_OPTS, diffLabel, ensureNick, nick, inviteLink, reduceMotion, randomNick } from './core.js';
import * as net from './net.js';
import { GameScreen } from './game.js';
import { Chat } from './chat.js';

const R = window.HouseRules;
const rootEl = document.getElementById('app');
let cur = null; // { name, el, destroy?, ...handlers }
let loadingTimer = 0;

/* ---------------- 路由 ---------------- */
function go(name, params = {}) {
  if (cur && cur.destroy) cur.destroy();
  if (name !== 'lobby' && name !== 'room' && !(name === 'game' && app.online)) net.disconnect();
  document.querySelectorAll('.sel-pop').forEach((e) => e.remove());
  rootEl.textContent = '';
  const builders = { home, setup, tutorial, lobby, room, game };
  cur = builders[name](params) || {};
  cur.name = name;
  app.screen = cur;
  rootEl.append(cur.el);
  rootEl.dataset.screen = name;
  Outage.setScreen(name);
  Latency.setActive(CONFIG.onlineAvailable && (name === 'lobby' || name === 'room' || (name === 'game' && !!app.online)));
  if (window.GameAnalytics) window.GameAnalytics.pageView(name);
  cur.mount && cur.mount();
  if (name !== 'game') A.setAltitude(0);
  const f = cur.el.querySelector('[data-autofocus]');
  f && f.focus({ preventScroll: true });
  if (name !== 'home' && !(history.state && history.state.app)) { try { history.pushState({ app: true }, ''); } catch (e) { /* ignore */ } } // 讓手機的「返回」鍵先退回上一層，而不是直接離開網站
}
app.go = go;
window.addEventListener('popstate', () => {
  if (!cur || cur.name === 'home') return;
  const modal = document.querySelector('.modal');
  if (modal) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  else { const b = cur.el.querySelector('[data-back]'); b ? b.click() : go('home'); }
  if (cur && cur.name !== 'home') { try { history.pushState({ app: true }, ''); } catch (e) { /* ignore */ } }
});

/* ---------------- 共用：頁面外框 ---------------- */
function Page({ title, back, children, narrow, cls }) {
  const backBtn = back ? Btn({ ico: 'chevL', label: back.label || t('返回'), size: 'sm', onClick: back.fn }) : null;
  if (backBtn) backBtn.dataset.back = '1';
  const head = h('header', { class: 'page-head' }, backBtn || h('span'), h('h1', null, title), h('span', { class: 'page-head-gap' }));
  const sa = ScrollArea(h('div', { class: 'page-inner' + (narrow ? ' narrow' : '') }, children), { cls: 'page-scroll' });
  return h('div', { class: 'page' + (cls ? ' ' + cls : '') }, head, sa);
}
function Field(label, control) { return h('div', { class: 'field' }, h('label', { class: 'field-label' }, label), control); }

/* ---------------- 首頁 ---------------- */
function home() {
  const canvas = h('canvas', { class: 'hero-canvas', 'aria-hidden': 'true' });
  const gm = R.createGame({ seed: 4, difficulty: 'easy', mode: 'solo' });
  for (const d of [0, 0.3, -0.5, 0.2, 0, 0.6, -0.3, 0.1, 0, -0.4]) gm.drop({ d });
  let board, raf = 0, last = performance.now(), dead = false;
  const SHAPE_TAG = { off: '', fixed: t('・固定形狀'), every: t('・每層不同') };
  const bests = Object.keys(R.DIFFICULTIES).flatMap((k) => ['off', 'fixed', 'every'].filter((sh) => store.best(k, sh)).map((sh) => t('{v0}{v1} {v2} 層', { v0: diffLabel(k), v1: SHAPE_TAG[sh], v2: store.best(k, sh) })));
  const online = CONFIG.onlineAvailable;
  const card = h('div', { class: 'home-card' },
      h('div', { class: 'logo' }, h('span', { class: 'logo-blk b1' }, t('疊')), h('span', { class: 'logo-blk b2' }, t('疊|2')), h('span', { class: 'logo-blk b3' }, t('高')), h('span', { class: 'logo-blk b4' }, t('樓'))),
      h('p', { class: 'tagline' }, t('操作吊車把小房子一層層疊高，重心歪了整棟會倒！')),
      h('nav', { class: 'home-menu', 'aria-label': t('主選單') },
        Btn({ label: t('單人挑戰'), ico: 'play', kind: 'primary', size: 'lg', block: true, onClick: () => go('setup', { mode: 'solo' }), cls: 'autofocus' }),
        Btn({ label: t('對電腦輪流'), size: 'lg', block: true, onClick: () => go('setup', { mode: 'vs' }) }),
        Btn({ label: t('線上對戰'), size: 'lg', block: true, onClick: () => go('lobby'), title: online ? '' : t('尚未設定線上伺服器') }),
        Btn({ label: t('怎麼玩'), size: 'lg', block: true, onClick: () => go('tutorial') })),
      bests.length ? h('p', { class: 'home-best' }, t('個人最高：'), bests.join('　')) : null,
      !online ? h('p', { class: 'home-note' }, t('提示：尚未設定線上伺服器，線上對戰需要部署後端。')) : null);
  const lobbyLink = h('a', { class: 'lobby-link', href: withLang('https://pjh-eric.github.io/game-lobby/') }, icon('chevL', 16), h('span', null, t('回遊戲大廳')));
  const el = h('div', { class: 'home' }, canvas, lobbyLink, ScrollArea(h('div', { class: 'home-wrap' }, card), { cls: 'home-scroll' }));
  el.querySelector('.autofocus').dataset.autofocus = '1';
  return {
    el,
    mount() {
      if (!webglSupported()) { canvas.remove(); el.classList.add('no-gl'); return; }
      try {
        board = new Board(canvas, { demo: true });
      } catch (e) { canvas.remove(); el.classList.add('no-gl'); return; }
      const st = gm.publicState();
      board.setConfig(st); board.setFloors(st.floors); board.reduceMotion = reduceMotion(); board.setStability(0.2);
      board.setTurn({ swing: st.swing, t0: Date.now(), offset: 0, active: false, seat: 0 });
      const loop = (n) => { if (dead) return; const dt = Math.min(0.05, (n - last) / 1000); last = n; board.viewShift = canvas.clientWidth > 900 ? 0.2 : 0; board.resize(); board.update(dt); board.render(); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    },
    destroy() { dead = true; cancelAnimationFrame(raf); try { board && board.dispose(); } catch (e) { /* ignore */ } },
  };
}

/* ---------------- 開局設定（單人／對電腦） ---------------- */
const SHAPE_OPTS = [{ value: 'off', label: t('一般（方正樓層）') }, { value: 'fixed', label: t('隨機一種形狀（整場相同）') }, { value: 'every', label: t('整場都不規則（每層不同）') }];
const SHAPE_DESC = { off: t('每層都是標準大小。'), fixed: t('開局隨機決定一種寬窄高矮，整場每層都長這樣。'), every: t('每一層的寬窄高矮都不一樣，越高變化越大。') };
const TURN_OPTS = R.TURN_LIMITS.map((n) => ({ value: String(n), label: t('{n} 秒', { n }) }));
const turnDesc = () => t('時間到會自動在吊車目前的位置放下，可能因此放偏。');
const setupMem = { diff: 'normal', ais: ['normal'], shapes: 'off', turnLimit: R.DEFAULT_TURN_SEC };
function setup({ mode }) {
  const solo = mode === 'solo';
  const nameTf = TextField({ value: ensureNick(), maxLength: 12, label: t('暱稱'), onInput: (v) => store.set({ nick: v.slice(0, 12) }) });
  const dSel = Select({ label: t('難度'), value: setupMem.diff, options: DIFF_OPTS, onChange: (v) => { setupMem.diff = v; desc.textContent = DIFF_DESC[v]; refreshLives(); showRec(); } });
  const desc = h('p', { class: 'field-desc' }, DIFF_DESC[setupMem.diff]);
  const livesHint = h('p', { class: 'field-desc' }); // 愛心數由難度自動決定，不開放設定
  const shDesc = h('p', { class: 'field-desc' }, SHAPE_DESC[setupMem.shapes]);
  const shSel = Select({ label: t('樓層形狀'), value: setupMem.shapes, options: SHAPE_OPTS, onChange: (v) => { setupMem.shapes = v; shDesc.textContent = SHAPE_DESC[v]; showRec(); } });
  const tlDesc = h('p', { class: 'field-desc' });
  const tlSel = Select({ label: t('每回合限時'), value: String(setupMem.turnLimit), options: TURN_OPTS, onChange: (v) => { setupMem.turnLimit = +v; refreshLives(); } });
  function refreshLives() {
    tlDesc.textContent = turnDesc(solo ? 'solo' : 'versus', setupMem.diff, setupMem.turnLimit);
    const d = R.DIFFICULTIES[setupMem.diff];
    const def = solo ? d.lives : d.versusLives;
    livesHint.textContent = t('愛心：依難度自動給予 {def} 顆', { def });
  }
  const aiBox = h('div', { class: 'ai-rows' });
  const aiCount = Stepper({ label: t('電腦數量'), value: setupMem.ais.length, min: 1, max: 3, onChange: (v) => { while (setupMem.ais.length < v) setupMem.ais.push('normal'); setupMem.ais.length = v; drawAis(); } });
  function drawAis() {
    aiBox.textContent = '';
    setupMem.ais.forEach((lv, i) => aiBox.append(Select({ label: t('電腦 {v0}', { v0: i + 1 }), value: lv, options: AI_OPTS, onChange: (v) => { setupMem.ais[i] = v; } })));
  }
  const rec = h('p', { class: 'field-desc' }, '');
  function showRec() { const b = store.best(setupMem.diff, setupMem.shapes); rec.textContent = b ? t('這個難度與形狀的最高紀錄：{b} 層', { b }) : ''; }
  dSel.addEventListener('click', () => {});
  const start = Btn({ label: t('開始'), kind: 'primary', size: 'lg', block: true, onClick: () => startLocal(), cls: 'autofocus' });
  function startLocal() {
    const me = nick() || ensureNick();
    const players = [{ id: 'me', name: me, kind: 'human' }];
    if (!solo) setupMem.ais.forEach((lv, i) => players.push({ id: 'ai' + (i + 1), name: t('電腦{v0}', { v0: i + 1 }), kind: 'ai', ai: lv }));
    A.unlock(); A.sfx.click();
    go('game', { kind: 'local', mode: solo ? 'solo' : 'versus', diff: setupMem.diff, players, shapes: setupMem.shapes, turnLimit: setupMem.turnLimit, setupMode: mode });
  }
  drawAis(); refreshLives(); showRec();
  const body = [
    Field(t('暱稱'), nameTf), dSel, desc, livesHint, rec, shSel, shDesc, tlSel, tlDesc,
    solo ? h('p', { class: 'rule-note' }, t('單人規則：樓層重心不穩、整段倒塌（或完全沒接到）就失去一顆愛心，愛心用完結束，看你最高能蓋到幾層、拿到多少分。連續完美對齊會有連擊加分。')) : h('div', null, aiCount, aiBox, h('p', { class: 'rule-note' }, t('輪流規則：大家輪流操作吊車，在同一棟樓上加蓋一層。讓樓倒塌的人失去一顆愛心，愛心用完就淘汰，最後留下的人獲勝。樓沒有上限，風在約 50～90 層最強。'))),
    start,
  ];
  const page = Page({ title: solo ? t('單人挑戰') : t('對電腦輪流'), back: { fn: () => go('home') }, children: body, narrow: true });
  page.querySelector('.autofocus').dataset.autofocus = '1';
  return { el: page };
}

/* ---------------- 教學（純文字） ---------------- */
function tutorial() {
  const steps = [
    [t('目標'), t('操作吊車，把一層層的小房子疊在一起蓋成高樓。樓越高，吊車擺得越快，背景會依高度一路變化：鳥群、直升機、雨雲、客機，最後到太空與行星。')],
    [t('怎麼放'), t('輪到你時，吊車會左右擺盪，新的樓層掛在鉤子上。在你覺得對齊的瞬間，點一下螢幕任何位置、按「放下」按鈕或空白鍵。畫面上的白色框框是落點，變成綠色代表「完美」。')],
    [t('會不會倒？'), t('樓層不會被裁切，而是看「重心」：每一層以上所有樓層的重心，必須落在它與下方樓層的重疊範圍內，否則從那一層以上整段倒塌。完全沒接到就直接掉下去。畫面上方的星星進度條是穩定度，越低樓晃得越厲害。')],
    [t('單人挑戰'), t('樓倒了會失去一顆愛心，愛心用完就結束。連續完美對齊有連擊加分；樓層沒有上限，越蓋越高會經過鳥群、雲層、太空與行星。紀錄會存在這台裝置上。')],
    [t('輪流對戰'), t('電腦或線上好友輪流在同一棟樓上加蓋。讓樓倒塌的人失去一顆愛心，沒有愛心就淘汰，最後留下的人獲勝。每個人蓋的樓層頂板下有各自的顏色細帶，方便看出誰蓋的。')],
    [t('小技巧'), t('先蓋穩再求快：每次都對得很準，重心就會一直在中間。如果樓已經歪向一邊，下一層故意往反方向偏一點，可以把重心拉回來。在白色框框變成綠色的瞬間放下，就是「完美」。')],
    [t('風'), t('樓蓋得越高風越大（約 50～90 層最強），而且有陣風：風會把吊車的擺盪中心吹偏，樓層放下後在空中還會被吹走一小段。看右下角的風向與風力，先預判再放，白色框框會顯示已經算入風的預測落點。風向與風速每一回合都不固定。到了太空（約 140 層）就沒有風了。電腦對手也會判斷風，只是難度越低誤差越大。')],
    [t('樓層形狀'), t('開局設定可以選樓層形狀：「一般」每層一樣大；「隨機一種形狀」開局隨機決定寬窄高矮，整場都是這個形狀；「整場都不規則」每層的寬窄高矮都不同。吊車手上的樓層就是下一層的樣子，白色框框也跟著它的寬度。窄的樓層重疊區小，比較難接穩。')],
    [t('太空無重力'), t('到了太空（約 140 層）沒有風，改成無重力：放下的樓層會被磁力吸向中心（偏移縮小），下落與搖晃都變慢、樓房會緩緩漂浮；倒塌時殘骸會慢慢飄散。白色框框會顯示磁吸之後的預測落點，右下角會顯示「無重力・磁吸」。')],
    [t('線上房間'), t('建立房間後可以分享「玩家連結」邀請朋友加入，或分享「觀戰連結」讓人觀看；房間裡可以加入電腦。沒有真人玩家時房間會自動關閉。')],
  ];
  const body = [...steps.map(([t, d], i) => h('section', { class: 'tut' }, h('span', { class: 'tut-n' }, i + 1), h('div', null, h('h3', null, t), h('p', null, d))))];
  body.push(h('div', { class: 'keys wide' }, h('div', null, KeyCap(t('空白')), t(' 放下樓層')), h('div', null, KeyCap('Esc'), t(' 選單'))));
  return { el: Page({ title: t('怎麼玩'), back: { fn: () => go('home') }, children: body, narrow: true }) };
}

/* ---------------- 設定彈窗（右上角齒輪） ---------------- */
function applySettings(s) {
  A.configure({ music: s.music, musicVol: s.musicVol / 100, sfx: s.sfx, sfxVol: s.sfxVol / 100 });
  A.setVibrate(s.vibrate);
  A.bgm(s.music);
  document.documentElement.classList.toggle('reduce-motion', !!s.reduceMotion);
}
store.subscribe(applySettings);
applySettings(store.get());

let settingsModal = null;
function openSettings() {
  if (settingsModal) return;
  const s = store.get();
  const tg = {
    music: Toggle({ label: t('背景音樂'), value: s.music, onChange: (v) => store.set({ music: v }) }),
    sfx: Toggle({ label: t('音效'), value: s.sfx, onChange: (v) => { store.set({ sfx: v }); if (v) A.sfx.tock(0.6); } }),
    vib: Toggle({ label: t('震動'), value: s.vibrate, hint: t('放下與掉落時震動（需裝置支援）'), onChange: (v) => store.set({ vibrate: v }) }),
    rm: Toggle({ label: t('減少動態'), value: s.reduceMotion, hint: t('關閉畫面晃動、灰塵、星星與紙花'), onChange: (v) => store.set({ reduceMotion: v }) }),
    guide: Toggle({ label: t('落點導引線'), value: s.guide, hint: t('顯示樓層落下的位置（對準時變綠色）'), onChange: (v) => store.set({ guide: v }) }),
  };
  const mv = Slider({ label: t('音樂音量'), value: s.musicVol, min: 0, max: 100, step: 5, format: (v) => v + '%', onChange: (v) => store.set({ musicVol: v }) });
  const sv = Slider({ label: t('音效音量'), value: s.sfxVol, min: 0, max: 100, step: 5, format: (v) => v + '%', onChange: (v) => { store.set({ sfxVol: v }); } });
  sv.addEventListener('pointerup', () => A.sfx.tock(0.6));
  const body = [h('h3', { class: 'set-h' }, t('聲音')), tg.music, mv, tg.sfx, sv, h('h3', { class: 'set-h' }, t('操作與畫面')), tg.vib, tg.rm, tg.guide];
  settingsModal = Modal({
    title: t('設定'), body,
    actions: [Btn({ label: t('恢復預設'), onClick: () => { store.reset(); settingsModal.close(true); settingsModal = null; openSettings(); } }), Btn({ label: t('完成'), kind: 'primary', onClick: () => settingsModal.close() })],
    onClose: () => { settingsModal = null; },
  });
}
app.openSettings = openSettings;

/* 語言切換：靜態畫面（首頁、設定、教學、大廳）直接重新載入以完整套用；對局／房間中不打斷，離開後套用 */
onLangChange(() => {
  if (settingsModal) { settingsModal.close(true); settingsModal = null; }
  const name = app.screen && app.screen.name;
  if (['home', 'setup', 'tutorial', 'lobby'].includes(name)) location.reload();
  else toast(t('語言已切換，離開目前畫面後會完整套用'));
});

/* ---------------- 線上：共用 ---------------- */
function connectBanner() {
  const el = h('div', { class: 'net-banner', role: 'status', hidden: true }, t('連線中斷，正在重新連線…'));
  document.body.append(el);
  net.net.onStatus = (st) => {
    el.hidden = !(st === 'down' && app.online);
    if (st !== 'up' && cur.onOnline) cur.onOnline(null);
  };
}

async function enterRoom(r) {
  app.online = { memberId: r.memberId, key: r.key, view: r.view, chat: [...(r.view.chat || [])] };
  net.saveSession({ roomId: r.view.id, memberId: r.memberId, key: r.key });
  if (r.converted) toast(r.converted === 'full' ? t('玩家席已滿，改為觀戰') : t('對局進行中，改為觀戰'));
  if (location.search) history.replaceState(null, '', location.pathname);
  go(r.view.status === 'playing' ? 'game' : 'room', gameParams());
}
function gameParams() {
  const v = app.online && app.online.view;
  return v ? { kind: 'online', mode: 'versus', diff: v.settings.difficulty, view: v } : {};
}
function leaveOnline(toLobby) {
  net.emitQuiet('room:leave', {});
  net.saveSession(null); app.online = null;
  go(toLobby ? 'lobby' : 'home');
}

let wired = false;
function wireNet() {
  if (wired) return; wired = true;
  net.getSocket();
  net.on('room:state', (view) => {
    if (!app.online) return;
    app.online.view = view;
    if (view.status === 'playing' && cur.name !== 'game') { go('game', gameParams()); return; }
    if (cur.onState) cur.onState(view);
  });
  net.on('game:start', () => { if (app.online && cur.name !== 'game') go('game', gameParams()); else if (app.online && cur.name === 'game') go('game', gameParams()); });
  net.on('game:turn', (d) => { if (cur.name === 'game') cur.onTurn(d); else if (app.online) app.online.pendingTurn = d; });
  net.on('game:drop', (d) => { if (cur.name === 'game') cur.onDrop(d); });
  net.on('game:preview', (d) => { if (cur.name === 'game') cur.onPreview(d); });
  net.on('game:forfeit', (d) => { if (cur.name === 'game') cur.onForfeit(d); });
  net.on('room:chat', (m) => { if (app.online) app.online.chat.push(m); if (cur.onChat) cur.onChat(m); });
  net.on('lobby:list', (l) => { if (cur.onList) cur.onList(l); });
  net.on('lobby:online', (count) => { if (cur.onOnline) cur.onOnline(count); });
  net.on('room:closed', (d) => {
    if (!app.online) return;
    net.saveSession(null); app.online = null;
    const m = Modal({ title: t('房間已結束'), body: h('p', null, d.reason || t('房間已關閉')), dismissible: false, actions: [Btn({ label: t('回到大廳'), kind: 'primary', onClick: () => { m.close(true); go('lobby'); } })] });
  });
  net.on('room:kicked', () => { net.saveSession(null); app.online = null; toast(t('你被請出房間了')); go('lobby'); });
  net.on('lost', (msg) => { app.online = null; toast(msg || t('房間已不存在')); go('lobby'); });
}

function copyText(text, label) {
  const done = () => toast(t('{label}已複製', { label }));
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => manualCopy(text, label));
  else manualCopy(text, label);
}
function manualCopy(text, label) {
  const tf = TextField({ value: text, label });
  Modal({ title: label, body: [h('p', { class: 'muted' }, t('請長按或選取後複製：')), tf], actions: [Btn({ label: t('完成'), kind: 'primary', onClick: (e) => e.target.closest('.modal-mask').querySelector('.modal-x').click() })] });
  setTimeout(() => tf.input.select(), 80);
}

/* ---------------- 大廳 ---------------- */
function lobby() {
  const nameTf = TextField({ value: ensureNick(), maxLength: 12, label: t('暱稱'), onInput: (v) => store.set({ nick: v.slice(0, 12) }) });
  const status = h('div', { class: 'lobby-status' });
  const listBox = h('div', { class: 'room-list' });
  const inviteBox = h('div', { class: 'invite-box' });
  let rooms = [];
  let onlineCount = null;
  const online = CONFIG.onlineAvailable;
  const onlineCountBox = h('p', { class: 'lobby-online-count', role: 'status', 'aria-live': 'polite', hidden: true });

  function paintOnlineCount(count) {
    if (count === null || (Number.isInteger(count) && count >= 0)) onlineCount = count;
    onlineCountBox.hidden = !Number.isInteger(onlineCount);
    onlineCountBox.textContent = Number.isInteger(onlineCount) ? t('目前在線：{n} 人', { n: onlineCount }) : '';
  }

  function renderList() {
    listBox.textContent = '';
    if (!rooms.length) { listBox.append(h('div', { class: 'empty' }, t('目前沒有房間。按「快速加入」會自動幫你開一間！'))); return; }
    for (const r of rooms) {
      listBox.append(h('div', { class: 'room-row' },
        h('div', { class: 'rr-main' }, h('b', { class: 'code' }, r.id), h('span', null, t('{host} 的房間', { host: r.host })), Badge(diffLabel(r.difficulty), 'toy'), ...(r.shapes && r.shapes !== 'off' ? [Badge(r.shapes === 'fixed' ? t('固定形狀') : t('每層不同'), 'toy')] : []), Badge(r.status === 'playing' ? t('對局中') : t('等待中'), r.status === 'playing' ? 'warn' : 'ok')),
        h('div', { class: 'rr-sub' }, t('{players}/{seats} 位玩家・{watchers} 位觀戰', { players: r.players, seats: r.seats, watchers: r.watchers })),
        h('div', { class: 'rr-act' },
          Btn({ label: t('加入'), size: 'sm', kind: 'primary', disabled: r.status === 'playing' || r.players >= r.seats, onClick: () => join(r.id, 'player') }),
          Btn({ label: t('觀戰'), ico: 'eye', size: 'sm', onClick: () => join(r.id, 'spectator') }))));
    }
  }
  async function join(roomId, role, token) {
    A.unlock();
    const res = await net.emit('room:join', { roomId, role, token, name: nick() || ensureNick() });
    if (!res.ok) return toast(res.code === 'closed' ? t('這個房間已結束') : res.code === 'bad_token' ? t('邀請連結已失效') : res.code === 'spectators_full' ? t('觀戰席已滿') : (res.msg || t('加入失敗')));
    if (window.GameAnalytics) window.GameAnalytics.roomAccepted('join', res.view && res.view.id, token ? 'invite_link' : 'lobby');
    enterRoom(res);
  }
  async function quick() {
    A.unlock(); setBusy(true, t('正在配對房間…'));
    const res = await net.emit('room:quick', { name: nick() || ensureNick() });
    setBusy(false);
    if (!res.ok) return toast(res.msg || t('無法加入'));
    if (window.GameAnalytics) window.GameAnalytics.roomAccepted('join', res.view && res.view.id, 'lobby');
    enterRoom(res);
  }
  function createDialog() {
    let diff = 'normal', maxP = 4, shapes = 'off', turnLimit = R.DEFAULT_TURN_SEC;
    const m = Modal({
      title: t('建立房間'),
      body: [Select({ label: t('難度'), value: diff, options: DIFF_OPTS, onChange: (v) => { diff = v; } }),
        Stepper({ label: t('人數上限'), value: maxP, min: 2, max: 4, onChange: (v) => { maxP = v; } }),
        Select({ label: t('樓層形狀'), value: shapes, options: SHAPE_OPTS, onChange: (v) => { shapes = v; } }),
        Select({ label: t('每回合限時'), value: String(turnLimit), options: TURN_OPTS, onChange: (v) => { turnLimit = +v; } })],
      actions: [Btn({ label: t('取消'), onClick: () => m.close() }), Btn({ label: t('建立'), kind: 'primary', onClick: async () => {
        m.close(true); setBusy(true, t('建立房間中…'));
        const res = await net.emit('room:create', { name: nick() || ensureNick(), difficulty: diff, maxPlayers: maxP, shapes, turnLimit });
        setBusy(false); if (!res.ok) return toast(res.msg || t('建立失敗')); if (window.GameAnalytics) window.GameAnalytics.roomAccepted('create', res.view && res.view.id, 'lobby'); enterRoom(res);
      } })],
    });
  }
  let busyEl = null;
  function setBusy(on, msg) { if (on) { busyEl = busyEl || h('div', { class: 'busy' }, h('span', { class: 'spin' }), h('span', null, msg)); busyEl.lastChild.textContent = msg; status.textContent = ''; status.append(busyEl); } else { busyEl && busyEl.remove(); } }

  const codeTf = TextField({ placeholder: t('輸入 4 碼房號'), maxLength: 4, label: t('房號'), onEnter: (v) => v.trim() && join(v.trim().toUpperCase(), 'player') });
  const noOnline = h('div', { class: 'notice' }, h('b', null, t('線上對戰目前無法使用')), h('p', null, CONFIG.error || t('尚未設定伺服器')), Btn({ label: t('回首頁'), onClick: () => go('home') }));

  function renderInvite() {
    const inv = app.invite; inviteBox.textContent = '';
    if (!inv) return;
    inviteBox.append(h('div', { class: 'busy' }, h('span', { class: 'spin' }), h('span', null, t('正在確認邀請…'))));
    net.emit('invite:info', { roomId: inv.roomId, token: inv.token }).then((r) => {
      inviteBox.textContent = '';
      if (!r.ok) {
        const msg = r.code === 'closed' ? t('這個房間已經結束了。') : r.code === 'bad_token' ? t('邀請連結已失效，可能被房主撤銷了。請向房主要新的連結。') : t('無法確認邀請。');
        inviteBox.append(h('div', { class: 'notice err' }, h('b', null, t('邀請無法使用')), h('p', null, msg), Btn({ label: t('知道了'), onClick: () => { app.invite = null; history.replaceState(null, '', location.pathname); renderInvite(); } })));
        return;
      }
      const role = r.role === 'spectator' ? t('觀戰') : t('加入對戰');
      const invNick = TextField({ value: ensureNick(), maxLength: 12, label: t('你的暱稱'), onInput: (v) => store.set({ nick: v.slice(0, 12) }) });
      inviteBox.append(h('div', { class: 'notice invite' },
        h('b', null, t('你被邀請{role}房間 {roomId}', { role, roomId: r.roomId })), h('p', null, t('{v0}{v1}・{players}/{seats} 位玩家{v4}', { v0: diffLabel(r.difficulty), v1: r.shapes === 'fixed' ? t('・固定形狀') : r.shapes === 'every' ? t('・每層不同') : '', players: r.players, seats: r.seats, v4: r.status === 'playing' ? t('・對局進行中') : '' })),
        h('label', { class: 'field-label' }, t('你的暱稱（確認後才會進入）')), invNick,
        Btn({ label: t('確認並{role}', { role }), kind: 'primary', block: true, onClick: async () => { const t = app.invite; app.invite = null; store.set({ nick: invNick.input.value.slice(0, 12) }); await join(t.roomId, r.role === 'spectator' ? 'spectator' : 'player', t.token); } })));
    });
  }

  const body = !online ? [noOnline] : [
    inviteBox,
    Field(t('暱稱'), nameTf),
    h('div', { class: 'lobby-actions' }, Btn({ label: t('快速加入'), kind: 'primary', size: 'lg', onClick: quick, cls: 'autofocus' }), Btn({ label: t('建立房間'), size: 'lg', onClick: createDialog })),
    h('div', { class: 'code-row' }, codeTf, Btn({ label: t('以房號加入'), size: 'sm', onClick: () => codeTf.input.value.trim() && join(codeTf.input.value.trim().toUpperCase(), 'player') })),
    status,
    onlineCountBox,
    h('h3', { class: 'set-h' }, t('公開房間')), listBox,
  ];
  const page = Page({ title: t('線上對戰'), back: { fn: () => { if (online) net.emitQuiet('lobby:unwatch'); go('home'); } }, children: body, narrow: true });
  const q = page.querySelector('.autofocus'); if (q) q.dataset.autofocus = '1';
  return {
    el: page,
    mount() {
      if (!online) return;
      wireNet(); setBusy(true, t('連線中…（免費主機冷啟動可能需要 30 秒）'));
      renderInvite();
      net.emit('lobby:watch', undefined, 45000).then((r) => {
        setBusy(false);
        if (!r.ok) { status.textContent = ''; status.append(h('div', { class: 'notice err' }, h('b', null, t('連不上伺服器')), h('p', null, r.msg || t('請稍後再試')), Btn({ label: t('重試'), onClick: () => go('lobby') }))); return; }
        rooms = r.rooms; paintOnlineCount(r.online); renderList();
      });
    },
    onList(l) { rooms = l; renderList(); },
    onOnline(count) { paintOnlineCount(count); },
    destroy() { clearTimeout(loadingTimer); },
  };
}

/* ---------------- 房間（等待／上一局結束後） ---------------- */
function room() {
  const view0 = app.online.view;
  const chat = Chat({ onSend: (text) => net.emitQuiet('chat:send', { text }) });
  chat.set(app.online.chat);
  const seatsBox = h('div', { class: 'seats' });
  const sideBox = h('div', { class: 'room-side' });
  const headBox = h('div', { class: 'room-head' });
  const actBox = h('div', { class: 'room-actions' });

  function render(v) {
    const me = v.me, isHost = v.hostId === me.id;
    const members = v.members;
    headBox.textContent = '';
    headBox.append(h('div', { class: 'rh-code' }, h('small', null, t('房號')), h('b', null, v.id)), h('div', { class: 'rh-info' }, Badge(diffLabel(v.settings.difficulty), 'toy'), Badge(t('{length}/{maxPlayers} 席', { length: members.filter((m) => m.role !== 'spectator').length, maxPlayers: v.settings.maxPlayers }), 'wood'), v.status === 'ended' ? Badge(t('上一局已結束'), 'warn') : null));
    // 席位
    seatsBox.textContent = '';
    const seated = members.filter((m) => m.role === 'player' || m.role === 'ai');
    for (let i = 0; i < v.settings.maxPlayers; i++) {
      const m = seated[i];
      if (!m) {
        seatsBox.append(h('div', { class: 'seat empty' }, h('span', { class: 'seat-n' }, i + 1), h('div', { class: 'seat-main' }, h('b', null, t('空位')), isHost ? h('div', { class: 'seat-ai' }, Select({ value: 'normal', options: AI_OPTS, block: false, label: t('電腦難度'), onChange: (lv) => { selAi = lv; } }), Btn({ label: t('加入電腦'), size: 'sm', onClick: () => net.emit('room:ai:add', { level: selAi }) })) : h('small', null, t('等待加入…')))));
        continue;
      }
      const isAi = m.role === 'ai';
      seatsBox.append(h('div', { class: 'seat' + (m.host ? ' host' : '') },
        h('span', { class: 'seat-n' }, i + 1),
        h('div', { class: 'seat-main' },
          h('b', null, m.name, m.id === me.id ? h('i', null, t('（你）')) : null, m.host ? icon('crown', 16) : null),
          isAi ? (isHost ? h('div', { class: 'seat-ai' }, Select({ value: m.ai, options: AI_OPTS, block: false, label: t('電腦難度'), onChange: (lv) => net.emit('room:ai:level', { id: m.id, level: lv }) }), Btn({ label: t('移除'), size: 'sm', onClick: () => net.emit('room:ai:remove', { id: m.id }) })) : h('small', null, t('電腦・{v0}', { v0: diffLabel(m.ai) })))
            : h('small', null, m.host ? t('房主') : m.ready ? t('已準備') : t('未準備'), m.connected ? '' : t('・連線中斷'))),
        !isAi && isHost && m.id !== me.id ? Btn({ label: t('請出'), size: 'sm', onClick: () => net.emit('room:kick', { id: m.id }) }) : null));
    }
    // 側邊：設定、邀請、觀戰者
    sideBox.textContent = '';
    const sec = (t, ...k) => h('section', { class: 'rs' }, h('h3', null, t), ...k);
    sideBox.append(sec(t('房間設定'),
      isHost ? [Select({ label: t('難度'), value: v.settings.difficulty, options: DIFF_OPTS, onChange: (d) => net.emit('room:settings', { difficulty: d }) }),
        Stepper({ label: t('人數上限'), value: v.settings.maxPlayers, min: Math.max(2, seated.length), max: 4, onChange: (n) => net.emit('room:settings', { maxPlayers: n }) }),
        Select({ label: t('樓層形狀'), value: v.settings.shapes || 'off', options: SHAPE_OPTS, onChange: (d) => net.emit('room:settings', { shapes: d }) }),
        Select({ label: t('每回合限時'), value: String(v.settings.turnLimit || R.DEFAULT_TURN_SEC), options: TURN_OPTS, onChange: (d) => net.emit('room:settings', { turnLimit: +d }) })]
        : h('p', { class: 'muted' }, t('難度 {v0}・形狀 {label}・上限 {maxPlayers} 人（由房主設定）', { v0: diffLabel(v.settings.difficulty), label: (SHAPE_OPTS.find((o) => o.value === (v.settings.shapes || 'off')) || SHAPE_OPTS[0]).label, maxPlayers: v.settings.maxPlayers }), h('br'), t('每回合限時：{v}', { v: (TURN_OPTS.find((o) => o.value === String(v.settings.turnLimit || R.DEFAULT_TURN_SEC)) || TURN_OPTS[0]).label }))));
    if (v.invite) {
      sideBox.append(sec(t('邀請朋友'),
        h('div', { class: 'inv-btns' }, Btn({ label: t('複製玩家連結'), ico: 'link', size: 'sm', onClick: () => copyText(inviteLink(v.id, v.invite.player), t('玩家邀請連結')) }), Btn({ label: t('複製觀戰連結'), ico: 'eye', size: 'sm', onClick: () => copyText(inviteLink(v.id, v.invite.spectator), t('觀戰邀請連結')) })),
        isHost ? Btn({ label: t('撤銷並重發連結'), size: 'sm', onClick: async () => { const r = await net.emit('room:revoke', {}); r.ok && toast(t('舊連結已失效，已產生新連結')); } }) : null));
    }
    const specs = members.filter((m) => m.role === 'spectator');
    sideBox.append(sec(t('觀戰者（{length}）', { length: specs.length }), specs.length ? h('ul', { class: 'spec-list' }, specs.map((m) => h('li', null, icon('eye', 14), m.name, m.id === me.id ? t('（你）') : '', isHost ? Btn({ label: t('請出'), size: 'xs', onClick: () => net.emit('room:kick', { id: m.id }) }) : null))) : h('p', { class: 'muted' }, t('目前沒有人觀戰'))));
    // 操作
    actBox.textContent = '';
    const cs = v.canStart;
    if (isHost) {
      actBox.append(Btn({ label: v.status === 'ended' ? t('再來一局') : t('開始對局'), kind: 'primary', size: 'lg', block: true, disabled: !cs.ok, onClick: async () => { const r = await net.emit('room:start', {}); if (!r.ok) toast(r.msg || t('不能開始')); } }));
      if (!cs.ok) actBox.append(h('p', { class: 'muted center' }, cs.msg));
    } else if (me.role === 'player') {
      actBox.append(Toggle({ label: t('我準備好了'), value: members.find((m) => m.id === me.id).ready, onChange: (r) => net.emit('room:ready', { ready: r }) }), Btn({ label: t('改為觀戰'), size: 'sm', onClick: () => net.emit('room:watch', {}) }));
    } else {
      const free = seated.length < v.settings.maxPlayers;
      actBox.append(h('p', { class: 'muted center' }, t('你是觀戰者，可以聊天。')), Btn({ label: t('入座加入對戰'), kind: 'primary', block: true, disabled: !free, onClick: () => net.emit('room:seat', {}) }));
    }
    actBox.append(Btn({ label: t('離開房間'), kind: 'danger', size: 'sm', onClick: () => leaveOnline(true) }));
  }
  let selAi = 'normal';
  const body = h('div', { class: 'room-grid' }, h('div', { class: 'room-main' }, headBox, seatsBox, actBox), sideBox, h('div', { class: 'room-chat' }, h('h3', null, t('聊天室')), chat.el));
  const page = Page({ title: t('房間'), back: { label: t('離開'), fn: () => leaveOnline(true) }, children: body, cls: 'room-page' });
  render(view0);
  return {
    el: page,
    mount() { chat.refresh(); },
    onState(v) { render(v); },
    onChat(m) { chat.add(m); },
  };
}

/* ---------------- 對局 ---------------- */
function noWebGL() {
  return {
    el: Page({ title: t('無法顯示 3D'), back: { fn: () => go('home') }, narrow: true, children: [
      h('p', null, t('這個瀏覽器或裝置目前無法使用 3D 繪圖（WebGL），所以無法顯示遊戲畫面。')),
      h('p', { class: 'muted' }, t('請試著更新瀏覽器、開啟「硬體加速」，或換成 Chrome、Safari、Edge 的最新版本後再試。')),
      Btn({ label: t('回到首頁'), kind: 'primary', size: 'lg', block: true, onClick: () => go('home') }),
    ] }),
  };
}
function game(p) {
  if (!webglSupported()) return noWebGL();
  let s;
  if (p.kind === 'local') {
    s = GameScreen({
      kind: 'local', mode: p.mode, diff: p.diff, players: p.players, shapes: p.shapes, turnLimit: p.turnLimit,
      onExit: (w) => (w === 'home' ? go('home') : go('setup', { mode: p.setupMode })),
      onAgain: () => go('game', p),
    });
  } else {
    s = GameScreen({
      kind: 'online', mode: 'versus', diff: p.diff, view: p.view,
      onExit: (w) => { if (w === 'home') leaveOnline(false); else go('room'); },
    });
    const pend = app.online && app.online.pendingTurn;
    if (pend && p.view.status === 'playing') { setTimeout(() => { s.onTurn(pend); }, 100); }
    if (app.online) app.online.pendingTurn = null;
  }
  const mount = s.mount;
  s.mount = () => { mount(); };
  return s;
}

/* ---------------- 右上角設定入口（所有畫面） ---------------- */
net.net.statusHook = (st) => Outage.status(st);
onLangChange(() => Latency.refresh());
document.body.append(h('div', { class: 'gear-wrap' }, LangButton(), IconBtn({ ico: 'toolbox', label: t('設定'), size: 28, cls: 'gear-btn', onClick: () => openSettings() })));
connectBanner();

/* ---------------- 啟動 ---------------- */
(function boot() {
  const q = new URLSearchParams(location.search);
  if (q.get('room') && q.get('t')) {
    app.invite = { roomId: q.get('room').toUpperCase(), token: q.get('t') };
    go('lobby');
    return;
  }
  go('home');
})();
window.__app = { go, app, store };
