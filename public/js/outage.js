/* 線上伺服器暫停提示：只在線上大廳／等待房間，連續 30 秒連不上伺服器才跳出（伺服器過載休息或停機時）。
 * 首頁、單機、對局中不計時；連上或離開就取消；同一次故障只提示一次。 */
import { t, getLang } from './i18n.js';
import { h, Btn, Modal } from './ui.js';
import { CONFIG } from './config.js';
import { net } from './net.js';

const WAIT_MS = 30000;
const SPONSOR_URL = 'https://portaly.cc/pjh-eric/support';
const SPONSOR_WORD = { 'zh-Hans': '赞助', en: 'Sponsorships' };

/* 把提示文字中的「贊助」變成贊助連結 */
function sponsorParts(text, lang = getLang()) {
  const word = SPONSOR_WORD[lang] || '贊助';
  const at = text.indexOf(word);
  if (at < 0) return [text];
  return [text.slice(0, at), h('a', { href: SPONSOR_URL, target: '_blank', rel: 'noopener noreferrer', style: { color: 'inherit', fontWeight: '900', textDecoration: 'underline' } }, word), text.slice(at + word.length)];
}

let timer = 0, modal = null, shownThisOutage = false, eligible = false;

function cancel() { clearTimeout(timer); timer = 0; }
function hide() { if (modal) { const m = modal; modal = null; m.close(true); } }

function show() {
  timer = 0;
  if (!eligible || net.connected || shownThisOutage || modal) return;
  shownThisOutage = true;
  modal = Modal({
    title: t('目前伺服器過載休息中'), role: 'alertdialog',
    body: [h('p', null, ...sponsorParts(t('歡迎贊助升級')))],
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
