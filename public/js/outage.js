/* 線上伺服器暫停提示：只在線上大廳／等待房間，連續 30 秒連不上伺服器才跳出（免費主機額度用完或停機時）。
 * 首頁、單機、對局中不計時；連上或離開就取消；同一次故障只提示一次。 */
import { t, getLang } from './i18n.js';
import { h, Btn, Modal } from './ui.js';
import { CONFIG } from './config.js';
import { net } from './net.js';

const WAIT_MS = 30000;
let timer = 0, modal = null, shownThisOutage = false, eligible = false;

/* 免費額度於次月 1 日重置：中文顯示月份數字，英文顯示「November 1」 */
export function nextResetText(now = new Date(), lang = getLang()) {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return lang === 'en' ? next.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : String(next.getMonth() + 1);
}

function cancel() { clearTimeout(timer); timer = 0; }
function hide() { if (modal) { const m = modal; modal = null; m.close(true); } }

function show() {
  timer = 0;
  if (!eligible || net.connected || shownThisOutage || modal) return;
  shownThisOutage = true;
  modal = Modal({
    title: t('線上暫時無法連線'), role: 'alertdialog',
    body: [h('p', null, t('免費伺服器額度將於 {date} 月 1 日重置，期間可繼續遊玩單機版。', { date: nextResetText() }))],
    actions: [Btn({ label: t('知道了'), kind: 'primary', onClick: () => hide() })],
    onClose: () => { modal = null; },
  });
}

function arm() {
  if (timer || shownThisOutage || !eligible || net.connected || !CONFIG.onlineAvailable) return;
  timer = setTimeout(show, WAIT_MS);
}

export const Outage = {
  /** 畫面切換時呼叫：只有大廳與等待房間算數 */
  setScreen(name) {
    const next = name === 'lobby' || name === 'room';
    if (next === eligible) return;
    eligible = next;
    cancel();
    if (!eligible) { hide(); return; }
    arm();
  },
  /** 連線狀態：'up' 連上（重置本次故障）、'down' 斷線 */
  status(state) {
    if (state === 'up') { shownThisOutage = false; cancel(); hide(); } else arm();
  },
};
