import { h } from '../core.js';
import { PASSWORD_HINT, passwordError } from '../../supabase/functions/account-passwords/password.js';

export function renderLogin(root, api) {
  if (!root) return;
  let mode = 'signin';
  const draw = (error) => {
    const nameField = mode === 'signup'
      ? h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Your name'), h('input', { type: 'text', id: 'auth-name', autocomplete: 'name' }))
      : null;
    root.replaceChildren(h('div', { class: 'page auth-wrap safe-top' },
      h('div', { class: 'card' },
        h('img', { class: 'auth-logo', src: 'assets/noble-logo-trim.png', alt: 'Noble Windows & Doors' }),
        h('h1', {}, mode === 'signup' ? 'Create account' : 'Sign in'),
        h('p', { class: 'fine' }, 'Use the work email Nick added.'),
        error && h('p', { class: 'warn', id: 'auth-error' }, error),
        h('form', { id: 'login-form', onsubmit: async (ev) => {
          ev.preventDefault();
          const email = document.getElementById('auth-email').value;
          const password = document.getElementById('auth-password').value;
          const fullName = document.getElementById('auth-name')?.value || '';
          if (mode === 'signup') {
            const problem = passwordError(password);
            if (problem) { draw(problem); return; }
          }
          const btn = document.getElementById('btn-auth');
          if (btn) btn.disabled = true;
          const res = mode === 'signup' ? await api.signUp(email, password, fullName) : await api.signIn(email, password);
          if (res?.error) draw(res.error);
        } },
          nameField,
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Email'), h('input', { type: 'email', id: 'auth-email', autocomplete: 'username', required: true })),
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Password'), h('input', { type: 'password', id: 'auth-password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', required: true, minlength: mode === 'signup' ? '8' : null })),
          mode === 'signup' ? h('p', { class: 'fine' }, PASSWORD_HINT) : h('p', { class: 'fine' }, 'New passwords need 8 characters, a number, and a symbol.'),
          h('button', { type: 'submit', class: 'btn primary xl', id: 'btn-auth' }, mode === 'signup' ? 'Create account' : 'Sign in')),
        h('button', { type: 'button', class: 'link', id: 'btn-auth-mode', onclick: () => { mode = mode === 'signup' ? 'signin' : 'signup'; draw(''); } }, mode === 'signup' ? 'Have an account? Sign in' : 'New rep? Create account'))));
  };
  draw(api.message || '');
}

export function renderSetPassword(root, api) {
  if (!root) return;
  const recovery = api.mode === 'recovery';
  const draw = (error) => {
    root.replaceChildren(h('div', { class: 'page auth-wrap safe-top', id: 'set-password' },
      h('div', { class: 'card' },
        h('h1', {}, 'Choose a new password'),
        h('p', {}, recovery
          ? 'This reset link is for your Noble sales account. Choose a new password to finish signing in.'
          : 'A temporary password was used for this sign-in. Choose a new password to open the app.'),
        h('p', { class: 'fine' }, PASSWORD_HINT),
        error && h('p', { class: 'warn', id: 'set-password-error' }, error),
        h('form', { id: 'set-password-form', onsubmit: async (ev) => {
          ev.preventDefault();
          const password = document.getElementById('new-password').value;
          const again = document.getElementById('new-password-2').value;
          if (password !== again) { draw('Those passwords do not match.'); return; }
          const btn = document.getElementById('btn-set-password');
          if (btn) btn.disabled = true;
          await api.onSubmit(password);
        } },
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'New password'),
            h('input', { type: 'password', id: 'new-password', autocomplete: 'new-password', required: true })),
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Confirm password'),
            h('input', { type: 'password', id: 'new-password-2', autocomplete: 'new-password', required: true })),
          h('button', { type: 'submit', class: 'btn primary xl', id: 'btn-set-password' }, 'Save and continue')))));
  };
  draw(api.message || '');
}
