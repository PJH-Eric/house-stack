/* 連線延遲徽章：只在線上畫面（大廳、房間、線上對局）顯示，放在右上角設定鈕左邊。
 * 每 2.5 秒向伺服器送一次 latency:ping（極小封包、只回 ack）量測往返時間；離開線上畫面就停止計時器。
 * 顏色：≤30ms 綠、<100ms 黃、其餘紅；量不到顯示「--」。 */
import { t } from './i18n.js';
import { h } from './ui.js';
import { getSocket } from './net.js';

let el = null, valueEl = null, timer = 0, active = false, value = null, seq = 0;

function ensure() {
  if (el) return el;
  valueEl = h('span', { class: 'latency__value' }, '--');
  el = h('div', { class: 'latency is-unknown', role: 'status', 'aria-live': 'off', hidden: true }, h('span', { class: 'latency__dot', 'aria-hidden': 'true' }), valueEl, h('span', { class: 'latency__unit' }, 'ms'));
  const wrap = document.querySelector('.gear-wrap');
  (wrap || document.body).prepend(el);
  return el;
}

function render() {
  ensure();
  el.hidden = !active;
  const ms = value === null ? null : Math.round(value);
  el.classList.remove('is-good', 'is-warn', 'is-bad', 'is-unknown');
  el.classList.add('is-' + (ms === null ? 'unknown' : ms <= 30 ? 'good' : ms < 100 ? 'warn' : 'bad'));
  valueEl.textContent = ms === null ? '--' : String(ms);
  const label = ms === null ? t('連線延遲：等待回應') : t('連線延遲：{ms} 毫秒', { ms });
  el.setAttribute('aria-label', label); el.title = label;
}

function probe() {
  const s = getSocket();
  if (!s || !s.connected) { value = null; render(); return; }
  const started = performance.now(), mine = ++seq;
  const guard = setTimeout(() => { if (mine === seq) { value = null; render(); } }, 4500);
  s.emit('latency:ping', { at: started }, () => { clearTimeout(guard); if (mine === seq) { value = performance.now() - started; render(); } });
}

export const Latency = {
  setActive(on) {
    on = !!on;
    if (on === active) return;
    active = on;
    clearInterval(timer); timer = 0;
    if (active) { value = null; render(); probe(); timer = setInterval(probe, 2500); } else { value = null; render(); }
  },
  refresh() { if (el) render(); },
};
