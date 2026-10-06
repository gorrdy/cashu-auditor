import { describe, expect, it } from 'vitest';
import { invoiceNode } from '@/lib/bolt11';

const MINIBITS = 'lnbc100n1p4v2zs5pp5n66aw52zh45w2akdp36jgqjqv373fxpff8e9qztekulmrd4muw0sdqqcqzzsxqrrsssp5xjsxj7du94597xy99e042rvxzyzfdjv3t44rrxmd8xqh5f3z2kjs9qxpqysgqc5l993km7l0h5dcn8lu6ujp9m67qlmxr8hsk98wkjdty9l0wkm3k9eq6qlgxykgu0wezqnxsav2txp8tqll8eqa5eyu6nql29mf2ggsqvg7kwv';
const COINOS = 'lnbc100n1p4v2zs5sp507r89xpx6r3dccy84q4rvh9q4vctsczzzd23885st633av8nwtjspp5w9y36rtfuy6h6n0efc5lz7r44cjd0gcnurra62u63x5lweuql8qqdqqxqyjw5qcqpjrzjqvxlc5mpc7kn2uunukugmzpktv0hmjvyxl2gts4drmfm3krxk4z7sr4zxyqq3pqqqqqqqqlgqqqqqzsqyg9qxpqysgq8jqwlaz53wq2nlr2pwp2mf5eru3havuqzrq64kfhnqjvy7vajwj5v0aaad5e0padq04wdce7gm82htcjxvu7yjfz88cqwx7djk759wsp54l68w';

describe('invoiceNode', () => {
  it('recovers the payee from the signature', () => {
    expect(invoiceNode(MINIBITS)?.payee).toBe('0330974249e7f1d9f515e04af3bc664b2e924641de53bb43fb9efe3fa6edf0e2ae');
  });
  it('reads route hints', () => {
    const node = invoiceNode(COINOS)!;
    expect(node.payee).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(node.hints.length).toBeGreaterThan(0);
    expect(node.hints[0][0].pubkey).toMatch(/^0[23][0-9a-f]{64}$/);
  });
  it('rejects garbage', () => {
    expect(invoiceNode('hello')).toBeNull();
  });
});
