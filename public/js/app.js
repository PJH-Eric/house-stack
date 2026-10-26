/* 疊疊高樓 — 主程式：路由、首頁、開局設定、教學、大廳、房間、設定彈窗、網路事件接線。 */
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
  document.querySelectorAll('.sel-pop').forEach((e) => e.remove());
  rootEl.textContent = '';
  const builders = { home, setup, tutorial, lobby, room, game };
  cur = builders[name](params) || {};
  cur.name = name;
  app.screen = cur;
  rootEl.append(cur.el);
  rootEl.dataset.screen = name;
  cur.mount && cur.mount();
  if (name !== 'game') A.setAltitude(0);
  const f = cur.el.querySelector('[data-autofocus]');
  f && f.focus({ preventScroll: true });
}
app.go = go;

/* ---------------- 共用：頁面外框 ---------------- */
function Page({ title, back, children, narrow, cls }) {
  const head = h('header', { class: 'page-head' }, back ? Btn({ ico: 'chevL', label: back.label || '返回', size: 'sm', onClick: back.fn }) : h('span'), h('h1', null, title), h('span', { class: 'page-head-gap' }));
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
  const SHAPE_TAG = { off: '', fixed: '・固定形狀', every: '・每層不同' };
  const bests = Object.keys(R.DIFFICULTIES).flatMap((k) => ['off', 'fixed', 'every'].filter((sh) => store.best(k, sh)).map((sh) => `${diffLabel(k)}${SHAPE_TAG[sh]} ${store.best(k, sh)} 層`));
  const online = CONFIG.onlineAvailable;
  const card = h('div', { class: 'home-card' },
      h('div', { class: 'logo' }, h('span', { class: 'logo-blk b1' }, '疊'), h('span', { class: 'logo-blk b2' }, '疊'), h('span', { class: 'logo-blk b3' }, '高'), h('span', { class: 'logo-blk b4' }, '樓')),
      h('p', { class: 'tagline' }, '操作吊車把小房子一層層疊高，重心歪了整棟會倒！'),
      h('nav', { class: 'home-menu', 'aria-label': '主選單' },
        Btn({ label: '單人挑戰', ico: 'play', kind: 'primary', size: 'lg', block: true, onClick: () => go('setup', { mode: 'solo' }), cls: 'autofocus' }),
        Btn({ label: '對電腦輪流', size: 'lg', block: true, onClick: () => go('setup', { mode: 'vs' }) }),
        Btn({ label: '線上對戰', size: 'lg', block: true, onClick: () => go('lobby'), title: online ? '' : '尚未設定線上伺服器' }),
        Btn({ label: '怎麼玩', size: 'lg', block: true, onClick: () => go('tutorial') })),
      bests.length ? h('p', { class: 'home-best' }, '個人最高：', bests.join('　')) : null,
      !online ? h('p', { class: 'home-note' }, '提示：尚未設定線上伺服器，線上對戰需要部署後端。') : null);
  const el = h('div', { class: 'home' }, canvas, ScrollArea(h('div', { class: 'home-wrap' }, card), { cls: 'home-scroll' }));
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
const SHAPE_OPTS = [{ value: 'off', label: '一般（方正樓層）' }, { value: 'fixed', label: '隨機一種形狀（整場相同）' }, { value: 'every', label: '整場都不規則（每層不同）' }];
const SHAPE_DESC = { off: '每層都是標準大小。', fixed: '開局隨機決定一種寬窄高矮，整場每層都長這樣。', every: '每一層的寬窄高矮都不一樣，越高變化越大。' };
const setupMem = { diff: 'normal', ais: ['normal'], lives: 0, shapes: 'off' };
function setup({ mode }) {
  const solo = mode === 'solo';
  const nameTf = TextField({ value: ensureNick(), maxLength: 12, label: '暱稱', onInput: (v) => store.set({ nick: v.slice(0, 12) }) });
  const dSel = Select({ label: '難度', value: setupMem.diff, options: DIFF_OPTS, onChange: (v) => { setupMem.diff = v; desc.textContent = DIFF_DESC[v]; refreshLives(); showRec(); } });
  const desc = h('p', { class: 'field-desc' }, DIFF_DESC[setupMem.diff]);
  const livesLabel = (v) => (v === 0 ? '預設' : `${v} 顆`);
  const lives = Stepper({ label: solo ? '生命（愛心）' : '每人生命', value: setupMem.lives, min: 0, max: 5, format: livesLabel, onChange: (v) => { setupMem.lives = v; refreshLives(); } });
  const livesHint = h('p', { class: 'field-desc' });
  const shDesc = h('p', { class: 'field-desc' }, SHAPE_DESC[setupMem.shapes]);
  const shSel = Select({ label: '樓層形狀', value: setupMem.shapes, options: SHAPE_OPTS, onChange: (v) => { setupMem.shapes = v; shDesc.textContent = SHAPE_DESC[v]; showRec(); } });
  function refreshLives() {
    const d = R.DIFFICULTIES[setupMem.diff];
    const def = solo ? d.lives : d.versusLives;
    livesHint.textContent = setupMem.lives === 0 ? `預設：${def} 顆愛心` : '';
  }
  const aiBox = h('div', { class: 'ai-rows' });
  const aiCount = Stepper({ label: '電腦數量', value: setupMem.ais.length, min: 1, max: 3, onChange: (v) => { while (setupMem.ais.length < v) setupMem.ais.push('normal'); setupMem.ais.length = v; drawAis(); } });
  function drawAis() {
    aiBox.textContent = '';
    setupMem.ais.forEach((lv, i) => aiBox.append(Select({ label: `電腦 ${i + 1}`, value: lv, options: AI_OPTS, onChange: (v) => { setupMem.ais[i] = v; } })));
  }
  const rec = h('p', { class: 'field-desc' }, '');
  function showRec() { const b = store.best(setupMem.diff, setupMem.shapes); rec.textContent = b ? `這個難度與形狀的最高紀錄：${b} 層` : ''; }
  dSel.addEventListener('click', () => {});
  const start = Btn({ label: '開始', kind: 'primary', size: 'lg', block: true, onClick: () => startLocal(), cls: 'autofocus' });
  function startLocal() {
    const me = nick() || ensureNick();
    const players = [{ id: 'me', name: me, kind: 'human' }];
    if (!solo) setupMem.ais.forEach((lv, i) => players.push({ id: 'ai' + (i + 1), name: `電腦${i + 1}`, kind: 'ai', ai: lv }));
    A.unlock(); A.sfx.click();
    go('game', { kind: 'local', mode: solo ? 'solo' : 'versus', diff: setupMem.diff, players, lives: setupMem.lives, shapes: setupMem.shapes, setupMode: mode });
  }
  drawAis(); refreshLives(); showRec();
  const body = [
    Field('暱稱', nameTf), dSel, desc, rec, lives, livesHint, shSel, shDesc,
    solo ? h('p', { class: 'rule-note' }, '單人規則：樓層重心不穩、整段倒塌（或完全沒接到）就失去一顆愛心，愛心用完結束，比誰蓋得高、得分高。連續完美對齊會有連擊加分。') : h('div', null, aiCount, aiBox, h('p', { class: 'rule-note' }, '輪流規則：大家輪流操作吊車，在同一棟樓上加蓋一層。讓樓倒塌的人失去一顆愛心，愛心用完就淘汰，最後留下的人獲勝。樓沒有上限，風越高越大。')),
    start,
  ];
  const page = Page({ title: solo ? '單人挑戰' : '對電腦輪流', back: { fn: () => go('home') }, children: body, narrow: true });
  page.querySelector('.autofocus').dataset.autofocus = '1';
  return { el: page };
}

/* ---------------- 教學（純文字） ---------------- */
function tutorial() {
  const steps = [
    ['目標', '操作吊車，把一層層的小房子疊在一起蓋成高樓。樓越高，吊車擺得越快，背景會依高度一路變化：鳥群、直升機、雨雲、客機，最後到太空與行星。'],
    ['怎麼放', '輪到你時，吊車會左右擺盪，新的樓層掛在鉤子上。在你覺得對齊的瞬間，點一下畫面、按「放下」按鈕或空白鍵。畫面上的白色框框是落點，變成綠色代表「完美」。'],
    ['會不會倒？', '樓層不會被裁切，而是看「重心」：每一層以上所有樓層的重心，必須落在它與下方樓層的重疊範圍內，否則從那一層以上整段倒塌。完全沒接到就直接掉下去。畫面上方的星星進度條是穩定度，越低樓晃得越厲害。'],
    ['單人挑戰', '樓倒了會失去一顆愛心，愛心用完就結束。連續完美對齊有連擊加分；樓層沒有上限，越蓋越高會經過鳥群、雲層、太空與行星。紀錄會存在這台裝置上。'],
    ['輪流對戰', '電腦或線上好友輪流在同一棟樓上加蓋。讓樓倒塌的人失去一顆愛心，沒有愛心就淘汰，最後留下的人獲勝。每個人蓋的樓層頂板下有各自的顏色細帶，方便看出誰蓋的。'],
    ['小技巧', '先蓋穩再求快：每次都對得很準，重心就會一直在中間。如果樓已經歪向一邊，下一層故意往反方向偏一點，可以把重心拉回來。吊車擺到正中間的瞬間放下，最容易「完美」。'],
    ['風', '樓蓋得越高風越大（約 50～90 層最強），而且有陣風：風會把吊車的擺盪中心吹偏，樓層放下後在空中還會被吹走一小段。看右下角的風向與風力，先預判再放，白色框框會顯示已經算入風的預測落點。風向與風速每一回合都不固定。到了太空（約 140 層）就沒有風了。電腦對手也會判斷風，只是難度越低誤差越大。'],
    ['樓層形狀', '開局設定可以選樓層形狀：「一般」每層一樣大；「隨機一種形狀」開局隨機決定寬窄高矮，整場都是這個形狀；「整場都不規則」每層的寬窄高矮都不同。吊車手上的樓層就是下一層的樣子，白色框框也跟著它的寬度。窄的樓層重疊區小，比較難接穩。'],
    ['太空無重力', '到了太空（約 140 層）沒有風，改成無重力：放下的樓層會被磁力吸向中心（偏移縮小），下落與搖晃都變慢、樓房會緩緩漂浮；倒塌時殘骸會慢慢飄散。白色框框會顯示磁吸之後的預測落點，右下角會顯示「無重力・磁吸」。'],
    ['線上房間', '建立房間後可以分享「玩家連結」邀請朋友加入，或分享「觀戰連結」讓人觀看；房間裡可以加入電腦。沒有真人玩家時房間會自動關閉。'],
  ];
  const body = [...steps.map(([t, d], i) => h('section', { class: 'tut' }, h('span', { class: 'tut-n' }, i + 1), h('div', null, h('h3', null, t), h('p', null, d))))];
  body.push(h('div', { class: 'keys wide' }, h('div', null, KeyCap('空白'), ' 放下樓層'), h('div', null, KeyCap('Esc'), ' 選單')));
  return { el: Page({ title: '怎麼玩', back: { fn: () => go('home') }, children: body, narrow: true }) };
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
    music: Toggle({ label: '背景音樂', value: s.music, onChange: (v) => store.set({ music: v }) }),
    sfx: Toggle({ label: '音效', value: s.sfx, onChange: (v) => { store.set({ sfx: v }); if (v) A.sfx.tock(0.6); } }),
    vib: Toggle({ label: '震動', value: s.vibrate, hint: '放下與掉落時震動（需裝置支援）', onChange: (v) => store.set({ vibrate: v }) }),
    rm: Toggle({ label: '減少動態', value: s.reduceMotion, hint: '關閉畫面晃動、灰塵與紙花', onChange: (v) => store.set({ reduceMotion: v }) }),
    guide: Toggle({ label: '落點導引線', value: s.guide, hint: '顯示樓層落下的位置（對準時變綠色）', onChange: (v) => store.set({ guide: v }) }),
  };
  const mv = Slider({ label: '音樂音量', value: s.musicVol, min: 0, max: 100, step: 5, format: (v) => v + '%', onChange: (v) => store.set({ musicVol: v }) });
  const sv = Slider({ label: '音效音量', value: s.sfxVol, min: 0, max: 100, step: 5, format: (v) => v + '%', onChange: (v) => { store.set({ sfxVol: v }); } });
  sv.addEventListener('pointerup', () => A.sfx.tock(0.6));
  const body = [h('h3', { class: 'set-h' }, '聲音'), tg.music, mv, tg.sfx, sv, h('h3', { class: 'set-h' }, '操作與畫面'), tg.vib, tg.rm, tg.guide];
  settingsModal = Modal({
    title: '設定', body,
    actions: [Btn({ label: '恢復預設', onClick: () => { store.reset(); settingsModal.close(true); settingsModal = null; openSettings(); } }), Btn({ label: '完成', kind: 'primary', onClick: () => settingsModal.close() })],
    onClose: () => { settingsModal = null; },
  });
}
app.openSettings = openSettings;

/* ---------------- 線上：共用 ---------------- */
function connectBanner() {
  const el = h('div', { class: 'net-banner', role: 'status', hidden: true }, '連線中斷，正在重新連線…');
  document.body.append(el);
  net.net.onStatus = (st) => { el.hidden = !(st === 'down' && app.online); };
}

async function enterRoom(r) {
  app.online = { memberId: r.memberId, key: r.key, view: r.view, chat: [...(r.view.chat || [])] };
  net.saveSession({ roomId: r.view.id, memberId: r.memberId, key: r.key });
  if (r.converted) toast(r.converted === 'full' ? '玩家席已滿，改為觀戰' : '對局進行中，改為觀戰');
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
  net.on('room:closed', (d) => {
    if (!app.online) return;
    net.saveSession(null); app.online = null;
    const m = Modal({ title: '房間已結束', body: h('p', null, d.reason || '房間已關閉'), dismissible: false, actions: [Btn({ label: '回到大廳', kind: 'primary', onClick: () => { m.close(true); go('lobby'); } })] });
  });
  net.on('room:kicked', () => { net.saveSession(null); app.online = null; toast('你被請出房間了'); go('lobby'); });
  net.on('lost', (msg) => { app.online = null; toast(msg || '房間已不存在'); go('lobby'); });
}

function copyText(text, label) {
  const done = () => toast(`${label}已複製`);
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => manualCopy(text, label));
  else manualCopy(text, label);
}
function manualCopy(text, label) {
  const tf = TextField({ value: text, label });
  Modal({ title: label, body: [h('p', { class: 'muted' }, '請長按或選取後複製：'), tf], actions: [Btn({ label: '完成', kind: 'primary', onClick: (e) => e.target.closest('.modal-mask').querySelector('.modal-x').click() })] });
  setTimeout(() => tf.input.select(), 80);
}

/* ---------------- 大廳 ---------------- */
function lobby() {
  const nameTf = TextField({ value: ensureNick(), maxLength: 12, label: '暱稱', onInput: (v) => store.set({ nick: v.slice(0, 12) }) });
  const status = h('div', { class: 'lobby-status' });
  const listBox = h('div', { class: 'room-list' });
  const inviteBox = h('div', { class: 'invite-box' });
  let rooms = [];
  const online = CONFIG.onlineAvailable;

  function renderList() {
    listBox.textContent = '';
    if (!rooms.length) { listBox.append(h('div', { class: 'empty' }, '目前沒有房間。按「快速加入」會自動幫你開一間！')); return; }
    for (const r of rooms) {
      listBox.append(h('div', { class: 'room-row' },
        h('div', { class: 'rr-main' }, h('b', { class: 'code' }, r.id), h('span', null, `${r.host} 的房間`), Badge(diffLabel(r.difficulty), 'toy'), ...(r.shapes && r.shapes !== 'off' ? [Badge(r.shapes === 'fixed' ? '固定形狀' : '每層不同', 'toy')] : []), Badge(r.status === 'playing' ? '對局中' : '等待中', r.status === 'playing' ? 'warn' : 'ok')),
        h('div', { class: 'rr-sub' }, `${r.players}/${r.seats} 位玩家・${r.watchers} 位觀戰`),
        h('div', { class: 'rr-act' },
          Btn({ label: '加入', size: 'sm', kind: 'primary', disabled: r.status === 'playing' || r.players >= r.seats, onClick: () => join(r.id, 'player') }),
          Btn({ label: '觀戰', ico: 'eye', size: 'sm', onClick: () => join(r.id, 'spectator') }))));
    }
  }
  async function join(roomId, role, token) {
    A.unlock();
    const res = await net.emit('room:join', { roomId, role, token, name: nick() || ensureNick() });
    if (!res.ok) return toast(res.code === 'closed' ? '這個房間已結束' : res.code === 'bad_token' ? '邀請連結已失效' : res.code === 'spectators_full' ? '觀戰席已滿' : (res.msg || '加入失敗'));
    enterRoom(res);
  }
  async function quick() {
    A.unlock(); setBusy(true, '正在配對房間…');
    const res = await net.emit('room:quick', { name: nick() || ensureNick() });
    setBusy(false);
    if (!res.ok) return toast(res.msg || '無法加入');
    enterRoom(res);
  }
  function createDialog() {
    let diff = 'normal', maxP = 4, lives = 0, shapes = 'off';
    const m = Modal({
      title: '建立房間',
      body: [Select({ label: '難度', value: diff, options: DIFF_OPTS, onChange: (v) => { diff = v; } }),
        Stepper({ label: '人數上限', value: maxP, min: 2, max: 4, onChange: (v) => { maxP = v; } }),
        Stepper({ label: '每人生命', value: lives, min: 0, max: 5, format: (v) => (v === 0 ? '預設' : v + ' 顆'), onChange: (v) => { lives = v; } }),
        Select({ label: '樓層形狀', value: shapes, options: SHAPE_OPTS, onChange: (v) => { shapes = v; } })],
      actions: [Btn({ label: '取消', onClick: () => m.close() }), Btn({ label: '建立', kind: 'primary', onClick: async () => {
        m.close(true); setBusy(true, '建立房間中…');
        const res = await net.emit('room:create', { name: nick() || ensureNick(), difficulty: diff, maxPlayers: maxP, lives, shapes });
        setBusy(false); if (!res.ok) return toast(res.msg || '建立失敗'); enterRoom(res);
      } })],
    });
  }
  let busyEl = null;
  function setBusy(on, msg) { if (on) { busyEl = busyEl || h('div', { class: 'busy' }, h('span', { class: 'spin' }), h('span', null, msg)); busyEl.lastChild.textContent = msg; status.textContent = ''; status.append(busyEl); } else { busyEl && busyEl.remove(); } }

  const codeTf = TextField({ placeholder: '輸入 4 碼房號', maxLength: 4, label: '房號', onEnter: (v) => v.trim() && join(v.trim().toUpperCase(), 'player') });
  const noOnline = h('div', { class: 'notice' }, h('b', null, '線上對戰目前無法使用'), h('p', null, CONFIG.error || '尚未設定伺服器'), Btn({ label: '回首頁', onClick: () => go('home') }));

  function renderInvite() {
    const inv = app.invite; inviteBox.textContent = '';
    if (!inv) return;
    inviteBox.append(h('div', { class: 'busy' }, h('span', { class: 'spin' }), h('span', null, '正在確認邀請…')));
    net.emit('invite:info', { roomId: inv.roomId, token: inv.token }).then((r) => {
      inviteBox.textContent = '';
      if (!r.ok) {
        const msg = r.code === 'closed' ? '這個房間已經結束了。' : r.code === 'bad_token' ? '邀請連結已失效，可能被房主撤銷了。請向房主要新的連結。' : '無法確認邀請。';
        inviteBox.append(h('div', { class: 'notice err' }, h('b', null, '邀請無法使用'), h('p', null, msg), Btn({ label: '知道了', onClick: () => { app.invite = null; history.replaceState(null, '', location.pathname); renderInvite(); } })));
        return;
      }
      const role = r.role === 'spectator' ? '觀戰' : '加入對戰';
      const invNick = TextField({ value: ensureNick(), maxLength: 12, label: '你的暱稱', onInput: (v) => store.set({ nick: v.slice(0, 12) }) });
      inviteBox.append(h('div', { class: 'notice invite' },
        h('b', null, `你被邀請${role}房間 ${r.roomId}`), h('p', null, `${diffLabel(r.difficulty)}${r.shapes === 'fixed' ? '・固定形狀' : r.shapes === 'every' ? '・每層不同' : ''}・${r.players}/${r.seats} 位玩家${r.status === 'playing' ? '・對局進行中' : ''}`),
        h('label', { class: 'field-label' }, '你的暱稱（確認後才會進入）'), invNick,
        Btn({ label: `確認並${role}`, kind: 'primary', block: true, onClick: async () => { const t = app.invite; app.invite = null; store.set({ nick: invNick.input.value.slice(0, 12) }); await join(t.roomId, r.role === 'spectator' ? 'spectator' : 'player', t.token); } })));
    });
  }

  const body = !online ? [noOnline] : [
    inviteBox,
    Field('暱稱', nameTf),
    h('div', { class: 'lobby-actions' }, Btn({ label: '快速加入', kind: 'primary', size: 'lg', onClick: quick, cls: 'autofocus' }), Btn({ label: '建立房間', size: 'lg', onClick: createDialog })),
    h('div', { class: 'code-row' }, codeTf, Btn({ label: '以房號加入', size: 'sm', onClick: () => codeTf.input.value.trim() && join(codeTf.input.value.trim().toUpperCase(), 'player') })),
    status,
    h('h3', { class: 'set-h' }, '公開房間'), listBox,
  ];
  const page = Page({ title: '線上對戰', back: { fn: () => { if (online) net.emitQuiet('lobby:unwatch'); go('home'); } }, children: body, narrow: true });
  const q = page.querySelector('.autofocus'); if (q) q.dataset.autofocus = '1';
  return {
    el: page,
    mount() {
      if (!online) return;
      wireNet(); setBusy(true, '連線中…（免費主機冷啟動可能需要 30 秒）');
      renderInvite();
      net.emit('lobby:watch', undefined, 45000).then((r) => {
        setBusy(false);
        if (!r.ok) { status.textContent = ''; status.append(h('div', { class: 'notice err' }, h('b', null, '連不上伺服器'), h('p', null, r.msg || '請稍後再試'), Btn({ label: '重試', onClick: () => go('lobby') }))); return; }
        rooms = r.rooms; renderList();
      });
    },
    onList(l) { rooms = l; renderList(); },
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
    headBox.append(h('div', { class: 'rh-code' }, h('small', null, '房號'), h('b', null, v.id)), h('div', { class: 'rh-info' }, Badge(diffLabel(v.settings.difficulty), 'toy'), Badge(`${members.filter((m) => m.role !== 'spectator').length}/${v.settings.maxPlayers} 席`, 'wood'), v.status === 'ended' ? Badge('上一局已結束', 'warn') : null));
    // 席位
    seatsBox.textContent = '';
    const seated = members.filter((m) => m.role === 'player' || m.role === 'ai');
    for (let i = 0; i < v.settings.maxPlayers; i++) {
      const m = seated[i];
      if (!m) {
        seatsBox.append(h('div', { class: 'seat empty' }, h('span', { class: 'seat-n' }, i + 1), h('div', { class: 'seat-main' }, h('b', null, '空位'), isHost ? h('div', { class: 'seat-ai' }, Select({ value: 'normal', options: AI_OPTS, block: false, label: '電腦難度', onChange: (lv) => { selAi = lv; } }), Btn({ label: '加入電腦', size: 'sm', onClick: () => net.emit('room:ai:add', { level: selAi }) })) : h('small', null, '等待加入…'))));
        continue;
      }
      const isAi = m.role === 'ai';
      seatsBox.append(h('div', { class: 'seat' + (m.host ? ' host' : '') },
        h('span', { class: 'seat-n' }, i + 1),
        h('div', { class: 'seat-main' },
          h('b', null, m.name, m.id === me.id ? h('i', null, '（你）') : null, m.host ? icon('crown', 16) : null),
          isAi ? (isHost ? h('div', { class: 'seat-ai' }, Select({ value: m.ai, options: AI_OPTS, block: false, label: '電腦難度', onChange: (lv) => net.emit('room:ai:level', { id: m.id, level: lv }) }), Btn({ label: '移除', size: 'sm', onClick: () => net.emit('room:ai:remove', { id: m.id }) })) : h('small', null, `電腦・${diffLabel(m.ai)}`))
            : h('small', null, m.host ? '房主' : m.ready ? '已準備' : '未準備', m.connected ? '' : '・連線中斷')),
        !isAi && isHost && m.id !== me.id ? Btn({ label: '請出', size: 'sm', onClick: () => net.emit('room:kick', { id: m.id }) }) : null));
    }
    // 側邊：設定、邀請、觀戰者
    sideBox.textContent = '';
    const sec = (t, ...k) => h('section', { class: 'rs' }, h('h3', null, t), ...k);
    sideBox.append(sec('房間設定',
      isHost ? [Select({ label: '難度', value: v.settings.difficulty, options: DIFF_OPTS, onChange: (d) => net.emit('room:settings', { difficulty: d }) }),
        Stepper({ label: '人數上限', value: v.settings.maxPlayers, min: Math.max(2, seated.length), max: 4, onChange: (n) => net.emit('room:settings', { maxPlayers: n }) }),
        Stepper({ label: '每人生命', value: v.settings.lives, min: 0, max: 5, format: (x) => (x === 0 ? '預設' : x + ' 顆'), onChange: (n) => net.emit('room:settings', { lives: n }) }),
        Select({ label: '樓層形狀', value: v.settings.shapes || 'off', options: SHAPE_OPTS, onChange: (d) => net.emit('room:settings', { shapes: d }) })]
        : h('p', { class: 'muted' }, `難度 ${diffLabel(v.settings.difficulty)}・每人生命 ${v.settings.lives || '預設'}・形狀 ${(SHAPE_OPTS.find((o) => o.value === (v.settings.shapes || 'off')) || SHAPE_OPTS[0]).label}・上限 ${v.settings.maxPlayers} 人（由房主設定）`)));
    if (v.invite) {
      sideBox.append(sec('邀請朋友',
        h('div', { class: 'inv-btns' }, Btn({ label: '複製玩家連結', ico: 'link', size: 'sm', onClick: () => copyText(inviteLink(v.id, v.invite.player), '玩家邀請連結') }), Btn({ label: '複製觀戰連結', ico: 'eye', size: 'sm', onClick: () => copyText(inviteLink(v.id, v.invite.spectator), '觀戰邀請連結') })),
        isHost ? Btn({ label: '撤銷並重發連結', size: 'sm', onClick: async () => { const r = await net.emit('room:revoke', {}); r.ok && toast('舊連結已失效，已產生新連結'); } }) : null));
    }
    const specs = members.filter((m) => m.role === 'spectator');
    sideBox.append(sec(`觀戰者（${specs.length}）`, specs.length ? h('ul', { class: 'spec-list' }, specs.map((m) => h('li', null, icon('eye', 14), m.name, m.id === me.id ? '（你）' : '', isHost ? Btn({ label: '請出', size: 'xs', onClick: () => net.emit('room:kick', { id: m.id }) }) : null))) : h('p', { class: 'muted' }, '目前沒有人觀戰')));
    // 操作
    actBox.textContent = '';
    const cs = v.canStart;
    if (isHost) {
      actBox.append(Btn({ label: v.status === 'ended' ? '再來一局' : '開始對局', kind: 'primary', size: 'lg', block: true, disabled: !cs.ok, onClick: async () => { const r = await net.emit('room:start', {}); if (!r.ok) toast(r.msg || '不能開始'); } }));
      if (!cs.ok) actBox.append(h('p', { class: 'muted center' }, cs.msg));
    } else if (me.role === 'player') {
      actBox.append(Toggle({ label: '我準備好了', value: members.find((m) => m.id === me.id).ready, onChange: (r) => net.emit('room:ready', { ready: r }) }), Btn({ label: '改為觀戰', size: 'sm', onClick: () => net.emit('room:watch', {}) }));
    } else {
      const free = seated.length < v.settings.maxPlayers;
      actBox.append(h('p', { class: 'muted center' }, '你是觀戰者，可以聊天。'), Btn({ label: '入座加入對戰', kind: 'primary', block: true, disabled: !free, onClick: () => net.emit('room:seat', {}) }));
    }
    actBox.append(Btn({ label: '離開房間', kind: 'danger', size: 'sm', onClick: () => leaveOnline(true) }));
  }
  let selAi = 'normal';
  const body = h('div', { class: 'room-grid' }, h('div', { class: 'room-main' }, headBox, seatsBox, actBox), sideBox, h('div', { class: 'room-chat' }, h('h3', null, '聊天室'), chat.el));
  const page = Page({ title: '房間', back: { label: '離開', fn: () => leaveOnline(true) }, children: body, cls: 'room-page' });
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
    el: Page({ title: '無法顯示 3D', back: { fn: () => go('home') }, narrow: true, children: [
      h('p', null, '這個瀏覽器或裝置目前無法使用 3D 繪圖（WebGL），所以無法顯示遊戲畫面。'),
      h('p', { class: 'muted' }, '請試著更新瀏覽器、開啟「硬體加速」，或換成 Chrome、Safari、Edge 的最新版本後再試。'),
      Btn({ label: '回到首頁', kind: 'primary', size: 'lg', block: true, onClick: () => go('home') }),
    ] }),
  };
}
function game(p) {
  if (!webglSupported()) return noWebGL();
  let s;
  if (p.kind === 'local') {
    s = GameScreen({
      kind: 'local', mode: p.mode, diff: p.diff, players: p.players, lives: p.lives, shapes: p.shapes,
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
document.body.append(h('div', { class: 'gear-wrap' }, IconBtn({ ico: 'toolbox', label: '設定', size: 28, cls: 'gear-btn', onClick: () => openSettings() })));
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
