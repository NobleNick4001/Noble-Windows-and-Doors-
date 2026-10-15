import { h } from '../core.js';

export function renderLogin(root, api) {
  if (!root) return;
  let mode = 'signin';
  const draw = (error) => {
    const nameField = mode === 'signup'
      ? h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Your name'), h('input', { type: 'text', id: 'auth-name', autocomplete: 'name' }))
      : null;
    root.replaceChildren(h('div', { class: 'page auth-wrap safe-top' },
      h('div', { class: 'card' },
        h('h1', {}, mode === 'signup' ? 'Create account' : 'Sign in'),
        h('p', { class: 'fine' }, 'Noble sales accounts. Sign in with the work email Nick approved. A new rep cannot create an account until that email is added on the Admin page.'),
        error && h('p', { class: 'warn', id: 'auth-error' }, error),
        h('form', { id: 'login-form', onsubmit: async (ev) => {
          ev.preventDefault();
          const email = document.getElementById('auth-email').value;
          const password = document.getElementById('auth-password').value;
          const fullName = document.getElementById('auth-name')?.value || '';
          const btn = document.getElementById('btn-auth');
          if (btn) btn.disabled = true;
          const res = mode === 'signup' ? await api.signUp(email, password, fullName) : await api.signIn(email, password);
          if (res?.error) draw(res.error);
        } },
          nameField,
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Email'), h('input', { type: 'email', id: 'auth-email', autocomplete: 'username', required: true })),
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Password'), h('input', { type: 'password', id: 'auth-password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', required: true, minlength: '6' })),
          h('button', { type: 'submit', class: 'btn primary xl', id: 'btn-auth' }, mode === 'signup' ? 'Create account' : 'Sign in')),
        h('button', { type: 'button', class: 'link', id: 'btn-auth-mode', onclick: () => { mode = mode === 'signup' ? 'signin' : 'signup'; draw(''); } }, mode === 'signup' ? 'Have an account? Sign in' : 'New rep? Create account'))));
  };
  draw(api.message || '');
}
