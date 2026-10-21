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
let pdfjsPromise = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

export function stop() {
  viewer?.close();
}

function openBrochure(item) {
  showViewer(item);
}

function showViewer(item) {
  stop();
  const state = { closed: false, pdf: null, jobs: new Set(), observer: null };
  const back = h('button', { type: 'button', class: 'btn primary', id: 'br-back' }, 'Back to Brochures');
  const home = h('button', { type: 'button', class: 'btn', id: 'br-home' }, 'Home');
  const title = h('div', { class: 'br-title' }, item.label);
  const bar = h('header', { class: 'br-bar' }, back, title, home);
  const stage = h('div', { class: 'br-stage', id: 'br-stage' });
  const status = h('p', { class: 'br-status' }, 'Opening brochure…');
  stage.append(status);
  const ov = h('div', { class: 'br-view', id: 'brochure-view', role: 'dialog', 'aria-modal': 'true', 'aria-label': item.label }, bar, stage);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    if (state.closed) return;
    state.closed = true;
    state.observer?.disconnect();
    for (const job of state.jobs) job.cancel?.();
    state.pdf?.destroy?.();
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('br-open');
    ov.remove();
    if (viewer && viewer.close === close) viewer = null;
  };
  back.addEventListener('click', close);
  home.addEventListener('click', () => { location.hash = '#/calculator'; });
  document.addEventListener('keydown', onKey);
  document.body.classList.add('br-open');
  document.body.append(ov);
  viewer = { close };
  drawPdf(item, stage, status, state, title);
}

async function drawPdf(item, stage, status, state, title) {
  const fail = (msg) => {
    if (state.closed) return;
    status.textContent = msg;
    if (!status.isConnected) stage.prepend(status);
  };
  let bytes;
  try {
    const res = await fetch(item.file);
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).trim();
      fail(text || 'Could not open this brochure.');
      return;
    }
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    fail('This brochure is not on this iPad yet. Open it once while online.');
    return;
  }
  if (state.closed) return;
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
    fail('This brochure is not on this iPad yet. Open it once while online.');
    return;
  }
  let pdf;
  try {
    const pdfjs = await loadPdfjs();
    if (state.closed) return;
    const backup = bytes.slice();
    try {
      const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
      state.jobs.add(task);
      pdf = await task.promise;
    } catch (err) {
      if (state.closed) return;
      const task = pdfjs.getDocument({ data: backup, isEvalSupported: false, disableWorker: true });
      state.jobs.add(task);
      pdf = await task.promise;
    }
  } catch (err) {
    console.error(err);
    fail('Could not open this brochure.');
    return;
  }
  if (state.closed) { pdf.destroy?.(); return; }
  state.pdf = pdf;
  status.remove();
  title.textContent = pdf.numPages > 1 ? `${item.label} · ${pdf.numPages} pages` : item.label;

  const slots = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    if (state.closed) return;
    const base = page.getViewport({ scale: 1 });
    const slot = h('div', { class: 'br-page', 'data-page': String(n) });
    slot.style.aspectRatio = `${base.width} / ${base.height}`;
    slot.dataset.w = String(base.width);
    slots.push(slot);
    stage.append(slot);
    page.cleanup?.();
  }

  const renderSlot = async (slot) => {
    const n = Number(slot.dataset.page);
    if (state.closed || slot.dataset.busy === '1' || slot.querySelector('canvas')) return;
    slot.dataset.busy = '1';
    for (const other of slots) {
      const m = Number(other.dataset.page);
      if (Math.abs(m - n) > 1) {
        const canvas = other.querySelector('canvas');
        if (canvas) { canvas.remove(); other.dataset.busy = ''; }
      }
    }
    const page = await pdf.getPage(n);
    if (state.closed || slot.querySelector('canvas')) { page.cleanup?.(); return; }
    const cssWidth = Math.max(280, stage.clientWidth - 28);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: (cssWidth / Number(slot.dataset.w)) * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const job = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport });
    state.jobs.add(job);
    try {
      await job.promise;
    } catch (err) {
      slot.dataset.busy = '';
      if (err?.name === 'RenderingCancelledException') return;
      console.error(err);
      return;
    }
    if (state.closed) return;
    slot.replaceChildren(canvas);
  };

  state.observer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) renderSlot(entry.target);
  }, { root: stage, rootMargin: '700px 0px' });
  for (const slot of slots) state.observer.observe(slot);
  renderSlot(slots[0]);
}

function card(item, groupId) {
  return h('button', {
    type: 'button',
    class: 'br-card ' + groupId,
    onclick: () => openBrochure(item),
  },
  h('span', { class: 'br-mark', 'aria-hidden': 'true' }, 'PDF'),
  h('span', { class: 'br-copy' }, h('b', {}, item.label)),
  h('span', { class: 'br-go', 'aria-hidden': 'true' }, 'Open'));
}

export function render(root) {
  stop();
  const wrap = h('div', { class: 'page brochures' },
    h('h1', {}, 'Brochures'),
    h('p', { class: 'muted br-lead' }, 'Official Milgard and Andersen brochures. Tap one to open it here. Back to Brochures stays on screen.'));
  for (const group of GROUPS) {
    wrap.append(
      h('section', { class: 'br-group', 'aria-labelledby': 'br-' + group.id },
        h('h2', { id: 'br-' + group.id }, group.name),
        h('div', { class: 'br-list' }, group.items.map((item) => card(item, group.id)))),
    );
  }
  root.replaceChildren(wrap);
}
