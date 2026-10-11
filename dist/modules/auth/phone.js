/**
 * Phone number normalisation.
 *
 * The database stores phones in E.164 (`+<country><national number>`) and
 * enforces that shape with a CHECK constraint, so every value that reaches the
 * `users.phone` column has to be reduced to one canonical form first. Without
 * this, `61 000 0000` and `610000000` would be two accounts for the same person
 * and login by phone would be a coin flip.
 *
 * The project is Somali-first, so the country code is +252 and a bare local
 * number is assumed to be Somali. Anything that does not fit is rejected here
 * rather than silently stored, because a phone normalised wrongly is a phone
 * nobody can ever log in with again.
 *
 * All of these are the same account, +252610000000:
 *   '61 000 0000'  '61-000-0000'  '(061) 000-0000'  '0610000000'
 *   '+252610000000'  '252610000000'  '00252610000000'
 */
/** Somalia. Also the country assumed for a number typed without one. */
export const DEFAULT_COUNTRY_CODE = '252';
/**
 * National (significant) number bounds for the countries this deployment
 * serves. Used both to validate a national number and to decide whether a bare
 * string is a local number or already carries its country code.
 */
const NATIONAL_NUMBER_RULES = {
    '252': { min: 8, max: 9 },
};
/** E.164 itself: at most 15 digits, first country digit non-zero. */
const MAX_NATIONAL_DIGITS = 15;
export class PhoneValidationError extends Error {
    input;
    reason;
    constructor(message, input, reason) {
        super(message);
        this.input = input;
        this.reason = reason;
        this.name = 'PhoneValidationError';
    }
}
/** True when the value looks like an email address rather than a phone number. */
export function isEmailLike(value) {
    return value.includes('@');
}
/** Separators people legitimately paste in: whitespace, dash, dot, brackets. */
const SEPARATORS = /[\s\-‐-―.()[\]]/g;
function ruleFor(countryCode) {
    const rule = NATIONAL_NUMBER_RULES[countryCode];
    if (!rule) {
        throw new PhoneValidationError(`This deployment has no numbering rules for +${countryCode}`, countryCode, 'unsupported country code');
    }
    return rule;
}
function isValidNationalLength(digits, rule) {
    return digits.length >= rule.min && digits.length <= rule.max;
}
/**
 * Normalises a user supplied phone number to E.164.
 *
 * @throws {PhoneValidationError} with a message meant to be shown to the user.
 */
export function normalisePhone(input, defaultCountryCode = DEFAULT_COUNTRY_CODE) {
    const raw = (input ?? '').trim();
    const rule = ruleFor(defaultCountryCode);
    if (raw === '') {
        throw new PhoneValidationError('Phone number is required', input, 'empty');
    }
    if (isEmailLike(raw)) {
        throw new PhoneValidationError(`This does not look like a phone number: ${input}`, input, 'contains letters or symbols');
    }
    // Strip the separators first, but reject anything that is not a digit or a
    // separator. Removing unknown characters silently is what turns a typo into
    // a different real account.
    const compact = raw.replace(SEPARATORS, '');
    if (!/^\+?\d{1,20}$/.test(compact)) {
        throw new PhoneValidationError(`This does not look like a phone number: ${input}`, input, 'contains letters or symbols');
    }
    const hasPlus = compact.startsWith('+');
    // A leading 00 is the international access prefix written out; it is
    // converted rather than rejected, because that is how a number gets copied
    // out of a desktop dialler.
    const hasIddPrefix = compact.startsWith('00');
    if (hasPlus || hasIddPrefix) {
        const digits = compact.replace(/^\+/, '').replace(/^00/, '');
        if (!digits.startsWith(defaultCountryCode)) {
            throw new PhoneValidationError(`Only +${defaultCountryCode} numbers are accepted, got: ${input}`, input, 'unsupported country code');
        }
        const national = digits.slice(defaultCountryCode.length);
        assertNationalLength(national, rule, defaultCountryCode, input);
        return `+${defaultCountryCode}${national}`;
    }
    // Bare input. Two readings are possible, so they are disambiguated by
    // length rather than by guessing: a leading 0 means a local number written
    // with its trunk prefix, and anything longer than a national number can be
    // must already carry the country code.
    const withoutTrunkZero = compact.startsWith('0') && compact.length > 1 ? compact.slice(1) : compact;
    if (isValidNationalLength(withoutTrunkZero, rule)) {
        return `+${defaultCountryCode}${withoutTrunkZero}`;
    }
    if (compact.startsWith(defaultCountryCode)) {
        const national = compact.slice(defaultCountryCode.length);
        if (isValidNationalLength(national, rule)) {
            return `+${defaultCountryCode}${national}`;
        }
    }
    if (compact.length > rule.max) {
        throw new PhoneValidationError(`Only +${defaultCountryCode} numbers are accepted, got: ${input}`, input, 'unsupported country code');
    }
    assertNationalLength(withoutTrunkZero, rule, defaultCountryCode, input);
    throw new PhoneValidationError(`This does not look like a phone number: ${input}`, input, 'wrong length');
}
function assertNationalLength(national, rule, countryCode, input) {
    if (national.startsWith('0')) {
        throw new PhoneValidationError(`This does not look like a phone number: ${input}`, input, 'contains letters or symbols');
    }
    if (national.length > MAX_NATIONAL_DIGITS) {
        throw new PhoneValidationError(`This does not look like a phone number: ${input}`, input, 'wrong length');
    }
    if (!isValidNationalLength(national, rule)) {
        throw new PhoneValidationError(`A +${countryCode} number must have between ${rule.min} and ${rule.max} digits, `
            + `this one has ${national.length}: ${input}`, input, 'wrong length');
    }
}
/** Convenience wrapper: true when the value normalises without throwing. */
export function isValidPhone(input) {
    try {
        normalisePhone(input);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=phone.js.map