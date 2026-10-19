// Python re.I uses Unicode word boundaries and four extra ASCII case variants.
const WORD = '[\\p{L}\\p{N}_]';
export function search(pattern: string, value: string, ignoreCase = true): boolean {
  const translated = pattern.replace(/(?<!\\)\./g, '[^\\n]').replaceAll('\\b', `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`)
    .replaceAll('\\d', '\\p{Nd}')
    .replaceAll('\\s', '[\\t-\\r \\u001c-\\u001f\\u0085\\p{Zs}\\u2028\\u2029]');
  const key = String(ignoreCase) + translated;
  let regex = regexes.get(key);
  // Python dot excludes only LF, whereas JavaScript also excludes CR/LS/PS.
  if (!regex) { regex = new RegExp(translated, ignoreCase ? 'ius' : 'us'); regexes.set(key, regex); }
  return regex.test(ignoreCase ? value.replace(/[İıſK]/gu, c => ({ 'İ': 'i', 'ı': 'i', 'ſ': 's', 'K': 'k' })[c]!) : value);
}
const regexes = new Map<string, RegExp>();

// Round the actual binary float to two decimal places, with ties to even,
// matching Python round(x, 2), including values such as 2.675.
export function round2(value: number): number {
  if (value === 0) return 0;
  const sign = value < 0 ? -1 : 1;
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, Math.abs(value));
  const bits = view.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 2047n);
  let numerator = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  const power = (exponent ? exponent - 1023 : -1022) - 52;
  numerator *= 100n;
  const denominator = power < 0 ? 1n << BigInt(-power) : 1n;
  if (power > 0) numerator <<= BigInt(power);
  let quotient = numerator / denominator;
  const twice = (numerator % denominator) * 2n;
  if (twice > denominator || (twice === denominator && quotient % 2n === 1n)) quotient++;
  return sign * Number(quotient) / 100;
}

export function microtimestamp(value: string): bigint {
  // Offset required; never interpret an input in the machine's local timezone.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error('Expected ISO datetime with explicit timezone');
  const calendar = Date.parse(`${match[1]}T${match[2]}Z`);
  if (!Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 19) !== `${match[1]}T${match[2]}`) throw new Error('Invalid calendar date');
  const base = Date.parse(`${match[1]}T${match[2]}${match[4]}`);
  if (!Number.isFinite(base)) throw new Error('Invalid datetime');
  return BigInt(base) * 1000n + BigInt((match[3] ?? '').padEnd(6, '0'));
}
export function timestamp(value: string): number {
  return Number(microtimestamp(value)) / 1e6;
}

// Python compares Unicode code points, not UTF-16 code units or locale collation.
export function compareText(a: string, b: string): number {
  const aa = Array.from(a, c => c.codePointAt(0)!); const bb = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return aa.length - bb.length;
}
