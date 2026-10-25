/* 聊天室元件：自由輸入 + 快捷短語；觀戰者也能發言。 */
import { h, Btn, TextField, ScrollArea } from './ui.js';

export const QUICK = ['加油！', '好險！', '哇～好高', '再來一局'];

export function Chat({ onSend, cls }) {
  const list = h('div', { class: 'chat-list', role: 'log', 'aria-live': 'polite' });
  const sa = ScrollArea(list, { cls: 'chat-scroll' });
  let tf;
  const send = (text) => { const t = String(text || '').trim(); if (!t) return; onSend && onSend(t); if (tf) tf.input.value = ''; };
  tf = TextField({ placeholder: '輸入訊息…', maxLength: 120, label: '聊天訊息', onEnter: send });
  const quick = h('div', { class: 'chat-quick' }, QUICK.map((q) => Btn({ label: q, size: 'xs', onClick: () => send(q) })));
  const el = h('div', { class: 'chat' + (cls ? ' ' + cls : '') }, sa, quick, h('div', { class: 'chat-input' }, tf, Btn({ label: '送出', size: 'sm', kind: 'primary', onClick: () => send(tf.input.value) })));
  function row(m) {
    if (m.sys) return h('div', { class: 'chat-row sys' }, m.text);
    return h('div', { class: 'chat-row' + (m.role === 'spectator' ? ' spec' : '') }, h('b', null, m.name, m.role === 'spectator' ? h('i', null, ' 觀') : null, '：'), h('span', null, m.text));
  }
  return {
    el,
    add(m) { list.append(row(m)); while (list.children.length > 80) list.firstChild.remove(); sa.refresh(); requestAnimationFrame(() => sa.toBottom()); },
    set(ms) { list.textContent = ''; (ms || []).forEach((m) => list.append(row(m))); requestAnimationFrame(() => { sa.refresh(); sa.toBottom(); }); },
    refresh() { sa.refresh(); sa.toBottom(); },
  };
}
