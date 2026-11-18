// Staff texts from the company Quo line. The API key and from-number are
// function env vars. This file never has a key, and it never texts a customer.

import { callPhrase } from './lead-clock.js';

export function clipNote(note, max = 120) {
  const text = String(note || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

export function toE164(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

export function assignmentText({ name, phone, address, note, callWindow }) {
  const lines = [`Noble lead: ${String(name || '').trim() || 'Customer'}`];
  const tel = String(phone || '').trim();
  const where = String(address || '').trim();
  if (tel) lines.push(tel);
  if (where) lines.push(where);
  const extra = clipNote(note);
  if (extra) lines.push(extra);
  lines.push(`Call within ${callPhrase(callWindow)}.`);
  return lines.join('\n');
}

export function overdueText({ name, phone, address, repName, callWindow }) {
  const lines = [
    `Overdue lead: ${String(name || '').trim() || 'Customer'}`,
    `Assigned to ${String(repName || '').trim() || 'a rep'}. Not marked Called within ${callPhrase(callWindow)}.`,
  ];
  const tel = String(phone || '').trim();
  const where = String(address || '').trim();
  if (tel) lines.push(tel);
  if (where) lines.push(where);
  return lines.join('\n');
}

export function staffDestination(profile, lead) {
  const role = String(profile?.role || '');
  if (role !== 'admin' && role !== 'sales') throw new Error('Refusing to text this number');
  const dest = toE164(profile?.phone);
  if (!dest) throw new Error('This person has no mobile on Accounts');
  const customer = toE164(lead?.phone);
  if (customer && customer === dest) throw new Error('Refusing to text the customer');
  return dest;
}

export function quoEnv(read) {
  return {
    QUO_API_KEY: String(read('QUO_API_KEY') || ''),
    QUO_FROM_NUMBER: String(read('QUO_FROM_NUMBER') || ''),
  };
}

export async function sendStaffText({ env, profile, lead, content, fetchImpl = fetch }) {
  const to = staffDestination(profile, lead);
  const body = String(content || '').trim();
  if (!body) throw new Error('Text is empty');
  if (body.length > 1600) throw new Error('Text is too long');
  const key = String(env?.QUO_API_KEY || '');
  const from = String(env?.QUO_FROM_NUMBER || '');
  if (!key || !from) throw new Error('Texting is not configured');
  const res = await fetchImpl('https://api.quo.com/v1/messages', {
    method: 'POST',
    headers: {
      Authorization: key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: body,
      from,
      to: [to],
      setInboxStatus: 'done',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) {
    const title = data?.title || data?.message || 'Quo did not send the text';
    throw new Error(String(title).slice(0, 180));
  }
  return { id: data?.data?.id ? String(data.data.id) : null };
}
