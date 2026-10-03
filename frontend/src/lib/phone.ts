/**
 * Client-side phone normalisation.
 *
 * This mirrors `src/modules/auth/phone.ts` on purpose. The server normalises
 * before it writes anything, so if the client disagreed about the canonical
 * form, the number shown to the user would not be the number stored against
 * their account — and login by phone would fail for a number the user can read
 * off their own screen. Copying the rules is cheaper than debugging that.
 *
 * The result is a value to show, not to send: the server normalises again, and
 * sending the client's own output is a way to hide a divergence rather than
 * catch it.
 */

/** Somalia, and the country assumed for a number typed without one. */
export const DEFAULT_COUNTRY_CODE = '252';

/** National significant-number length for +252. */
const NATIONAL_MIN_DIGITS = 8;
const NATIONAL_MAX_DIGITS = 9;

/** E.164: at most 15 digits. */
const MAX_NATIONAL_DIGITS = 15;

/** Separators people legitimately paste in: whitespace, dash, dot, brackets. */
const SEPARATORS = /[\s\-‐-―.()[\]]/g;

export type PhoneProblem = 'empty' | 'letters' | 'country' | 'length';

export type PhoneResult =
  | { ok: true; e164: string }
  | { ok: false; reason: PhoneProblem };

export function isEmailLike(value: string): boolean {
  return value.includes('@');
}

function isValidNationalLength(digits: string): boolean {
  return digits.length >= NATIONAL_MIN_DIGITS && digits.length <= NATIONAL_MAX_DIGITS;
}

/** The `national` half of a number, checked the way the server checks it. */
function assertNationalLength(national: string): PhoneProblem | null {
  if (national.startsWith('0')) return 'letters';
  if (national.length > MAX_NATIONAL_DIGITS) return 'length';
  return isValidNationalLength(national) ? null : 'length';
}

export function normalisePhone(input: string): PhoneResult {
  const raw = (input ?? '').trim();
  if (raw === '') return { ok: false, reason: 'empty' };
  if (isEmailLike(raw)) return { ok: false, reason: 'letters' };

  // Separators are stripped, but anything that is neither a digit nor a
  // separator is a rejection. Removing unknown characters silently is how a
  // typo becomes a different real account.
  const compact = raw.replace(SEPARATORS, '');
  if (!/^\+?\d{1,20}$/.test(compact)) return { ok: false, reason: 'letters' };

  const hasPlus = compact.startsWith('+');
  // A leading 00 is the international access prefix written out.
  const hasIddPrefix = compact.startsWith('00');

  if (hasPlus || hasIddPrefix) {
    const digits = compact.replace(/^\+/, '').replace(/^00/, '');
    if (!digits.startsWith(DEFAULT_COUNTRY_CODE)) return { ok: false, reason: 'country' };
    const problem = assertNationalLength(digits.slice(DEFAULT_COUNTRY_CODE.length));
    if (problem) return { ok: false, reason: problem };
    return { ok: true, e164: `+${digits}` };
  }

  // Bare input. Two readings are possible, so they are separated by length: a
  // leading 0 is a trunk prefix, and anything longer than a national number
  // must already carry the country code.
  const withoutTrunkZero =
    compact.startsWith('0') && compact.length > 1 ? compact.slice(1) : compact;

  if (isValidNationalLength(withoutTrunkZero)) {
    return { ok: true, e164: `+${DEFAULT_COUNTRY_CODE}${withoutTrunkZero}` };
  }

  if (compact.startsWith(DEFAULT_COUNTRY_CODE)) {
    const national = compact.slice(DEFAULT_COUNTRY_CODE.length);
    if (isValidNationalLength(national)) {
      return { ok: true, e164: `+${DEFAULT_COUNTRY_CODE}${national}` };
    }
  }

  if (compact.length > NATIONAL_MAX_DIGITS) return { ok: false, reason: 'country' };

  return { ok: false, reason: assertNationalLength(withoutTrunkZero) ?? 'length' };
}

/** The canonical form when there is one, otherwise null. */
export function toE164(input: string): string | null {
  const result = normalisePhone(input);
  return result.ok ? result.e164 : null;
}

/**
 * True when the field holds something that should be sent as a phone number.
 *
 * An empty field is false rather than an error: "at least one of phone or email"
 * is the rule, and an untouched optional field is not a mistake.
 */
export function isFilledPhone(value: string): boolean {
  return value.trim() !== '';
}