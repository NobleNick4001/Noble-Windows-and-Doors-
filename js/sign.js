// Finger signature pad. Pointer events cover a finger, a pencil, and a mouse.
// touch-action: none on the canvas keeps iOS Safari from scrolling while signing.
export function mountSignature(canvas, { value = '', onChange } = {}) {
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let token = 0;

  function cssSize() {
    const rect = canvas.getBoundingClientRect();
    return { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
  }
  function prepare() {
    const { w, h } = cssSize();
    const r = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = Math.round(w * r);
    canvas.height = Math.round(h * r);
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0e3a63';
  }
  function paint(url) {
    const mine = ++token;
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      if (mine !== token) return;
      const { w, h } = cssSize();
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
    };
    img.src = url;
  }
  function point(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* already captured */ }
    drawing = true;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function up(e) {
    if (!drawing) return;
    e.preventDefault();
    drawing = false;
    last = exportPng();
    onChange?.(last);
  }
  function exportPng() {
    const { w, h } = cssSize();
    const out = document.createElement('canvas');
    out.width = Math.round(w);
    out.height = Math.round(h);
    const o = out.getContext('2d');
    o.fillStyle = '#ffffff';
    o.fillRect(0, 0, out.width, out.height);
    o.drawImage(canvas, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  let last = value || '';
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', down, { passive: false });
  canvas.addEventListener('pointermove', move, { passive: false });
  canvas.addEventListener('pointerup', up, { passive: false });
  canvas.addEventListener('pointercancel', up, { passive: false });
  prepare();
  paint(last);
  if (typeof ResizeObserver === 'function') {
    let sized = '';
    new ResizeObserver(() => {
      const { w, h } = cssSize();
      const key = Math.round(w) + 'x' + Math.round(h);
      if (key === sized) return;
      sized = key;
      prepare();
      paint(last);
    }).observe(canvas);
  }

  return {
    clear() {
      token++;
      last = '';
      drawing = false;
      const { w, h } = cssSize();
      ctx.clearRect(0, 0, w, h);
      onChange?.('');
    },
  };
}
