import { h } from '../core.js';

// Official PDFs only. The Andersen 100 product guide is not in this list.
const GROUPS = [
  {
    id: 'milgard',
    name: 'Milgard',
    items: [
      { file: 'brochures/milgard-trinsic-v300.pdf', label: 'Milgard Trinsic V300 brochure' },
      { file: 'brochures/milgard-tuscany-v400.pdf', label: 'Milgard Tuscany V400 brochure' },
      { file: 'brochures/milgard-vinyl-line.pdf', label: 'Milgard Vinyl Line overview (Tuscany, Trinsic, Style Line)' },
      { file: 'brochures/milgard-window-selection-guide.pdf', label: 'Milgard Window Selection Guide' },
      { file: 'brochures/milgard-series-comparison-chart.pdf', label: 'Milgard Series Comparison Chart' },
    ],
  },
  {
    id: 'andersen',
    name: 'Andersen',
    items: [
      { file: 'brochures/andersen-100-series.pdf', label: 'Andersen 100 Series brochure' },
    ],
  },
];

let viewer = null;

export function stop() {
  viewer?.close();
}

function iosStandalone() {
  return window.navigator.standalone === true;
}

function openBrochure(item) {
  // Home-screen iPad has no PDF plugin inside the app. A new tab opens
  // Safari's full-screen viewer, and this screen is still here when they return.
  if (iosStandalone()) {
    const opened = window.open(item.file, '_blank', 'noopener');
    if (opened) return;
  }
  showViewer(item);
}

function showViewer(item) {
  stop();
  const frame = h('iframe', { class: 'br-frame', title: item.label, src: item.file });
  const back = h('button', { type: 'button', class: 'btn primary', id: 'br-back' }, '← Back');
  const tab = h('a', { class: 'btn', id: 'br-tab', href: item.file, target: '_blank', rel: 'noopener' }, 'New tab');
  const bar = h('div', { class: 'br-bar' }, back, h('div', { class: 'br-title' }, item.label), tab);
  const ov = h('div', { class: 'br-view', id: 'brochure-view' }, bar, frame);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('br-open');
    ov.remove();
    if (viewer && viewer.el === ov) viewer = null;
  };
  back.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.classList.add('br-open');
  document.body.append(ov);
  viewer = { el: ov, close };
}

function card(item, groupId) {
  return h('a', {
    class: 'br-card ' + groupId,
    href: item.file,
    onclick: (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      openBrochure(item);
    },
  },
  h('span', { class: 'br-mark', 'aria-hidden': 'true' }, 'PDF'),
  h('span', { class: 'br-copy' }, h('b', {}, item.label)),
  h('span', { class: 'br-go', 'aria-hidden': 'true' }, 'Open'));
}

export function render(root) {
  stop();
  const wrap = h('div', { class: 'page brochures' },
    h('h1', {}, 'Brochures'),
    h('p', { class: 'muted br-lead' }, 'Official Milgard and Andersen brochures. Tap one to open it full screen. Back brings you here.'));
  for (const group of GROUPS) {
    wrap.append(
      h('section', { class: 'br-group', 'aria-labelledby': 'br-' + group.id },
        h('h2', { id: 'br-' + group.id }, group.name),
        h('div', { class: 'br-list' }, group.items.map((item) => card(item, group.id)))),
    );
  }
  root.replaceChildren(wrap);
}
