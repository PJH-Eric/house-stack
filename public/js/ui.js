/*
 * 疊疊高塔 — 自訂 UI 元件庫
 * 所有玩家可見的控制項都由這裡封裝：按鈕、開關、滑桿、選單、輸入框、彈窗、捲動區（含自訂捲軸）。
 * 內部保留必要的語意元素與 ARIA，外觀完全由 css/style.css 的木質風格負責，不顯示瀏覽器預設控制項。
 */

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}

export const ICONS = {
  toolbox: '<path fill-rule="evenodd" d="M8 7V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1h-2V6h-4v1H8ZM4 7h16a2 2 0 0 1 2 2v3H2V9a2 2 0 0 1 2-2Zm-2 6h6.5v1.8h7V13H22v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5Z"/>',
  gear: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.2 5.1-1.7-.3a6.9 6.9 0 0 0-.6-1.4l1-1.4a.8.8 0 0 0-.1-1l-1.3-1.3a.8.8 0 0 0-1-.1l-1.4 1a6.9 6.9 0 0 0-1.4-.6l-.3-1.7a.8.8 0 0 0-.8-.7h-1.8a.8.8 0 0 0-.8.7l-.3 1.7c-.5.1-1 .3-1.4.6l-1.4-1a.8.8 0 0 0-1 .1L5.1 9.5a.8.8 0 0 0-.1 1l1 1.4c-.3.4-.5.9-.6 1.4l-1.7.3a.8.8 0 0 0-.7.8v1.8c0 .4.3.8.7.8l1.7.3c.1.5.3 1 .6 1.4l-1 1.4a.8.8 0 0 0 .1 1l1.3 1.3c.3.3.7.3 1 .1l1.4-1c.4.3.9.5 1.4.6l.3 1.7c.1.4.4.7.8.7h1.8c.4 0 .8-.3.8-.7l.3-1.7c.5-.1 1-.3 1.4-.6l1.4 1c.3.2.7.2 1-.1l1.3-1.3c.3-.3.3-.7.1-1l-1-1.4c.3-.4.5-.9.6-1.4l1.7-.3c.4-.1.7-.4.7-.8v-1.8a.8.8 0 0 0-.7-.8Z"/>',
  rotL: '<path d="M7.6 6.4A8 8 0 1 1 4 12h2.4A5.6 5.6 0 1 0 9 7.3L11 9.4H4.6V3l3 3.4Z"/>',
  rotR: '<path d="M16.4 6.4A8 8 0 1 0 20 12h-2.4A5.6 5.6 0 1 1 15 7.3L13 9.4h6.4V3l-3 3.4Z"/>',
  drop: '<path d="M10 3h4v9h4l-6 8-6-8h4V3Z"/>',
  info: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1.2 15h-2.4v-6h2.4v6Zm0-8h-2.4V6.8h2.4V9Z"/>',
  chat: '<path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>',
  home: '<path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3L12 3Z"/>',
  heart: '<path d="M12 21s-8-5.6-8-11.2A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 2.8C20 15.4 12 21 12 21Z"/>',
  eye: '<path d="M12 5C6.5 5 2.7 9.3 1.5 12c1.2 2.7 5 7 10.5 7s9.3-4.3 10.5-7C21.300 9.300 17.500 5 12 5Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/>',
  link: '<path d="M10.6 13.4a3.4 3.4 0 0 0 4.800 0l3-3a3.400 3.400 0 0 0-4.800-4.800l-1 1 1.400 1.400 1-1a1.400 1.400 0 0 1 2 2l-3 3a1.400 1.400 0 0 1-2 0l-1.400 1.400ZM13.400 10.600a3.400 3.400 0 0 0-4.800 0l-3 3a3.400 3.400 0 0 0 4.800 4.800l1-1-1.400-1.400-1 1a1.400 1.400 0 0 1-2-2l3-3a1.400 1.400 0 0 1 2 0l1.400-1.400Z"/>',
  close: '<path d="M5.700 4.300 12 10.600l6.300-6.300 1.400 1.400-6.300 6.300 6.300 6.300-1.400 1.400-6.300-6.300-6.300 6.300-1.400-1.400 6.300-6.300-6.300-6.300 1.400-1.400Z"/>',
  play: '<path d="M7 4v16l13-8L7 4Z"/>',
  crown: '<path d="m3 8 4.500 4L12 5l4.500 7L21 8l-2 11H5L3 8Z"/>',
  chevL: '<path d="m15 4-8 8 8 8 1.800-1.800L10.600 12l6.200-6.200L15 4Z"/>',
  plus: '<path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z"/>',
  minus: '<path d="M4 11h16v2H4v-2Z"/>',
  check: '<path d="m9.500 17.500-5-5 1.800-1.800 3.200 3.200 8.200-8.200 1.800 1.800-10 10Z"/>',
};
export function icon(name, size = 22) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'ico');
  s.innerHTML = ICONS[name] || '';
  return s;
}

/* ---------- 按鈕 / 鍵帽 ---------- */
export function KeyCap(text) { return h('span', { class: 'keycap', 'aria-hidden': 'true' }, text); }

export function Btn({ label, ico, kind = 'plain', size = 'md', onClick, disabled, keycap, title, ariaLabel, block, badge, cls } = {}) {
  const b = h('button', {
    type: 'button', class: `btn btn-${kind} btn-${size}${block ? ' btn-block' : ''}${cls ? ' ' + cls : ''}`,
    title, 'aria-label': ariaLabel || (typeof label === 'string' ? label : undefined),
    disabled: disabled ? true : null,
  });
  if (ico) b.append(icon(ico, size === 'lg' ? 28 : 20));
  if (label != null) b.append(h('span', { class: 'btn-label' }, label));
  if (keycap) b.append(KeyCap(keycap));
  if (badge) b.append(h('span', { class: 'btn-badge' }, badge));
  b.addEventListener('click', (e) => { if (!b.disabled && onClick) onClick(e); });
  return b;
}
export function IconBtn({ ico, label, onClick, size = 22, badge, cls }) {
  const b = h('button', { type: 'button', class: 'icon-btn' + (cls ? ' ' + cls : ''), 'aria-label': label, title: label });
  b.append(icon(ico, size));
  if (badge) b.append(h('span', { class: 'btn-badge' }, badge));
  b.addEventListener('click', onClick);
  return b;
}

/* ---------- 開關 ---------- */
export function Toggle({ label, value, onChange, hint }) {
  let v = !!value;
  const knob = h('span', { class: 'tg-knob' });
  const sw = h('button', { type: 'button', class: 'tg', role: 'switch', 'aria-checked': String(v), 'aria-label': label }, knob);
  const set = (nv, fire) => { v = nv; sw.setAttribute('aria-checked', String(v)); sw.classList.toggle('on', v); if (fire && onChange) onChange(v); };
  sw.classList.toggle('on', v);
  sw.addEventListener('click', () => set(!v, true));
  const row = h('div', { class: 'row-ctl' }, h('div', { class: 'row-text' }, h('div', { class: 'row-label' }, label), hint ? h('div', { class: 'row-hint' }, hint) : null), sw);
  row.set = (nv) => set(nv, false);
  return row;
}

/* ---------- 滑桿（自繪） ---------- */
export function Slider({ label, value, min = 0, max = 100, step = 1, onChange, format }) {
  let v = value;
  const fill = h('div', { class: 'sl-fill' });
  const thumb = h('div', { class: 'sl-thumb' });
  const track = h('div', { class: 'sl-track' }, fill, thumb);
  const out = h('span', { class: 'sl-val' });
  const el = h('div', { class: 'sl', role: 'slider', tabindex: '0', 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max }, track);
  const paint = () => {
    const p = (v - min) / (max - min);
    fill.style.width = p * 100 + '%'; thumb.style.left = p * 100 + '%';
    el.setAttribute('aria-valuenow', v);
    out.textContent = format ? format(v) : String(v);
  };
  const setFromX = (clientX) => {
    const r = track.getBoundingClientRect();
    let p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    let nv = Math.round((min + p * (max - min)) / step) * step;
    nv = Math.max(min, Math.min(max, nv));
    if (nv !== v) { v = nv; paint(); onChange && onChange(v); }
  };
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); setFromX(e.clientX); el.dataset.drag = '1'; });
  el.addEventListener('pointermove', (e) => { if (el.dataset.drag) setFromX(e.clientX); });
  const end = () => { delete el.dataset.drag; };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : 0;
    if (d) { e.preventDefault(); v = Math.max(min, Math.min(max, v + d)); paint(); onChange && onChange(v); }
  });
  paint();
  return h('div', { class: 'row-ctl row-slider' }, h('div', { class: 'row-text' }, h('div', { class: 'row-label' }, label)), h('div', { class: 'sl-wrap' }, el, out));
}

/* ---------- 步進器（± 按鈕） ---------- */
export function Stepper({ label, value, min, max, onChange, format }) {
  let v = value;
  const out = h('span', { class: 'st-val', 'aria-live': 'polite' }, format ? format(v) : v);
  const minus = Btn({ ico: 'minus', size: 'sm', ariaLabel: `${label} 減少`, onClick: () => set(v - 1) });
  const plus = Btn({ ico: 'plus', size: 'sm', ariaLabel: `${label} 增加`, onClick: () => set(v + 1) });
  function set(n) { n = Math.max(min, Math.min(max, n)); if (n === v) return; v = n; out.textContent = format ? format(v) : v; onChange && onChange(v); sync(); }
  function sync() { minus.disabled = v <= min; plus.disabled = v >= max; }
  sync();
  const el = h('div', { class: 'row-ctl' }, h('div', { class: 'row-text' }, h('div', { class: 'row-label' }, label)), h('div', { class: 'stepper' }, minus, out, plus));
  el.set = (n) => { v = n; out.textContent = format ? format(v) : v; sync(); };
  return el;
}

/* ---------- 選單（自製下拉） ---------- */
export function Select({ label, value, options, onChange, block = true, disabled }) {
  let v = value;
  const cur = () => options.find((o) => o.value === v) || options[0];
  const txt = h('span', { class: 'sel-text' }, cur().label);
  const btn = h('button', { type: 'button', class: 'sel-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': label, disabled: disabled ? true : null }, txt, h('span', { class: 'sel-caret', 'aria-hidden': 'true' }, '▾'));
  const root = h('div', { class: 'sel' + (block ? ' sel-block' : '') }, btn);
  let pop = null;
  const close = () => {
    if (!pop) return;
    pop.remove(); pop = null; btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDoc, true);
    window.removeEventListener('resize', close); window.removeEventListener('scroll', onScroll, true);
  };
  const onScroll = (e) => { if (pop && !pop.contains(e.target)) close(); };
  const onDoc = (e) => { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) close(); };
  const pick = (o) => { v = o.value; txt.textContent = o.label; close(); onChange && onChange(v); btn.focus(); };
  btn.addEventListener('click', () => {
    if (pop) return close();
    pop = h('div', { class: 'sel-pop', role: 'listbox' });
    const sa = ScrollArea(h('div', { class: 'sel-list' }, options.map((o) => {
      const it = h('button', { type: 'button', role: 'option', class: 'sel-opt' + (o.value === v ? ' cur' : ''), 'aria-selected': String(o.value === v) }, o.label, o.sub ? h('small', null, o.sub) : null);
      it.addEventListener('click', () => pick(o));
      it.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); (it.nextElementSibling || it).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (it.previousElementSibling || it).focus(); }
        else if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); }
      });
      return it;
    })), { maxHeight: 240 });
    pop.append(sa);
    const r = btn.getBoundingClientRect();
    const below = window.innerHeight - r.bottom, estH = Math.min(244, options.length * 46 + 8);
    pop.style.position = 'fixed'; pop.style.left = r.left + 'px'; pop.style.width = Math.max(r.width, 180) + 'px';
    if (below < estH + 12 && r.top > below) { pop.style.bottom = (window.innerHeight - r.top + 4) + 'px'; } else { pop.style.top = (r.bottom + 4) + 'px'; }
    document.body.append(pop);
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onDoc, true);
    window.addEventListener('resize', close); window.addEventListener('scroll', onScroll, true);
    const sel = pop.querySelector('.cur') || pop.querySelector('.sel-opt');
    sel && sel.focus();
  });
  root.set = (nv) => { v = nv; txt.textContent = cur().label; };
  root.closeMenu = close;
  const wrap = label ? h('div', { class: 'row-ctl row-select' }, h('div', { class: 'row-text' }, h('div', { class: 'row-label' }, label)), root) : root;
  wrap.set = root.set;
  return wrap;
}

/* ---------- 輸入框 ---------- */
export function TextField({ value = '', placeholder, maxLength, onInput, onEnter, label, cls, autocomplete = 'off' }) {
  const inp = h('input', { type: 'text', class: 'tf-input', value, placeholder, maxlength: maxLength, 'aria-label': label || placeholder, autocomplete, spellcheck: 'false' });
  inp.addEventListener('input', () => onInput && onInput(inp.value));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(inp.value); } e.stopPropagation(); });
  const el = h('div', { class: 'tf' + (cls ? ' ' + cls : '') }, inp);
  el.input = inp;
  return el;
}

/* ---------- 自訂捲動區（含自繪捲軸，隱藏原生捲軸） ---------- */
export function ScrollArea(content, { maxHeight, horizontal = false, cls, stick = false } = {}) {
  const view = h('div', { class: 'sa-view' + (horizontal ? ' sa-x' : ''), tabindex: '0' }, content);
  const thumbV = h('div', { class: 'sa-thumb' });
  const trackV = h('div', { class: 'sa-track', 'aria-hidden': 'true' }, thumbV);
  const thumbH = h('div', { class: 'sa-thumb' });
  const trackH = h('div', { class: 'sa-track sa-track-h', 'aria-hidden': 'true' }, thumbH);
  const root = h('div', { class: 'sa' + (cls ? ' ' + cls : ''), style: maxHeight ? { maxHeight: maxHeight + 'px' } : null }, view, trackV, horizontal ? trackH : null);
  const paint = () => {
    const { scrollTop, scrollHeight, clientHeight, scrollLeft, scrollWidth, clientWidth } = view;
    const needV = scrollHeight > clientHeight + 1;
    trackV.style.display = needV ? '' : 'none';
    if (needV) {
      const th = Math.max(28, (clientHeight / scrollHeight) * clientHeight);
      thumbV.style.height = th + 'px';
      thumbV.style.transform = `translateY(${(scrollTop / (scrollHeight - clientHeight)) * (clientHeight - th)}px)`;
    }
    if (horizontal) {
      const needH = scrollWidth > clientWidth + 1;
      trackH.style.display = needH ? '' : 'none';
      if (needH) {
        const tw = Math.max(28, (clientWidth / scrollWidth) * clientWidth);
        thumbH.style.width = tw + 'px';
        thumbH.style.transform = `translateX(${(scrollLeft / (scrollWidth - clientWidth)) * (clientWidth - tw)}px)`;
      }
    }
  };
  view.addEventListener('scroll', paint, { passive: true });
  if (window.ResizeObserver) { const ro = new ResizeObserver(paint); ro.observe(view); ro.observe(content); }
  else window.addEventListener('resize', paint);
  const drag = (thumb, axis) => {
    thumb.addEventListener('pointerdown', (e) => {
      e.preventDefault(); thumb.setPointerCapture(e.pointerId);
      const start = axis === 'y' ? e.clientY : e.clientX;
      const s0 = axis === 'y' ? view.scrollTop : view.scrollLeft;
      const move = (ev) => {
        const d = (axis === 'y' ? ev.clientY : ev.clientX) - start;
        if (axis === 'y') view.scrollTop = s0 + d * (view.scrollHeight / view.clientHeight);
        else view.scrollLeft = s0 + d * (view.scrollWidth / view.clientWidth);
      };
      const up = () => { thumb.removeEventListener('pointermove', move); thumb.removeEventListener('pointerup', up); thumb.removeEventListener('pointercancel', up); };
      thumb.addEventListener('pointermove', move); thumb.addEventListener('pointerup', up); thumb.addEventListener('pointercancel', up);
    });
  };
  drag(thumbV, 'y'); if (horizontal) drag(thumbH, 'x');
  root.view = view;
  root.refresh = () => { requestAnimationFrame(paint); if (stick) view.scrollTop = view.scrollHeight; };
  root.toBottom = () => { view.scrollTop = view.scrollHeight; paint(); };
  requestAnimationFrame(paint);
  return root;
}

/* ---------- 彈窗（焦點鎖定、Esc、遮罩、返回原焦點） ---------- */
const modalStack = [];
export function Modal({ title, body, actions, onClose, dismissible = true, cls, wide, role = 'dialog', labelledBy }) {
  const prev = document.activeElement;
  const titleId = 'mt' + Math.random().toString(36).slice(2, 7);
  const closeBtn = dismissible ? IconBtn({ ico: 'close', label: '關閉', onClick: () => api.close(), size: 20, cls: 'modal-x' }) : null;
  const sa = ScrollArea(h('div', { class: 'modal-body' }, body), { cls: 'modal-scroll' });
  const dlg = h('div', { class: 'modal' + (wide ? ' modal-wide' : '') + (cls ? ' ' + cls : ''), role, 'aria-modal': 'true', 'aria-labelledby': title ? titleId : labelledBy, tabindex: '-1' },
    title ? h('div', { class: 'modal-head' }, h('h2', { id: titleId }, title), closeBtn) : closeBtn,
    sa,
    actions ? h('div', { class: 'modal-actions' }, actions) : null);
  const mask = h('div', { class: 'modal-mask' }, dlg);
  const api = {
    el: mask, dialog: dlg,
    close(silent) {
      const i = modalStack.indexOf(api); if (i >= 0) modalStack.splice(i, 1);
      document.removeEventListener('keydown', onKey, true);
      mask.classList.add('out');
      setTimeout(() => mask.remove(), 120);
      if (prev && prev.focus && document.contains(prev)) prev.focus();
      if (!silent && onClose) onClose();
    },
  };
  const focusables = () => [...dlg.querySelectorAll('button:not([disabled]), input, [tabindex="0"]')].filter((e) => e.offsetParent !== null);
  function onKey(e) {
    if (modalStack[modalStack.length - 1] !== api) return;
    if (e.key === 'Escape' && dismissible) { e.preventDefault(); e.stopPropagation(); api.close(); }
    else if (e.key === 'Tab') {
      const f = focusables(); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!dlg.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
  }
  if (dismissible) mask.addEventListener('pointerdown', (e) => { if (e.target === mask) api.close(); });
  document.addEventListener('keydown', onKey, true);
  modalStack.push(api);
  document.body.append(mask);
  requestAnimationFrame(() => { sa.refresh(); const f = focusables(); (f.find((x) => x.classList.contains('btn-primary')) || f[0] || dlg).focus(); });
  return api;
}
export const hasModal = () => modalStack.length > 0;

/* ---------- 其他 ---------- */
export function Hearts(n, max, cls = '') {
  const w = h('span', { class: 'hearts ' + cls, role: 'img', 'aria-label': `生命 ${n}/${max}` });
  for (let i = 0; i < max; i++) { const s = icon('heart', 16); s.classList.add(i < n ? 'on' : 'off'); w.append(s); }
  return w;
}
export function Badge(text, kind = '') { return h('span', { class: 'badge ' + kind }, text); }

let toastEl = null, toastT = 0;
export function toast(msg, ms = 2400) {
  if (!toastEl) { toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(toastEl); }
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), ms);
}

export function Panel(cls, ...kids) { return h('section', { class: 'panel' + (cls ? ' ' + cls : '') }, ...kids); }
