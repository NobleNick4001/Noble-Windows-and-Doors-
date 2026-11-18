// HubSpot webhook signature v3. No network.
// source = method + full request URI + raw body + timestamp, HMAC-SHA256, base64.

export async function hubspotSignatureOk({ method, uri, body, timestamp, signature, secret, now = Date.now() }) {
  const key = String(secret || '');
  const got = String(signature || '');
  const stamp = Number(timestamp);
  if (!key || !got || !Number.isFinite(stamp)) return false;
  if (Math.abs(now - stamp) > 5 * 60 * 1000) return false;
  const source = `${String(method || '').toUpperCase()}${uri || ''}${body || ''}${timestamp}`;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(source));
  const digest = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (digest.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < digest.length; i += 1) diff |= digest.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
