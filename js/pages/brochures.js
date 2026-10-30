import { h } from '../core.js';
import { icon } from '../icons.js';

// Official PDFs only. The Andersen 100 product guide is not in this list.
const GROUPS = [
  {
    id: 'milgard',
    name: 'Milgard',
    items: [
      { file: 'brochures/milgard-v250-style-line.pdf', label: 'Milgard V250 Style Line' },
      { file: 'brochures/milgard-v300-trinsic.pdf', label: 'Milgard V300 Trinsic' },
      { file: 'brochures/milgard-v400-tuscany.pdf', label: 'Milgard V400 Tuscany' },
      { file: 'brochures/milgard-c700-fiberglass.pdf', label: 'Milgard C700 Fiberglass' },
      { file: 'brochures/milgard-a250-aluminum.pdf', label: 'Milgard A250 Aluminum' },
      { file: 'brochures/milgard-patio-doors.pdf', label: 'Milgard Patio Doors' },
      { file: 'brochures/milgard-window-selection-guide.pdf', label: 'Milgard Window Selection Guide' },
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
    if (state.onScroll) stage.removeEventListener('scroll', state.onScroll);
    if (state.onResize) window.removeEventListener('resize', state.onResize);
    state.release?.();
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

  // A page just below the screen starts drawing while the page on screen is
  // still up. Dropping every picture more than one page away erased the one
  // on screen. Scrolling back did not put it back in that slot.
  const picture = (slot) => slot.querySelector('canvas, img');
  const nearView = (slot) => {
    const root = stage.getBoundingClientRect();
    const box = slot.getBoundingClientRect();
    const pad = Math.max(root.height, 360);
    return box.bottom > root.top - pad && box.top < root.bottom + pad;
  };
  const releaseFar = () => {
    for (const slot of slots) {
      if (nearView(slot)) continue;
      if (slot.dataset.busy !== '1' && !picture(slot)) continue;
      slot._gen = null;
      slot._job?.cancel?.();
      slot._job = null;
      const node = picture(slot);
      if (node) {
        if (node.tagName === 'CANVAS') { node.width = 0; node.height = 0; }
        node.remove();
      }
      if (slot._url) { URL.revokeObjectURL(slot._url); slot._url = ''; }
      slot.dataset.busy = '';
    }
  };
  state.release = () => {
    for (const slot of slots) {
      slot._gen = null;
      slot._job?.cancel?.();
      if (slot._url) URL.revokeObjectURL(slot._url);
    }
  };
  const alive = (slot, gen) => !state.closed && slot._gen === gen;

  const renderSlot = async (slot) => {
    if (state.closed || slot.dataset.busy === '1' || picture(slot)) return;
    if (!nearView(slot)) return;
    const gen = {};
    slot._gen = gen;
    slot.dataset.busy = '1';
    const n = Number(slot.dataset.page);
    let page;
    try {
      page = await pdf.getPage(n);
    } catch (err) {
      if (slot._gen === gen) slot.dataset.busy = '';
      console.error(err);
      return;
    }
    if (!alive(slot, gen) || !nearView(slot)) {
      page.cleanup?.();
      if (slot._gen === gen) slot.dataset.busy = '';
      return;
    }
    const cssWidth = Math.max(280, slot.clientWidth || stage.clientWidth - 28);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: (cssWidth / Number(slot.dataset.w)) * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const job = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport });
    slot._job = job;
    state.jobs.add(job);
    try {
      await job.promise;
    } catch (err) {
      if (slot._gen === gen) slot.dataset.busy = '';
      page.cleanup?.();
      if (err?.name !== 'RenderingCancelledException') console.error(err);
      return;
    }
    page.cleanup?.();
    if (!alive(slot, gen) || !nearView(slot)) {
      if (slot._gen === gen) slot.dataset.busy = '';
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    // Safari drops the pixels of a canvas inside this scroller. An image
    // keeps the same picture and sits in the slot when you scroll back.
    let shown = canvas;
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (blob && alive(slot, gen)) {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.alt = '';
        img.src = url;
        try {
          await img.decode();
        } catch (err) {
          URL.revokeObjectURL(url);
          throw err;
        }
        if (!alive(slot, gen)) {
          URL.revokeObjectURL(url);
        } else {
          if (slot._url) URL.revokeObjectURL(slot._url);
          slot._url = url;
          shown = img;
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    } catch { /* the canvas still holds the page */ }
    if (!alive(slot, gen) || !nearView(slot)) {
      if (slot._gen === gen) slot.dataset.busy = '';
      if (shown !== canvas && slot._url) { URL.revokeObjectURL(slot._url); slot._url = ''; }
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    slot.replaceChildren(shown);
    releaseFar();
  };

  const paintVisible = () => {
    if (state.closed) return;
    for (const slot of slots) if (nearView(slot)) renderSlot(slot);
    releaseFar();
  };
  let scrollTick = 0;
  state.onScroll = () => {
    if (scrollTick) return;
    scrollTick = requestAnimationFrame(() => {
      scrollTick = 0;
      paintVisible();
    });
  };
  stage.addEventListener('scroll', state.onScroll, { passive: true });
  let laidOut = stage.clientWidth;
  state.onResize = () => {
    if (state.closed || Math.abs(stage.clientWidth - laidOut) < 4) return;
    laidOut = stage.clientWidth;
    for (const slot of slots) {
      slot._gen = null;
      slot._job?.cancel?.();
      const node = picture(slot);
      if (node) {
        if (node.tagName === 'CANVAS') { node.width = 0; node.height = 0; }
        node.remove();
      }
      if (slot._url) { URL.revokeObjectURL(slot._url); slot._url = ''; }
      slot.dataset.busy = '';
    }
    paintVisible();
  };
  window.addEventListener('resize', state.onResize);
  state.observer = new IntersectionObserver((entries) => {
    if (state.closed) return;
    for (const entry of entries) if (entry.isIntersecting) renderSlot(entry.target);
    releaseFar();
  }, { root: stage, rootMargin: '400px 0px' });
  for (const slot of slots) state.observer.observe(slot);
  paintVisible();
}

function card(item, groupId) {
  return h('button', {
    type: 'button',
    class: 'br-card ' + groupId,
    onclick: () => openBrochure(item),
  },
  h('span', { class: 'br-mark', 'aria-hidden': 'true' }, icon('file'), 'PDF'),
  h('span', { class: 'br-copy' }, h('b', {}, item.label)),
  h('span', { class: 'br-go', 'aria-hidden': 'true' }, icon('chevron')));
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
