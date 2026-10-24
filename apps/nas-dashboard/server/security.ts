import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
export function hashPassword(password: string): string {
  if (password.length < 12) throw Error('password_minimum_12_characters');
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, hash: string): boolean {
  const [, salt, hex] = hash.split(':');
  if (!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash) || password.length > 1024) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hex, 'hex'));
}
export function redact(value: unknown): any {
  if (typeof value === 'string') return value
    .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9-]+\.)+[A-Z]{2,}/gi, (email) => '***@' + email.split('@')[1])
    .replace(/\bsk-[a-zA-Z0-9_-]{16,}/g, '[已隐藏]')
    .replace(/([?&](?:token|secret|signature|key)=)[^\s&"'<>]+/gi, '$1[已隐藏]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/password|secret|api_key|authorization|token|unsubscribe|confirmation|recipient_hash|message_id|page_id/i.test(key)).map(([key, v]) => [key, redact(v)]));
  return value;
}
export function safeUrl(value: unknown): string | null {
  try { const u = new URL(String(value)); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
