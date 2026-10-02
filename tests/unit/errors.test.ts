import { describe, expect, it } from 'vitest';
import { errorMessage } from '@/lib/transfer';

describe('errorMessage', () => {
  it('keeps errors reported by mints and the network', () => {
    expect(errorMessage(new Error('Lightning payment failed: FAILURE_REASON_NO_ROUTE.'))).toBe('Lightning payment failed: FAILURE_REASON_NO_ROUTE.');
    expect(errorMessage(new Error('fetch failed at https://21mint.me/v1/info'))).toBe('fetch failed at https://21mint.me/v1/info');
    expect(errorMessage(new Error('Timeout after 60s'))).toBe('Timeout after 60s');
  });
  it('hides internal errors', () => {
    const prisma = new Error('Invalid `prisma.proof.create()` invocation in\n/srv/cashu-auditor/app/lib/transfer.ts:42:7\nUnique constraint failed');
    expect(errorMessage(prisma)).toBe('Internal auditor error');
    expect(errorMessage(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe('Internal auditor error');
    expect(errorMessage(new Error('SQLITE_BUSY: database is locked'))).toBe('Internal auditor error');
  });
  it('keeps only the first line', () => {
    expect(errorMessage(new Error('HTTP 502\n<html>stuff</html>'))).toBe('HTTP 502');
  });
});
