// Pure HubSpot contact/deal matching. Imported by the edge function and by node tests.
// Auto-link only on one confident winner: exact email, exact phone (last 10), or
// last name + first name (prefix/nickname) + the same street number and street.

const NICKNAMES = [
  ['bob', 'robert', 'rob', 'bobby', 'robbie'],
  ['bill', 'william', 'will', 'billy', 'liam'],
  ['jim', 'james', 'jimmy', 'jamie'],
  ['mike', 'michael', 'mick', 'mikey'],
  ['nick', 'nicholas', 'nic', 'nicky'],
  ['joe', 'joseph', 'joey'],
  ['tom', 'thomas', 'tommy'],
  ['dave', 'david', 'davey'],
  ['dan', 'daniel', 'danny'],
  ['steve', 'steven', 'stephen', 'steve'],
  ['chris', 'christopher', 'kristopher', 'kris'],
  ['matt', 'matthew', 'matty'],
  ['alex', 'alexander', 'alexandra'],
  ['sam', 'samuel', 'samantha', 'sammy'],
  ['tony', 'anthony'],
  ['rick', 'richard', 'rich', 'dick'],
  ['ted', 'theodore', 'teddy'],
  ['ed', 'edward', 'eddie', 'ted'],
  ['liz', 'elizabeth', 'beth', 'betty', 'lizzy'],
  ['kate', 'katherine', 'catherine', 'kathy', 'cathy', 'katie'],
  ['jen', 'jennifer', 'jenny'],
  ['meg', 'megan', 'margaret', 'maggie', 'peggy'],
  ['andy', 'andrew', 'drew'],
  ['ben', 'benjamin', 'benny'],
  ['greg', 'gregory'],
  ['jeff', 'jeffrey', 'geoff', 'geoffrey'],
  ['ken', 'kenneth', 'kenny'],
  ['ron', 'ronald', 'ronnie'],
  ['tim', 'timothy', 'timmy'],
  ['josh', 'joshua'],
  ['jon', 'john', 'johnny', 'jonathan'],
  ['pat', 'patrick', 'patricia', 'patty'],
];

const NICK = new Map();
for (const group of NICKNAMES) {
  for (const name of group) NICK.set(name, group);
}

const DIRS = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'north', 'south', 'east', 'west']);
const SUFFIX = new Set([
  'st', 'street', 'ave', 'avenue', 'rd', 'road', 'dr', 'drive', 'ln', 'lane', 'blvd', 'boulevard',
  'ct', 'court', 'cir', 'circle', 'way', 'pl', 'place', 'pkwy', 'parkway', 'ter', 'terrace', 'trl', 'trail',
]);
const UNIT = new Set(['apt', 'apartment', 'unit', 'ste', 'suite', 'fl', 'floor', 'bldg', 'building']);
const STATES = new Set(['al','ak','az','ar','ca','co','ct','dc','de','fl','ga','hi','ia','id','il','in','ks','ky','la','ma','md','me','mi','mn','mo','ms','mt','nc','nd','ne','nh','nj','nm','nv','ny','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','va','vt','wa','wi','wv','wy']);

export function phoneLast10(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

export function normEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function phoneFormats(value) {
  const last = phoneLast10(value);
  if (!last) return [];
  const a = last.slice(0, 3);
  const b = last.slice(3, 6);
  const c = last.slice(6);
  const raw = String(value || '').trim();
  const all = [
    last,
    `1${last}`,
    `+1${last}`,
    `(${a}) ${b}-${c}`,
    `${a}-${b}-${c}`,
    `${a}.${b}.${c}`,
    `${a} ${b} ${c}`,
    `+1 (${a}) ${b}-${c}`,
    `1 (${a}) ${b}-${c}`,
  ];
  if (raw) all.push(raw);
  return [...new Set(all)];
}

function letters(value) {
  return String(value || '').toLowerCase().replace(/[^a-z]/g, '');
}

export function parseName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const first = parts[0] || '';
  const last = parts.length > 1 ? parts.slice(1).join(' ') : '';
  return { first, last, firstKey: letters(first), lastKey: letters(last) };
}

export function firstNamesMatch(a, b) {
  const x = letters(a);
  const y = letters(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const group = NICK.get(x);
  if (group && group.includes(y)) return true;
  const short = x.length <= y.length ? x : y;
  const long = x.length <= y.length ? y : x;
  return short.length >= 3 && long.startsWith(short);
}

export function parseAddress(address) {
  const raw = String(address || '');
  const zip = (raw.match(/\b(\d{5})(?:-\d{4})?\b/) || [null, ''])[1] || '';
  const streetLine = raw.split(',')[0];
  const numMatch = streetLine.match(/^\s*(\d+[a-zA-Z]?)\b/);
  const number = numMatch ? numMatch[1].toLowerCase() : '';
  const rest = (numMatch ? streetLine.slice(numMatch.index + numMatch[0].length) : streetLine)
    .replace(/\b\d{5}(?:-\d{4})?\b/g, ' ');
  const tokens = rest.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
    .filter((t) => !DIRS.has(t) && !SUFFIX.has(t) && !UNIT.has(t) && !STATES.has(t) && !/^\d+[a-z]?$/.test(t));
  return { number, zip, street: tokens.join(' '), tokens };
}

function streetsAlign(a, b) {
  if (!a.length || !b.length) return false;
  const small = a.length <= b.length ? a : b;
  const big = new Set(a.length <= b.length ? b : a);
  return small.every((token) => big.has(token));
}

export function addressStrength(a, b) {
  const pa = parseAddress(a);
  const pb = parseAddress(b);
  const street = streetsAlign(pa.tokens, pb.tokens);
  if (pa.number && pb.number && pa.number === pb.number && street) return 'strong';
  if (street && pa.zip && pa.zip === pb.zip) return 'medium';
  if (pa.number && pb.number && pa.number === pb.number && pa.zip && pa.zip === pb.zip) return 'medium';
  return 'none';
}

export function customerQuery(input) {
  const doc = input?.document || {};
  const customer = doc.customer || input?.customer || {};
  return {
    name: input?.customer_name || input?.name || customer.name || '',
    email: input?.customer_email || input?.email || customer.email || '',
    phone: input?.customer_phone || input?.phone || customer.phone || '',
    address: input?.customer_address || input?.address || customer.address || '',
  };
}

function flatContact(row) {
  const p = row?.properties || row || {};
  return {
    id: String(row?.id || p.hs_object_id || p.id || ''),
    email: p.email || '',
    phone: p.phone || '',
    mobilephone: p.mobilephone || '',
    firstname: p.firstname || '',
    lastname: p.lastname || '',
    address: p.address || '',
    zip: p.zip || '',
    city: p.city || '',
  };
}

function contactAddress(c) {
  return [c.address, c.city, c.zip].filter(Boolean).join(', ');
}

export function scoreCandidate(query, contact) {
  const q = customerQuery(query);
  const c = flatContact(contact);
  const qEmail = normEmail(q.email);
  const cEmail = normEmail(c.email);
  const qPhone = phoneLast10(q.phone);
  const cPhone = phoneLast10(c.phone);
  const cMobile = phoneLast10(c.mobilephone);
  const qName = parseName(q.name);
  const lastExact = Boolean(qName.lastKey && qName.lastKey === letters(c.lastname));
  const firstMatch = firstNamesMatch(qName.firstKey, c.firstname);
  const strength = addressStrength(q.address, contactAddress(c));
  const reasons = [];
  let score = 0;
  let confident = false;

  if (qEmail && cEmail && qEmail === cEmail) {
    score += 100;
    reasons.push('email');
    confident = true;
  }
  if (qPhone && (qPhone === cPhone || qPhone === cMobile)) {
    score += 80;
    reasons.push('phone');
    confident = true;
  }
  if (lastExact) score += 30;
  if (firstMatch) score += 25;
  if (strength === 'strong') score += 40;
  else if (strength === 'medium') score += 12;

  if (lastExact && firstMatch && strength === 'strong') {
    score += 20;
    reasons.push('name+address');
    confident = true;
  }

  const possible = !confident && (
    (lastExact && firstMatch)
    || strength === 'strong'
    || (lastExact && strength === 'medium')
  );

  const name = [c.firstname, c.lastname].filter(Boolean).join(' ');
  return {
    id: c.id,
    name,
    phone: c.phone || c.mobilephone || '',
    email: c.email || '',
    address: contactAddress(c),
    score,
    confident,
    possible,
    reasons,
    strength,
  };
}

export function pickAuto(matches) {
  const confident = (matches || []).filter((m) => m.confident).slice().sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  if (!confident.length) return null;
  if (confident.length === 1) return confident[0];
  if (confident[0].score > confident[1].score) return confident[0];
  return null;
}

export function rankCandidates(query, contacts) {
  const seen = new Set();
  const matches = [];
  for (const row of contacts || []) {
    const scored = scoreCandidate(query, row);
    if (!scored.id || seen.has(scored.id)) continue;
    if (!scored.confident && !scored.possible) continue;
    seen.add(scored.id);
    matches.push(scored);
  }
  matches.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  return { matches, auto: pickAuto(matches) };
}

export function resolveContactChoice(choice, matches) {
  const list = matches || [];
  const auto = pickAuto(list);
  const flag = list.filter((m) => m.confident || m.possible).map((m) => ({
    id: m.id, name: m.name, phone: m.phone, email: m.email,
  }));
  if (choice?.createNew) return { action: 'create', contactId: null, flag };
  if (choice?.contactId) return { action: 'link', contactId: String(choice.contactId), flag: [] };
  if (auto) return { action: 'link', contactId: String(auto.id), flag: [] };
  return { action: 'create', contactId: null, flag };
}

export function isClosedDeal(deal) {
  const p = deal?.properties || deal || {};
  if (String(p.hs_is_closed ?? '').toLowerCase() === 'true') return true;
  const stage = String(p.dealstage || '').toLowerCase();
  const label = String(p.stageLabel || p.dealstage_label || '').toLowerCase();
  return stage === 'closedwon' || stage === 'closedlost'
    || /closed\s*won|closed\s*lost/.test(stage)
    || /closed\s*won|closed\s*lost/.test(label);
}

function stamp(deal) {
  const p = deal?.properties || deal || {};
  return String(p.hs_lastmodifieddate || deal?.updatedAt || '');
}

export function pickDeal({ createNew = false, estimateDealId = null, chosenDealId = null, explicitChoice = false, deals = [] } = {}) {
  if (createNew) return { action: 'create', dealId: null };
  if (!explicitChoice && estimateDealId) return { action: 'update', dealId: String(estimateDealId) };
  if (chosenDealId) return { action: 'update', dealId: String(chosenDealId) };
  const open = (deals || []).filter((d) => d && d.id && !isClosedDeal(d));
  open.sort((a, b) => stamp(b).localeCompare(stamp(a)) || String(a.id).localeCompare(String(b.id)));
  if (open.length) return { action: 'update', dealId: String(open[0].id) };
  return { action: 'create', dealId: null };
}
