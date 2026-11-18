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

export function wonConfirm({ customer, total, busy, onCancel, onConfirm }) {
  const amount = total == null ? '' : ` (${fmt(total)})`;
  return h('div', { class: 'modal', id: 'won-confirm', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'won-confirm-title' },
    h('div', { class: 'modal-card' },
      h('h3', { id: 'won-confirm-title' }, 'Mark this estimate won?'),
      h('p', {}, `${customer || 'This customer'}${amount} will be marked won. The HubSpot deal moves to Closed Won.`),
      h('div', { class: 'row gap wrap' },
        h('button', { type: 'button', class: 'btn', id: 'won-cancel', onclick: onCancel }, 'Cancel'),
        h('button', { type: 'button', class: 'btn primary', id: 'won-confirm-yes', disabled: busy ? true : null, onclick: onConfirm }, busy ? 'Saving…' : 'Mark won'))));
}

export function deleteConfirm({ customer, busy, onCancel, onConfirm }) {
  return h('div', { class: 'modal', id: 'delete-confirm', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'delete-confirm-title' },
    h('div', { class: 'modal-card' },
      h('h3', { id: 'delete-confirm-title' }, "Delete this estimate? This can't be undone."),
      customer ? h('p', {}, h('b', {}, customer)) : null,
      h('div', { class: 'row gap wrap' },
        h('button', { type: 'button', class: 'btn', id: 'delete-cancel', onclick: onCancel }, 'Cancel'),
        h('button', { type: 'button', class: 'btn danger', id: 'delete-confirm-yes', disabled: busy ? true : null, onclick: onConfirm }, busy ? 'Deleting…' : 'Delete'))));
}
