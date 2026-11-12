import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BROCHURE_HOST, COMPANY_PHONE, RATE_MAX, SENDER_FROM,
  brochureByFile, brochureSubject, buildBrochureEmail, buildBrochureRaw, catalogItems, createRateBucket,
  replyToHeader, takeSendSlot, validateBrochureRequest,
} from './mail.js';

const V250 = 'brochures/milgard-v250-style-line.pdf';
const V300 = 'brochures/milgard-v300-trinsic.pdf';
const V400 = 'brochures/milgard-v400-tuscany.pdf';
const PRL = 'brochures/prl-max-slider-multi-slide-door.pdf';
const PAGE = readFileSync(new URL('../../../js/pages/brochures.js', import.meta.url), 'utf8');

function sample(extra = {}) {
  return validateBrochureRequest({
    to: 'test@example.com',
    customerName: 'Alex Client',
    note: 'Please look before Thursday.',
    files: [V250, PRL],
    ...extra,
  });
}

test('brochure list matches the Brochures tab, including PRL', () => {
  const items = [...PAGE.matchAll(/file:\s*'([^']+)',\s*label:\s*'([^']+)'/g)].map((m) => ({ file: m[1], label: m[2] }));
  assert.deepEqual(catalogItems(), items);
  assert.equal(items.length, 13);
  assert.ok(items.some((item) => item.file === 'brochures/milgard-ax650-bifold.pdf'));
  assert.ok(items.some((item) => item.file === 'brochures/milgard-ax650-stacking.pdf'));
  assert.ok(items.some((item) => item.file === 'brochures/milgard-ax650-pocket.pdf'));
  assert.ok(items.some((item) => item.file === PRL));
  assert.ok(items.some((item) => item.file === 'brochures/andersen-100-series.pdf'));
  assert.match(PAGE, /buildBrochureEmail/);
});

test('AX650 sheets are accepted and linked only from this site', () => {
  const files = [
    'brochures/milgard-ax650-bifold.pdf',
    'brochures/milgard-ax650-stacking.pdf',
    'brochures/milgard-ax650-pocket.pdf',
  ];
  const parsed = validateBrochureRequest({
    to: 'test@example.com',
    customerName: 'Alex Client',
    note: '',
    files,
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.links.map((item) => item.url), files.map((file) => `${BROCHURE_HOST}/${file}`));
  assert.equal(brochureByFile('brochures/not-a-real-ax650.pdf'), null);
});

test('links are only this site\'s brochure PDFs', () => {
  const parsed = sample();
  assert.equal(parsed.ok, true);
  const mail = buildBrochureEmail({
    repName: 'Eric Havins',
    customerName: parsed.value.customerName,
    note: parsed.value.note,
    links: parsed.value.links,
  });
  const urls = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const pdfs = urls.filter((url) => url !== 'tel:6238103460');
  assert.deepEqual(pdfs, [
    `${BROCHURE_HOST}/brochures/milgard-v250-style-line.pdf`,
    `${BROCHURE_HOST}/brochures/prl-max-slider-multi-slide-door.pdf`,
  ]);
  assert.match(mail.html, /Milgard V250 Style Line/);
  assert.match(mail.html, /PRL Max Slider Multi-Slide Door/);
  assert.match(mail.text, /Milgard V250 Style Line\nhttps:\/\/noblenick4001\.github\.io\/Noble-Windows-and-Doors-\/brochures\/milgard-v250-style-line\.pdf/);
  assert.equal(mail.text.includes('test@example.com'), false);
  const visible = mail.html.replace(/\sstyle="[^"]*"/gi, '').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(visible, /\bmargin\b|\bdeposit\b|\$|\bROC\b|\bpricing\b|\bestimate\b|\battachment\b/i);
  assert.doesNotMatch(mail.text, /\bmargin\b|\bdeposit\b|\$|\bROC\b|\bpricing\b|\bestimate\b|\battachment\b/i);
});

test('signature, phone, and optional rep name', () => {
  const links = [brochureByFile(V250)];
  const withRep = buildBrochureEmail({ repName: 'Eric Havins', customerName: 'Alex Client', note: '', links });
  assert.match(withRep.html, /Eric Havins<br>/);
  assert.match(withRep.text, /Warm regards,\nEric Havins\nNoble Windows & Doors\n\(623\) 810-3460$/);
  assert.match(withRep.html, new RegExp(COMPANY_PHONE.replace(/[()]/g, '\\$&')));
  assert.match(withRep.html, /Noble Windows &amp; Doors/);
  assert.equal(withRep.html.includes('Noble Windows & Doors'), false);
  const noRep = buildBrochureEmail({ repName: '', customerName: '', note: '', links });
  assert.equal(noRep.html.includes('Eric Havins'), false);
  assert.match(noRep.text, /^Hi there,\n\nThank you for taking the time to meet with us\. As promised, here is the digital brochure/);
  assert.match(noRep.text, /Warm regards,\nNoble Windows & Doors\n\(623\) 810-3460$/);
  assert.equal(buildBrochureEmail({ repName: 'eric@noblewandd.com', customerName: 'Alex', note: '', links }).html.includes('eric@noblewandd.com'), false);
});

test('escapes the name and the note in HTML and keeps them readable in text', () => {
  const parsed = validateBrochureRequest({
    to: 'test@example.com',
    customerName: `Jane <script> & "O'Brien"`,
    note: 'Look at <b>this</b> & that\nSecond line',
    files: [V250],
  });
  assert.equal(parsed.ok, true);
  const mail = buildBrochureEmail({
    repName: 'Nick <admin>',
    customerName: parsed.value.customerName,
    note: parsed.value.note,
    links: parsed.value.links,
  });
  assert.match(mail.html, /Hi Jane &lt;script&gt; &amp; &quot;O&#39;Brien&quot;,/);
  assert.match(mail.html, /Look at &lt;b&gt;this&lt;\/b&gt; &amp; that<br>Second line/);
  assert.doesNotMatch(mail.html, /<script>|<b>/);
  assert.match(mail.text, /Hi Jane <script> & "O'Brien",/);
  assert.match(mail.text, /Look at <b>this<\/b> & that\nSecond line/);
  const raw = buildBrochureRaw({
    from: SENDER_FROM,
    to: 'test@example.com',
    replyTo: replyToHeader('Nick <admin>', 'mgr@noblewandd.com'),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  assert.equal(raw.includes('<script>'), false);
  assert.equal(raw.includes('Content-Disposition:'), false);
  assert.match(raw, /^From: Noble Windows & Doors <mgr@noblewandd\.com>\r\nTo: test@example\.com\r\nReply-To: mgr@noblewandd\.com\r\n/);
});

test('raw message reply-to and subject cannot add headers', () => {
  const header = replyToHeader('Eric\r\nBcc: evil@example.com', 'eric@noblewandd.com');
  assert.equal(header.includes('\n'), false);
  assert.equal(header.includes('\r'), false);
  assert.equal(header, '"Eric Bcc: evil@example.com" <eric@noblewandd.com>');
  assert.equal(replyToHeader('Eric Havins', 'eric@noblewandd.com'), '"Eric Havins" <eric@noblewandd.com>');
  assert.equal(replyToHeader('Eric', 'eric@noblewandd.com\nBcc: evil@example.com'), '');
  const mail = buildBrochureEmail({
    repName: 'Eric Havins',
    customerName: 'Alex Client',
    note: 'See you',
    links: [brochureByFile('milgard-v250-style-line.pdf')],
  });
  const raw = buildBrochureRaw({
    from: SENDER_FROM,
    to: 'test@example.com',
    replyTo: header,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  assert.equal(mail.subject, 'Noble Windows & Doors Brochures - Milgard V250 Style Line');
  assert.doesNotMatch(raw, /\r\nBcc:/i);
  const subjectLine = raw.split('\r\n').find((line) => line.startsWith('Subject:'));
  assert.equal(subjectLine, 'Subject: Noble Windows & Doors Brochures - Milgard V250 Style Line');
  assert.equal(subjectLine.includes('\n'), false);
  assert.match(raw, /multipart\/alternative/);
});

test('validation accepts a typed address and rejects anything that is not our PDF', () => {
  const parsed = sample({
    to: '  Test@Example.com  ',
    files: [V250, 'milgard-v250-style-line.pdf', PRL],
    total: '$9,999',
    margin: '45%',
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.to, 'Test@Example.com');
  assert.equal(parsed.value.links.length, 2);
  assert.equal(parsed.value.customerName, 'Alex Client');
  const mail = buildBrochureEmail({ repName: 'Eric Havins', ...parsed.value });
  assert.equal(mail.html.includes('999'), false);
  assert.equal(mail.text.includes('45%'), false);

  const bad = [
    {},
    { to: '', files: [V250] },
    { to: 'not-an-email', files: [V250] },
    { to: 'a@b', files: [V250] },
    { to: 'test@example.com\nBcc: evil@example.com', files: [V250] },
    { to: 'test@example.com', files: [] },
    { to: 'test@example.com', files: 'brochures/milgard-v250-style-line.pdf' },
    { to: 'test@example.com', files: ['../etc/passwd'] },
    { to: 'test@example.com', files: ['https://evil.example/brochures/milgard-v250-style-line.pdf'] },
    { to: 'test@example.com', files: ['brochures/milgard-v250-style-line.pdf?x=1'] },
    { to: 'test@example.com', files: ['brochures/not-a-real.pdf'] },
    { to: 'test@example.com', files: ['brochures/andersen-100-product-guide.pdf'] },
    { to: 'test@example.com', files: [V250, 'brochures/secret.pdf'] },
    { to: 'test@example.com', customerName: 'x'.repeat(81), files: [V250] },
    { to: 'test@example.com', note: 'x'.repeat(601), files: [V250] },
  ];
  for (const input of bad) {
    const result = validateBrochureRequest(input);
    assert.equal(result.ok, false, JSON.stringify(input));
  }
  assert.equal(brochureByFile('brochures/milgard-v250-style-line.pdf/../../secret.pdf'), null);
});

test('subject names the selected brochures and drops a long list to makers', () => {
  const one = brochureSubject([brochureByFile(V250)]);
  const same = brochureSubject([brochureByFile(V250), brochureByFile(V300)]);
  const mixed = brochureSubject([brochureByFile(V250), brochureByFile(PRL)]);
  const long = brochureSubject([brochureByFile(V250), brochureByFile(V300), brochureByFile(V400), brochureByFile(PRL)]);
  assert.equal(one, 'Noble Windows & Doors Brochures - Milgard V250 Style Line');
  assert.equal(same, 'Noble Windows & Doors Brochures - Milgard V250 Style Line, V300 Trinsic');
  assert.equal(mixed, 'Noble Windows & Doors Brochures - Milgard V250 Style Line, PRL Max Slider');
  assert.equal(long, 'Noble Windows & Doors Brochures - Milgard & PRL');
  assert.ok(one.length <= 90 && mixed.length <= 90 && long.length <= 90);
  const poisoned = brochureByFile(V250);
  poisoned.series = 'V250\r\nBcc: evil@example.com';
  poisoned.maker = 'Milgard\n';
  const cleaned = brochureSubject([poisoned]);
  assert.equal(cleaned.includes('\r'), false);
  assert.equal(cleaned.includes('\n'), false);
  assert.equal(cleaned, 'Noble Windows & Doors Brochures - Milgard V250 Bcc: evil@example.com');
});

test('the letter uses singular or plural wording and keeps a note in its own paragraph', () => {
  const one = buildBrochureEmail({
    repName: 'Eric Havins',
    customerName: 'Alex Client',
    note: '',
    links: [brochureByFile(V250)],
  });
  assert.match(one.text, /here is the digital brochure for the product we discussed, so you can look it over/);
  assert.equal(one.text.includes('here are'), false);
  assert.equal(one.text.includes('attached'), false);
  const parsed = sample();
  const many = buildBrochureEmail({ repName: 'Eric Havins', ...parsed.value });
  assert.match(many.text, /Hi Alex Client,\n\nThank you for taking the time to meet with us\. As promised, here are the digital brochures for the products we discussed, so you can look them over at your own pace:/);
  assert.equal(many.text.includes('here is the digital brochure'), false);
  assert.equal(many.text.includes('attached'), false);
  const urlAt = many.text.indexOf(`${BROCHURE_HOST}/brochures/milgard-v250-style-line.pdf`);
  const noteAt = many.text.indexOf('Please look before Thursday.');
  const closeAt = many.text.indexOf('We truly appreciate the opportunity');
  assert.ok(urlAt > 0 && urlAt < noteAt && noteAt < closeAt);
  assert.match(many.html, /Please look before Thursday\.<\/p>/);
  assert.match(many.text, /\(623\) 810-3460\.\n\nWarm regards,/);
});

test('rate limit allows a burst, then blocks repeats and the next send', () => {
  const bucket = createRateBucket();
  const start = 1_700_000_000_000;
  assert.equal(takeSendSlot(bucket, '', start, 'a').ok, false);
  for (let i = 0; i < RATE_MAX; i++) {
    assert.equal(takeSendSlot(bucket, 'rep', start + i, `note-${i}`).ok, true);
  }
  const blocked = takeSendSlot(bucket, 'rep', start + RATE_MAX, 'another');
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /Too many brochure emails/);
  const later = takeSendSlot(bucket, 'rep', start + 16 * 60 * 1000, 'later');
  assert.equal(later.ok, true);
  const again = takeSendSlot(bucket, 'rep', start + 16 * 60 * 1000 + 1000, 'later');
  assert.equal(again.ok, false);
  assert.match(again.error, /just sent/);
  assert.equal(takeSendSlot(bucket, 'other-rep', start, 'a').ok, true);
});
