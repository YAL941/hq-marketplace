import { normalisePhone as serverNormalise } from '../src/modules/auth/phone.js';
import { normalisePhone as clientNormalise } from '../frontend/src/lib/phone.js';

const CASES = [
  '61 000 0000', '61-000-0000', '(061) 000-0000', '0610000000',
  '+252610000000', '252610000000', '00252610000000',
  '061000000', '610000000',
  '61 00 00', 'abc', '+1 202 555 0143', '', '252610000000',
];

/**
 * The server names its reasons in prose and the client names them with short
 * tokens, because the client's are i18n keys. They are mapped so this compares
 * the actual decision — accept, or reject for which reason — rather than the
 * two vocabularies.
 */
const REASON = {
  'wrong length': 'length',
  'contains letters or symbols': 'letters',
  'unsupported country code': 'country',
  empty: 'empty',
};

const server = (input) => {
  try {
    return serverNormalise(input);
  } catch (error) {
    const reason = error.reason ?? 'unknown';
    return `REJECTED(${REASON[reason] ?? reason})`;
  }
};

const client = (input) => {
  const result = clientNormalise(input);
  return result.ok ? result.e164 : `REJECTED(${result.reason})`;
};

let mismatches = 0;
for (const input of CASES) {
  const s = server(input);
  const c = client(input);
  const same = s === c;
  if (!same) mismatches += 1;
  console.log(`${same ? 'match  ' : 'DIFFER '} ${JSON.stringify(input).padEnd(20)} server=${s.padEnd(22)} client=${c}`);
}

console.log(`\n${mismatches === 0 ? 'client agrees with the server on every case' : `${mismatches} DISAGREEMENT(S)`}`);
process.exit(mismatches === 0 ? 0 : 1);