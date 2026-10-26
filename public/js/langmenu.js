/* 語言切換鈕：放在右上角設定鈕旁（和射氣球等遊戲一致），地球圖示＋目前語言徽章，點開三個選項的小選單。
 * 選單沿用自訂 .sel-pop 外觀，鍵盤可用（↑↓、Esc），選了就套用並由 app.js 的 onLangChange 處理重新載入。 */
import { t, getLang, setLang, onLangChange, SUPPORTED, LANG_NAMES } from './i18n.js';
import { h, IconBtn } from './ui.js';

const BADGE = { 'zh-Hant': '繁', 'zh-Hans': '简', en: 'EN' };
let pop = null;

export function LangButton() {
  const btn = IconBtn({ ico: 'globe', label: t('語言'), size: 26, cls: 'lang-btn', onClick: () => (pop ? close() : open()) });
  btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
  const badge = h('span', { class: 'lang-badge', 'aria-hidden': 'true' }, BADGE[getLang()]);
  btn.append(badge);
  onLangChange(() => { badge.textContent = BADGE[getLang()]; });

  function onDoc(e) { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) close(); }
  function close(focus) {
    if (!pop) return;
    pop.remove(); pop = null; btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDoc, true); window.removeEventListener('resize', close);
    if (focus) btn.focus();
  }
  function open() {
    pop = h('div', { class: 'sel-pop lang-pop', role: 'menu', 'aria-label': t('語言') });
    for (const code of SUPPORTED) {
      const it = h('button', { type: 'button', role: 'menuitemradio', lang: code, class: 'sel-opt lang-opt' + (code === getLang() ? ' cur' : ''), 'aria-checked': String(code === getLang()) }, LANG_NAMES[code]);
      it.addEventListener('click', () => { close(true); setLang(code); });
      it.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); (it.nextElementSibling || pop.firstElementChild).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (it.previousElementSibling || pop.lastElementChild).focus(); }
        else if (e.key === 'Escape') { e.stopPropagation(); close(true); }
        else if (e.key === 'Tab') close();
      });
      pop.append(it);
    }
    const r = btn.getBoundingClientRect();
    pop.style.position = 'fixed'; pop.style.top = (r.bottom + 6) + 'px'; pop.style.width = '168px';
    pop.style.left = Math.max(8, Math.min(r.right - 168, window.innerWidth - 176)) + 'px';
    document.body.append(pop);
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onDoc, true); window.addEventListener('resize', close);
    (pop.querySelector('.cur') || pop.firstElementChild).focus();
  }
  return btn;
}
