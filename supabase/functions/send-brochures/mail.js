// Brochure email content and checks. No network and no pricing.
// Gmail/Resend selection stays in send-estimate/mail.js so both sends share one mailbox.
import { COMPANY_PHONE, SENDER_EMAIL, SENDER_FROM, encodeSubject } from '../send-estimate/mail.js';

export { COMPANY_PHONE, SENDER_EMAIL, SENDER_FROM };

export const BROCHURE_HOST = 'https://noblenick4001.github.io/Noble-Windows-and-Doors-';
export const SUBJECT_PREFIX = 'Noble Windows & Doors Brochures - ';
export const SUBJECT_MAX = 90;
export const RATE_WINDOW_MS = 15 * 60 * 1000;
export const RATE_MAX = 12;
export const DUPLICATE_MS = 30 * 1000;

// Same files and titles as GROUPS in js/pages/brochures.js. mail.test.mjs checks they match.
export const BROCHURE_GROUPS = [
  {
    id: 'milgard',
    name: 'Milgard',
    items: [
      { file: 'brochures/milgard-v250-style-line.pdf', label: 'Milgard V250 Style Line', series: 'V250 Style Line' },
      { file: 'brochures/milgard-v300-trinsic.pdf', label: 'Milgard V300 Trinsic', series: 'V300 Trinsic' },
      { file: 'brochures/milgard-v400-tuscany.pdf', label: 'Milgard V400 Tuscany', series: 'V400 Tuscany' },
      { file: 'brochures/milgard-c700-fiberglass.pdf', label: 'Milgard C700 Fiberglass', series: 'C700 Fiberglass' },
      { file: 'brochures/milgard-a250-aluminum.pdf', label: 'Milgard A250 Aluminum', series: 'A250 Aluminum' },
      { file: 'brochures/milgard-patio-doors.pdf', label: 'Milgard Patio Doors', series: 'Patio Doors' },
      { file: 'brochures/milgard-window-selection-guide.pdf', label: 'Milgard Window Selection Guide', series: 'Window Selection Guide' },
    ],
  },
  {
    id: 'andersen',
    name: 'Andersen',
    items: [
      { file: 'brochures/andersen-100-series.pdf', label: 'Andersen 100 Series brochure', series: '100 Series' },
    ],
  },
  {
    id: 'prl',
    name: 'PRL',
    items: [
      { file: 'brochures/prl-max-slider-multi-slide-door.pdf', label: 'PRL Max Slider Multi-Slide Door', series: 'Max Slider' },
      { file: 'brochures/prl-bottom-rolling-bifold-door.pdf', label: 'PRL Bottom Rolling Bi-Fold Door', series: 'Bottom Rolling Bi-Fold' },
    ],
  },
];

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function isClientEmail(value) {
  const email = String(value ?? '').trim();
  if (email !== String(value ?? '') || email.length < 6 || email.length > 254) return false;
  if (/[\s<>"'(),;:\\]/.test(email)) return false;
  return EMAIL_RE.test(email);
}

export function catalogItems() {
  return BROCHURE_GROUPS.flatMap((group) => group.items.map((item) => ({ file: item.file, label: item.label })));
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cleanLine(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanNote(value, max) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

export function brochureFileName(file) {
  const raw = String(file ?? '').trim();
  if (!raw || raw.length > 180) return '';
  if (/[\u0000-\u001F\u007F\\?#%]/.test(raw)) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
  if (raw.includes('..')) return '';
  const parts = raw.split('/').filter(Boolean);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2 && parts[0] === 'brochures') return parts[1];
  return '';
}

export function brochureByFile(file) {
  const name = brochureFileName(file);
  if (!name || !/^[A-Za-z0-9._-]+\.pdf$/.test(name)) return null;
  for (const group of BROCHURE_GROUPS) {
    const item = group.items.find((it) => it.file === `brochures/${name}`);
    if (!item) continue;
    return {
      file: item.file,
      label: item.label,
      series: item.series,
      maker: group.name,
      fileName: name,
      url: `${BROCHURE_HOST}/brochures/${name}`,
    };
  }
  return null;
}

export function signatureName(fullName, email) {
  const name = cleanLine(fullName, 80);
  if (!name || name.includes('@')) return '';
  if (String(email || '').trim().toLowerCase() === name.toLowerCase()) return '';
  return name;
}

export function replyToHeader(name, email) {
  const address = String(email || '').trim().toLowerCase();
  if (!isClientEmail(address)) return '';
  const clean = String(name || '').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || /[<>"]/.test(clean) || clean.toLowerCase() === address) return address;
  return `"${clean}" <${address}>`;
}

export function validateBrochureRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Expected JSON' };
  }
  const to = String(input.to || '').trim();
  if (!to) return { ok: false, error: 'Client email is required.' };
  if (!isClientEmail(to)) return { ok: false, error: 'Enter a valid client email.' };
  if (String(input.customerName || '').length > 80) return { ok: false, error: 'Client name is too long.' };
  if (String(input.note || '').length > 600) return { ok: false, error: 'Keep the note under 600 characters.' };
  const files = input.files;
  if (!Array.isArray(files) || !files.length) return { ok: false, error: 'Choose at least one brochure.' };
  if (files.length > 20) return { ok: false, error: 'Too many brochures.' };
  const links = [];
  const seen = new Set();
  for (const file of files) {
    if (typeof file !== 'string') return { ok: false, error: 'Choose a brochure from the list.' };
    const item = brochureByFile(file);
    if (!item || !item.url.startsWith(`${BROCHURE_HOST}/brochures/`) || !item.url.endsWith('.pdf')) {
      return { ok: false, error: 'Choose a brochure from the list.' };
    }
    if (seen.has(item.fileName)) continue;
    seen.add(item.fileName);
    links.push(item);
  }
  if (!links.length) return { ok: false, error: 'Choose at least one brochure.' };
  return {
    ok: true,
    value: {
      to,
      customerName: cleanLine(input.customerName, 80),
      note: cleanNote(input.note, 600),
      links,
    },
  };
}

function noteHtml(note) {
  if (!note) return '';
  return note.split('\n').map((line) => esc(line)).join('<br>');
}

function oneLine(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function brochureSubject(links) {
  const groups = [];
  for (const item of Array.isArray(links) ? links : []) {
    const maker = oneLine(item?.maker);
    let series = oneLine(item?.series);
    if (!series) {
      const label = oneLine(item?.label);
      series = maker && label.toLowerCase().startsWith(`${maker.toLowerCase()} `)
        ? label.slice(maker.length).trim()
        : label;
    }
    if (!maker || !series) continue;
    let group = groups.find((entry) => entry.maker === maker);
    if (!group) {
      group = { maker, series: [] };
      groups.push(group);
    }
    if (!group.series.includes(series)) group.series.push(series);
  }
  if (!groups.length) return 'Noble Windows & Doors Brochures';
  const parts = [];
  for (const group of groups) {
    group.series.forEach((series, index) => {
      parts.push(index === 0 ? `${group.maker} ${series}` : series);
    });
  }
  let suffix = parts.join(', ');
  if (`${SUBJECT_PREFIX}${suffix}`.length > SUBJECT_MAX) suffix = groups.map((group) => group.maker).join(' & ');
  return oneLine(`${SUBJECT_PREFIX}${suffix}`);
}

function introSentence(count) {
  if (count === 1) {
    return 'Thank you for taking the time to meet with us. As promised, here is the digital brochure for the product we discussed, so you can look it over at your own pace:';
  }
  return 'Thank you for taking the time to meet with us. As promised, here are the digital brochures for the products we discussed, so you can look them over at your own pace:';
}

export function buildBrochureEmail({ repName, customerName, note, links }) {
  const who = signatureName(repName, '');
  const customer = cleanLine(customerName, 80);
  const bodyNote = cleanNote(note, 600);
  const list = Array.isArray(links) ? links : [];
  for (const item of list) {
    if (!item?.url?.startsWith(`${BROCHURE_HOST}/brochures/`) || !String(item.url).endsWith('.pdf')) {
      throw new Error('Refusing a brochure link outside this site');
    }
  }
  const greet = `Hi ${customer || 'there'},`;
  const intro = introSentence(list.length);
  const closing = `We truly appreciate the opportunity to earn your business and look forward to working with you. If any questions come up, please reach out anytime at our office, ${COMPANY_PHONE}.`;
  const text = [
    greet,
    '',
    intro,
    '',
    ...list.flatMap((item) => [item.label, item.url, '']),
    ...(bodyNote ? [bodyNote, ''] : []),
    closing,
    '',
    'Warm regards,',
    ...(who ? [who] : []),
    'Noble Windows & Doors',
    COMPANY_PHONE,
  ].join('\n');
  const items = list.map((item) => (
    `<li style="margin:0 0 10px;"><a href="${esc(item.url)}" style="color:#1d75bc;font-weight:700;">${esc(item.label)}</a></li>`
  )).join('');
  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;background:#e7f2fb;font-family:Helvetica,Arial,sans-serif;color:#12283c;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="background:#0e3a63;color:#ffffff;padding:18px 22px;border-bottom:4px solid #f28c28;">
      <div style="font-size:22px;font-weight:700;letter-spacing:.02em;">Noble Windows &amp; Doors</div>
      <div style="color:#d6e6f5;font-size:13px;margin-top:4px;">Brochures</div>
    </div>
    <div style="background:#ffffff;padding:22px;line-height:1.5;">
      <p style="margin:0 0 12px;">${esc(greet)}</p>
      <p style="margin:0 0 12px;">${esc(intro)}</p>
      <ul style="margin:0 0 16px;padding-left:18px;">${items}</ul>
      ${bodyNote ? `<p style="margin:0 0 12px;">${noteHtml(bodyNote)}</p>` : ''}
      <p style="margin:0 0 12px;">We truly appreciate the opportunity to earn your business and look forward to working with you. If any questions come up, please reach out anytime at our office, <a href="tel:6238103460" style="color:#1d75bc;">${esc(COMPANY_PHONE)}</a>.</p>
      <p style="margin:0;">Warm regards,<br>${who ? `${esc(who)}<br>` : ''}Noble Windows &amp; Doors<br><a href="tel:6238103460" style="color:#1d75bc;">${esc(COMPANY_PHONE)}</a></p>
    </div>
  </div>
</body>
</html>`;
  return { subject: brochureSubject(list), text, html, links: list };
}

function bytesToBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function wrap76(b64) {
  return String(b64 || '').replace(/\s/g, '').replace(/(.{76})/g, '$1\r\n');
}

export function buildBrochureRaw({ from, to, replyTo, subject, text, html, boundary = 'nwd-brochure-boundary' }) {
  const textB64 = wrap76(bytesToBase64(new TextEncoder().encode(String(text || ''))));
  const htmlB64 = wrap76(bytesToBase64(new TextEncoder().encode(String(html || ''))));
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
  ];
  if (replyTo) lines.push(`Reply-To: ${replyTo}`);
  lines.push(
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    textB64,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    htmlB64,
    `--${boundary}--`,
    '',
  );
  return lines.join('\r\n');
}

export function createRateBucket() {
  return { hits: new Map(), last: new Map() };
}

export function takeSendSlot(bucket, userId, now = Date.now(), fingerprint = '') {
  const id = String(userId || '');
  if (!id) return { ok: false, error: 'Sign in required.' };
  const prevLast = bucket.last.get(id);
  if (fingerprint && prevLast && prevLast.fingerprint === fingerprint && now - prevLast.at < DUPLICATE_MS) {
    const retryAfterSec = Math.max(1, Math.ceil((prevLast.at + DUPLICATE_MS - now) / 1000));
    return { ok: false, error: 'That brochure email was just sent. Wait a moment before sending it again.', retryAfterSec };
  }
  const recent = (bucket.hits.get(id) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    bucket.hits.set(id, recent);
    const retryAfterSec = Math.max(1, Math.ceil((recent[0] + RATE_WINDOW_MS - now) / 1000));
    return { ok: false, error: 'Too many brochure emails. Wait a few minutes and try again.', retryAfterSec };
  }
  recent.push(now);
  bucket.hits.set(id, recent);
  bucket.last.set(id, { at: now, fingerprint: fingerprint || '' });
  return { ok: true };
}
