import assert from 'node:assert/strict';
import test from 'node:test';
import { assignmentText, overdueText, sendStaffText, staffDestination, toE164 } from './quo.js';

const rep = { role: 'sales', phone: '(480) 555-0101' };
const lead = { phone: '(602) 555-0190', name: 'Priya Shah' };

test('US numbers become E.164 and a customer number is refused', () => {
  assert.equal(toE164('(480) 555-0101'), '+14805550101');
  assert.equal(toE164('+1 480-555-0101'), '+14805550101');
  assert.equal(toE164('555'), '');
  assert.equal(staffDestination(rep, lead), '+14805550101');
  assert.throws(() => staffDestination({ role: 'sales', phone: lead.phone }, lead), /customer/);
  assert.throws(() => staffDestination({ role: 'sales', phone: '' }, lead), /mobile/);
  assert.throws(() => staffDestination({ role: 'other', phone: rep.phone }, lead), /Refusing/);
});

test('assignment and overdue texts include an address and omit a blank one', () => {
  const withAddress = assignmentText({
    name: 'Priya Shah',
    phone: '(602) 555-0190',
    address: '85251',
    note: 'Example: form said patio doors.',
    callWindow: 'weekday',
  });
  assert.match(withAddress, /85251/);
  assert.match(withAddress, /Call within 1 hour\./);
  const noAddress = assignmentText({
    name: 'Priya Shah',
    phone: '(602) 555-0190',
    address: '  ',
    note: '',
    callWindow: 'weekend',
  });
  assert.equal(noAddress.includes('85251'), false);
  assert.match(noAddress, /Call within 4 hours\./);
  assert.equal(noAddress.split('\n').length, 3);

  const overdue = overdueText({
    name: 'Sam Ortiz',
    phone: '(480) 555-0177',
    address: '123 W Example St, Phoenix, AZ 85016',
    repName: 'Eric Havins',
    callWindow: 'weekday',
  });
  assert.match(overdue, /123 W Example St/);
  assert.match(overdue, /within 1 hour/);
  const overdueBlank = overdueText({
    name: 'Sam Ortiz', phone: '(480) 555-0177', address: '', repName: 'Eric Havins', callWindow: 'weekend',
  });
  assert.equal(overdueBlank.includes('Example St'), false);
  assert.match(overdueBlank, /within 4 hours/);
});

test('send uses the company line and one staff number', async () => {
  let seen;
  const result = await sendStaffText({
    env: { QUO_API_KEY: 'test-key', QUO_FROM_NUMBER: '+14805550100' },
    profile: rep,
    lead,
    content: assignmentText({ name: 'Priya Shah', phone: lead.phone, address: '85251', note: 'Patio doors.', callWindow: 'weekday' }),
    fetchImpl: async (url, init) => {
      seen = { url, init, body: JSON.parse(init.body) };
      assert.equal(init.headers.Authorization, 'test-key');
      return { ok: true, status: 202, json: async () => ({ data: { id: 'msg-1' } }) };
    },
  });
  assert.equal(result.id, 'msg-1');
  assert.equal(seen.url, 'https://api.quo.com/v1/messages');
  assert.equal(seen.body.from, '+14805550100');
  assert.deepEqual(seen.body.to, ['+14805550101']);
  assert.equal(seen.body.setInboxStatus, 'done');
  assert.match(seen.body.content, /85251/);
  await assert.rejects(() => sendStaffText({
    env: { QUO_API_KEY: 'test-key', QUO_FROM_NUMBER: '+14805550100' },
    profile: { role: 'sales', phone: lead.phone },
    lead,
    content: 'nope',
    fetchImpl: async () => { throw new Error('should not send'); },
  }), /customer/);
});
