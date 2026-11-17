import { h, toast } from '../core.js';
import { icon } from '../icons.js';
import { isAdmin, currentProfile, listAccounts, sendPasswordReset, setTemporaryPassword } from '../cloud.js';
import { generateTempPassword, passwordError, PASSWORD_HINT } from '../../supabase/functions/account-passwords/password.js';

const fdate = (t) => t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

function slug(email) {
  return String(email || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'account';
}

export function renderDenied(root) {
  root.replaceChildren(h('div', { class: 'page', id: 'accounts-denied' },
    h('div', { class: 'card' },
      h('h1', {}, 'Accounts'),
      h('p', {}, 'Only the admin account can open this page.'))));
}

export async function render(root) {
  if (!isAdmin()) {
    renderDenied(root);
    return;
  }
  mountAccounts(root, {
    selfEmail: String(currentProfile()?.email || '').toLowerCase(),
    load: listAccounts,
    sendReset: sendPasswordReset,
    setTemp: setTemporaryPassword,
  });
}

export function mountAccounts(root, api) {
  let people = api.initial?.people || [];
  let error = api.initial?.error || '';
  let loading = !api.initial;
  let confirm = api.initial?.confirm || null;
  let revealed = api.initial?.revealed || null;
  let busy = false;
  let notice = api.initial?.notice || '';
  const self = String(api.selfEmail || '').toLowerCase();

  const draw = () => {
    const page = h('div', { class: 'page', id: 'accounts-page' });
    page.append(h('div', { class: 'row between wrap gap' },
      h('h1', {}, 'Accounts'),
      h('button', { type: 'button', class: 'btn', id: 'accounts-refresh', onclick: () => reload() }, 'Refresh')));
    page.append(h('p', { class: 'fine' }, 'Passwords are stored as one-way hashes. They cannot be viewed. Send a reset email, or set a temporary password and give it to the rep yourself. A temporary password is shown once on this screen, is not emailed, and must be changed at the next sign-in.'));
    if (notice) page.append(h('p', { class: 'fine', id: 'accounts-notice' }, notice));
    if (loading) page.append(h('p', { class: 'muted' }, 'Loading accounts…'));
    else if (error) page.append(h('div', { class: 'card' }, h('p', { class: 'warn', id: 'accounts-error' }, error)));
    else page.append(list());
    const dialog = overlay();
    if (dialog) page.append(dialog);
    root.replaceChildren(page);
  };

  const list = () => {
    const box = h('div', { id: 'accounts-list', class: 'page' });
    if (!people.length) box.append(h('p', { class: 'muted' }, 'No accounts yet.'));
    people.forEach((person) => {
      const email = String(person.email || '').toLowerCase();
      const mine = email && email === self;
      const id = slug(email);
      const actions = h('div', { class: 'account-actions' });
      if (!person.signed_up) {
        actions.append(h('p', { class: 'fine' }, 'Not signed up yet. They create a password from the sign-in screen after you add them on Admin.'));
      } else {
        actions.append(h('button', {
          type: 'button',
          class: 'btn',
          id: 'btn-reset-' + id,
          onclick: () => { confirm = { kind: 'reset', person, error: '' }; revealed = null; draw(); },
        }, icon('mail'), 'Send password reset email'));
        actions.append(h('button', {
          type: 'button',
          class: 'btn',
          id: 'btn-temp-' + id,
          disabled: mine ? true : null,
          onclick: () => { confirm = { kind: 'temp', person, draft: '', error: '' }; revealed = null; draw(); },
        }, 'Set temporary password'));
        if (mine) actions.append(h('p', { class: 'fine' }, 'Use a reset email for your own account.'));
      }
      box.append(h('div', { class: 'card account-card', id: 'account-' + id },
        h('div', { class: 'row between wrap gap' },
          h('div', {},
            h('b', {}, person.full_name || email || 'Account'),
            h('div', { class: 'fine' }, email)),
          h('span', { class: 'role-pill' + (person.role === 'admin' ? ' admin' : '') }, person.role === 'admin' ? 'Admin' : 'Sales')),
        h('div', { class: 'fine' }, person.signed_up ? 'Created ' + (fdate(person.created_at) || '—') : 'Not signed up yet'),
        h('div', { class: 'fine' }, 'Last sign-in ' + (person.signed_up ? (fdate(person.last_sign_in_at) || 'Never') : '—')),
        person.revoked ? h('div', { class: 'warn' }, 'Revoked. Restore them on the Admin page or they still cannot sign in.') : null,
        person.must_change_password ? h('div', { class: 'fine' }, 'Must set a new password at the next sign-in.') : null,
        actions));
    });
    return box;
  };

  const overlay = () => {
    if (revealed) return revealedDialog();
    if (!confirm) return null;
    const person = confirm.person;
    const who = person.full_name || person.email;
    if (confirm.kind === 'reset') {
      return h('div', { class: 'modal', id: 'password-confirm', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'password-confirm-title' },
        h('div', { class: 'modal-card' },
          h('h3', { id: 'password-confirm-title' }, 'Send password reset email'),
          h('p', {}, 'Send a reset link to ' + who + '?'),
          h('p', { class: 'fine' }, person.email),
          h('p', {}, 'They get Supabase’s email and choose the new password on this app. The email does not include a password, and this screen never shows their current one.'),
          confirm.error ? h('p', { class: 'warn', id: 'confirm-error' }, confirm.error) : null,
          h('div', { class: 'row gap wrap' },
            h('button', { type: 'button', class: 'btn', id: 'confirm-cancel', onclick: () => { confirm = null; draw(); } }, 'Cancel'),
            h('button', { type: 'button', class: 'btn primary', id: 'confirm-reset-yes', disabled: busy ? true : null, onclick: () => doReset(person) }, busy ? 'Sending…' : 'Send email'))));
    }
    return h('div', { class: 'modal', id: 'password-confirm', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'password-confirm-title' },
      h('div', { class: 'modal-card' },
        h('h3', { id: 'password-confirm-title' }, 'Set temporary password'),
        h('p', {}, 'Set a temporary password for ' + who + '?'),
        h('p', { class: 'fine' }, person.email),
        h('p', {}, 'It is shown once after you confirm, for you to give them. It is not emailed. They must choose a new password the next time they sign in.'),
        h('label', { class: 'field' },
          h('span', { class: 'lbl' }, 'Temporary password'),
          h('input', {
            type: 'text',
            id: 'temp-password',
            autocomplete: 'off',
            spellcheck: 'false',
            value: confirm.draft || '',
            oninput: (ev) => { confirm.draft = ev.target.value; },
          })),
        h('p', { class: 'fine' }, PASSWORD_HINT),
        confirm.error ? h('p', { class: 'warn', id: 'confirm-error' }, confirm.error) : null,
        h('div', { class: 'row gap wrap' },
          h('button', { type: 'button', class: 'btn', id: 'btn-generate-temp', onclick: () => { confirm = { ...confirm, draft: generateTempPassword(), error: '' }; draw(); } }, 'Generate'),
          h('button', { type: 'button', class: 'btn', id: 'confirm-cancel', onclick: () => { confirm = null; draw(); } }, 'Cancel'),
          h('button', { type: 'button', class: 'btn primary', id: 'confirm-temp-yes', disabled: busy ? true : null, onclick: () => doTemp(person) }, busy ? 'Saving…' : 'Set password'))));
  };

  const revealedDialog = () => h('div', { class: 'modal', id: 'temp-password-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'temp-once-title' },
    h('div', { class: 'modal-card' },
      h('h3', { id: 'temp-once-title' }, 'Temporary password'),
      h('p', {}, 'For ' + (revealed.person.full_name || revealed.person.email) + '. Shown once.'),
      h('p', { class: 'fine' }, 'This is not saved here and it is not emailed. Give it to the rep now. Closing this hides it.'),
      h('p', { class: 'secret-once', id: 'temp-password-once' }, revealed.password),
      revealed.signedOut === false ? h('p', { class: 'fine' }, 'Their other devices may stay signed in until that login expires.') : null,
      h('div', { class: 'row gap wrap' },
        h('button', { type: 'button', class: 'btn', id: 'btn-copy-temp', onclick: copyTemp }, 'Copy'),
        h('button', { type: 'button', class: 'btn primary', id: 'btn-close-temp', onclick: () => { revealed = null; draw(); } }, 'Close'))));

  async function copyTemp() {
    const value = revealed?.password || '';
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast('Copied.');
    } catch {
      const el = document.getElementById('temp-password-once');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      toast('Select the password and copy it.');
    }
  }

  async function doReset(person) {
    busy = true;
    confirm = { kind: 'reset', person, error: '' };
    draw();
    const res = await api.sendReset(person.email);
    busy = false;
    if (res?.error) {
      confirm = { kind: 'reset', person, error: res.error };
      draw();
      return;
    }
    confirm = null;
    notice = 'Reset email sent to ' + person.email + '.';
    draw();
    toast('Reset email sent.');
  }

  async function doTemp(person) {
    const draft = confirm?.draft || document.getElementById('temp-password')?.value || '';
    const problem = passwordError(draft);
    if (problem) {
      confirm = { ...confirm, draft, error: problem };
      draw();
      return;
    }
    busy = true;
    confirm = { ...confirm, draft, error: '' };
    draw();
    const res = await api.setTemp(person.email, draft);
    busy = false;
    if (res?.error) {
      confirm = { kind: 'temp', person, draft, error: res.error };
      draw();
      return;
    }
    confirm = null;
    revealed = {
      person,
      password: res.temporaryPassword || draft,
      signedOut: res.signedOut !== false,
    };
    notice = '';
    draw();
  }

  async function reload() {
    if (!api.load) return;
    loading = true;
    error = '';
    confirm = null;
    revealed = null;
    draw();
    try {
      const res = await api.load();
      loading = false;
      if (res?.error) error = res.error;
      else people = res.people || [];
    } catch (err) {
      loading = false;
      error = 'Could not load accounts.';
    }
    draw();
  }

  if (api.initial) draw();
  else reload();
}
