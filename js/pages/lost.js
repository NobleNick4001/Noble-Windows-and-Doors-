import { h, fmt } from '../core.js';

export function lostConfirm({ customer, total, busy, onCancel, onConfirm }) {
  const amount = total == null ? '' : ` (${fmt(total)})`;
  return h('div', { class: 'modal', id: 'lost-confirm', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lost-confirm-title' },
    h('div', { class: 'modal-card' },
      h('h3', { id: 'lost-confirm-title' }, 'Mark this estimate lost?'),
      h('p', {}, `${customer || 'This customer'}${amount} will be marked lost. The HubSpot deal moves to Closed Lost, and open follow-ups are closed.`),
      h('div', { class: 'row gap wrap' },
        h('button', { type: 'button', class: 'btn', id: 'lost-cancel', onclick: onCancel }, 'Cancel'),
        h('button', { type: 'button', class: 'btn danger', id: 'lost-confirm-yes', disabled: busy ? true : null, onclick: onConfirm }, busy ? 'Saving…' : 'Mark lost'))));
}
