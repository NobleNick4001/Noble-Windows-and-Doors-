// HubSpot contact and deal matching. No network.
import { readFileSync } from 'node:fs';
import {
  phoneLast10, normEmail, phoneFormats, parseAddress, addressStrength, firstNamesMatch,
  rankCandidates, resolveContactChoice, isClosedDeal, pickDeal,
} from '../supabase/functions/hubspot-sync/match.js';

const fail = (msg) => { console.error('FAIL', msg); process.exitCode = 1; };
const eq = (actual, expected, msg) => {
  if (actual !== expected) fail(msg + ' — ' + JSON.stringify(actual) + ' !== ' + JSON.stringify(expected));
};

eq(phoneLast10('+1 (602) 555-0100'), '6025550100', 'phone keeps the last 10 digits');
eq(phoneLast10('1-602-555-0100'), '6025550100', 'leading 1 is dropped');
eq(phoneLast10('555-0100'), '', 'short numbers are not a phone match');
eq(normEmail('  Ada@Example.COM '), 'ada@example.com', 'email is trimmed and lowercased');
eq(phoneFormats('(602) 555-0100').includes('6025550100'), true, 'search formats include digits');
eq(phoneFormats('(602) 555-0100').includes('+16025550100'), true, 'search formats include +1');
eq(firstNamesMatch('Nick', 'Nicholas'), true, 'Nick is a nickname for Nicholas');
eq(firstNamesMatch('Bob', 'Robert'), true, 'Bob is a nickname for Robert');
eq(firstNamesMatch('Al', 'Alexander'), false, 'a two-letter prefix is not a first-name match');
eq(addressStrength('123 Main St', '123 Main Street'), 'strong', 'street suffix does not change the address');
eq(addressStrength('123 Main St', '123 Maine St'), 'none', 'Main is not Maine');
eq(parseAddress('123 Main St, Phoenix, AZ 85001').zip, '85001', 'zip is read from the address');

function contact(id, props) {
  return { id, properties: props };
}

const nick = rankCandidates(
  { name: 'Nick Sommer', email: '', phone: '', address: '123 Main St' },
  [contact('c1', { firstname: 'Nicholas', lastname: 'Sommer', address: '123 Main Street', city: 'Phoenix', zip: '85001', phone: '' })],
);
eq(nick.matches.length, 1, 'Nick at the same street is a candidate');
eq(nick.matches[0].confident, true, 'nickname plus street is confident');
eq(nick.auto?.id, 'c1', 'a single confident name+address match auto-links');

const bob = rankCandidates(
  { name: 'Bob Jones', email: '', phone: '4805551212', address: '10 Pine St' },
  [contact('c2', { firstname: 'Robert', lastname: 'Jones', address: '10 Pine Street', phone: '' })],
);
eq(bob.auto?.id, 'c2', 'Bob and Robert on the same street auto-link');
eq(bob.matches[0].reasons.includes('name+address'), true, 'name+address is the confident reason when the phone differs');

const moved = rankCandidates(
  { name: 'Nick Smith', email: '', phone: '', address: '123 Main St' },
  [contact('c3', { firstname: 'Nicholas', lastname: 'Smith', address: '500 Oak Ave', phone: '' })],
);
eq(moved.matches[0]?.confident, false, 'same person at a different address is not confident');
eq(moved.auto, null, 'a weak name match is not auto-linked');
eq(moved.matches[0]?.possible, true, 'same name at a different address is still flagged');

const neighbor = rankCandidates(
  { name: 'Alice Smith', email: '', phone: '', address: '123 Main St' },
  [contact('c4', { firstname: 'Robert', lastname: 'Smith', address: '123 Main Street', phone: '' })],
);
eq(neighbor.matches[0]?.confident, false, 'a different first name at the same address is not confident');
eq(neighbor.auto, null, 'address alone does not auto-link');
eq(neighbor.matches[0]?.possible, true, 'the same street is a possible match');

const phoneHit = rankCandidates(
  { name: 'Alice Anderson', email: '', phone: '(602) 555-1212', address: '9 Other Rd' },
  [contact('c5', { firstname: 'Bob', lastname: 'Brown', phone: '+1 602-555-1212', email: 'bob@example.com', address: '1 Far St' })],
);
eq(phoneHit.auto?.id, 'c5', 'exact phone auto-links even when the name differs');
eq(phoneHit.matches[0].reasons.includes('phone'), true, 'phone is the confident reason');

const emailHit = rankCandidates(
  { name: 'Someone Else', email: 'ADA@Example.com', phone: '', address: '' },
  [contact('c6', { firstname: 'Ada', lastname: 'Lovelace', email: 'ada@example.com', phone: '0000000000' })],
);
eq(emailHit.auto?.id, 'c6', 'email match ignores case');

const tied = rankCandidates(
  { name: 'Pat Lee', email: '', phone: '4805559999', address: '' },
  [
    contact('a', { firstname: 'Pat', lastname: 'Lee', phone: '4805559999' }),
    contact('b', { firstname: 'Pat', lastname: 'Lee', mobilephone: '(480) 555-9999' }),
  ],
);
eq(tied.matches.length, 2, 'both phone hits are candidates');
eq(tied.auto, null, 'tied confident matches do not auto-link');
const tiedChoice = resolveContactChoice(null, tied.matches);
eq(tiedChoice.action, 'create', 'a tie creates a new contact');
eq(tiedChoice.flag.length, 2, 'a tie flags both possible contacts');

const none = rankCandidates(
  { name: 'Zelda Quinn', email: 'zelda@example.com', phone: '6025550000', address: '44 Birch Rd' },
  [contact('c7', { firstname: 'Ann', lastname: 'Other', email: 'ann@example.com', phone: '4805552222', address: '9 Side St' })],
);
eq(none.matches.length, 0, 'unrelated contacts are not candidates');
eq(resolveContactChoice(null, none.matches).action, 'create', 'no candidates means create');
eq(resolveContactChoice(null, none.matches).flag.length, 0, 'no candidates means nothing to flag');

const chosen = resolveContactChoice({ contactId: 'c1' }, nick.matches);
eq(chosen.action, 'link', 'a rep can confirm an existing contact');
eq(chosen.contactId, 'c1', 'the confirmed contact id is kept');
const fresh = resolveContactChoice({ createNew: true }, nick.matches);
eq(fresh.action, 'create', 'new lead creates a contact');
eq(fresh.flag.length, 1, 'new lead still flags the possible match');

eq(isClosedDeal({ properties: { dealstage: 'closedwon', hs_is_closed: 'true' } }), true, 'closed won is closed');
eq(isClosedDeal({ properties: { dealstage: 'closedlost' } }), true, 'closed lost is closed');
eq(isClosedDeal({ properties: { dealstage: 'appointmentscheduled', hs_is_closed: 'false' } }), false, 'an appointment is open');

const openDeals = [
  { id: 'older', properties: { dealstage: 'appointmentscheduled', hs_is_closed: 'false', hs_lastmodifieddate: '2026-09-01T00:00:00.000Z' } },
  { id: 'newer', properties: { dealstage: 'presentationscheduled', hs_is_closed: 'false', hs_lastmodifieddate: '2026-10-01T00:00:00.000Z' } },
  { id: 'won', properties: { dealstage: 'closedwon', hs_is_closed: 'true', hs_lastmodifieddate: '2026-10-13T00:00:00.000Z' } },
];
eq(pickDeal({ estimateDealId: 'keep-me', deals: openDeals }).dealId, 'keep-me', 'an estimate deal id is reused');
eq(pickDeal({ deals: openDeals }).dealId, 'newer', 'the newest open deal is reused');
eq(pickDeal({ deals: openDeals }).action, 'update', 'an open deal is updated');
const closedOnly = [
  { id: 'won', properties: { dealstage: 'closedwon', hs_is_closed: 'true', hs_lastmodifieddate: '2026-10-02T00:00:00.000Z' } },
  { id: 'lost', properties: { dealstage: 'closedlost', hs_is_closed: 'true', hs_lastmodifieddate: '2026-10-03T00:00:00.000Z' } },
];
eq(pickDeal({ deals: closedOnly }).action, 'create', 'closed won and closed lost deals are not reused');
eq(pickDeal({ createNew: true, estimateDealId: 'keep-me', deals: openDeals }).action, 'create', 'new lead does not attach the old deal');
eq(pickDeal({
  estimateDealId: 'stale',
  chosenDealId: null,
  explicitChoice: true,
  deals: openDeals,
}).dealId, 'newer', 'a confirmed lead with no chosen deal uses the open deal, not a stale id');
eq(pickDeal({ chosenDealId: 'picked', explicitChoice: true, deals: openDeals }).dealId, 'picked', 'the deal the rep confirmed is updated');

const fn = readFileSync(new URL('../supabase/functions/hubspot-sync/index.ts', import.meta.url), 'utf8');
for (const needle of ['./match.js', "payload.mode === 'preview'", 'mobilephone', 'hs_note_body', 'associations/default', 'Deposit (60%)', 'Final (40%)']) {
  if (!fn.includes(needle)) fail('hubspot function missing ' + needle);
}
const page = readFileSync(new URL('../js/pages/estimate.js', import.meta.url), 'utf8');
for (const needle of ["id: 'hubspot-match'", 'Use this lead', 'New lead', 'preparePresented']) {
  if (!page.includes(needle)) fail('estimate page missing ' + needle);
}
const client = readFileSync(new URL('../js/cloud.js', import.meta.url), 'utf8');
if (!client.includes("mode: 'preview'") || !client.includes('createNew: true')) fail('client should preview and can choose a new lead');

if (process.exitCode) console.error('hubspot match check failed');
else console.log('hubspot match check ok');
