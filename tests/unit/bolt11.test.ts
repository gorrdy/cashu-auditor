import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { paymentHashOf, preimageMatches } from '@/lib/bolt11';

const BOLT11_SPEC_EXAMPLE =
  'lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql';

describe('bolt11', () => {
  it('extracts the payment hash', () => {
    expect(paymentHashOf(BOLT11_SPEC_EXAMPLE)).toBe('0001020304050607080900010203040506070809000102030405060708090102');
  });
  it('accepts the matching preimage and rejects the zero preimage', () => {
    const preimage = 'ab'.repeat(32);
    const hash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
    expect(preimageMatches(hash, preimage)).toBe(true);
    expect(preimageMatches(hash, '0'.repeat(64))).toBe(false);
  });
  it('is unknown without a preimage', () => {
    expect(preimageMatches('00'.repeat(32), null)).toBeNull();
    expect(preimageMatches(null, 'ab'.repeat(32))).toBeNull();
  });
});
