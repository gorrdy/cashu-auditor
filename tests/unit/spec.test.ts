import { describe, expect, it } from 'vitest';
import { parseSpec } from '@/lib/probe';

describe('parseSpec', () => {
  it('reads methods, limits and features', () => {
    const spec = parseSpec({
      name: 'x',
      tos_url: 'https://example.com/tos',
      urls: ['https://example.com', 'http://2tcc5ozzgxjzcx2dinxwmcguiuiyxuy22khyrw6etxgiw4f3u3duwzyd.onion/'],
      contact: [{ method: 'email', info: 'a@b.cz' }, { method: 'x' }],
      max_array_length: 1000,
      nuts: {
        '4': { methods: [{ method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 1000 }], disabled: false },
        '5': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: true },
        '17': { supported: [{ method: 'bolt11', unit: 'sat', commands: [] }] },
        '22': { bat_max_mint: 10 },
        '29': { max_batch_size: 100 },
      },
    });
    expect(spec.methods).toEqual([
      { op: 'mint', method: 'bolt11', unit: 'sat', min: 1, max: 1000 },
      { op: 'melt', method: 'bolt11', unit: 'sat', min: undefined, max: undefined },
    ]);
    expect(spec.meltDisabled).toBe(true);
    expect(spec.mintDisabled).toBe(false);
    expect(spec.authRequired).toBe(true);
    expect(spec.websockets).toBe(true);
    expect(spec.batchMax).toBe(100);
    expect(spec.onionUrl).toMatch(/\.onion$/);
    expect(spec.contact).toEqual([{ method: 'email', info: 'a@b.cz' }]);
    expect(spec.tosUrl).toBe('https://example.com/tos');
  });
  it('drops non-https terms links', () => {
    expect(parseSpec({ tos_url: 'javascript:alert(1)', nuts: {} }).tosUrl).toBeNull();
  });
});
