import { describe, expect, it } from 'vitest';
import { isPrivateAddress, normalizeMintUrl } from '@/lib/mintUrl';

describe('isPrivateAddress', () => {
  const blocked = [
    '127.0.0.1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '::ffff:a00:1', '::ffff:10.0.0.1',
    '::7f00:1', '::127.0.0.1', '64:ff9b::7f00:1', '64:ff9b::8.8.8.8', '2001:db8::1', '2002:7f00:1::1', '2001::1',
    'fe80::1', 'febf::1', 'fd00::1', 'ff02::1', 'fec0::1', '::1', '::', '0.0.0.0', '10.1.2.3', '100.76.1.1',
    '172.31.0.1', '192.168.1.1', '169.254.169.254', '192.0.2.1', '198.51.100.7', '203.0.113.9', '224.0.0.1',
    '255.255.255.255', 'fe80::1%eth0', 'not-an-ip',
  ];
  const allowed = [
    '8.8.8.8', '1.1.1.1', '9.9.9.9', '172.32.0.1', '100.128.0.1', '::ffff:8.8.8.8', '::ffff:808:808',
    '2a03:b0c0:3:f0::1', '2606:4700::6810:84e5', '2001:4860:4860::8888',
  ];
  it.each(blocked)('blocks %s', ip => expect(isPrivateAddress(ip)).toBe(true));
  it.each(allowed)('allows %s', ip => expect(isPrivateAddress(ip)).toBe(false));
});

describe('normalizeMintUrl', () => {
  it('adds https and strips trailing slashes', () => expect(normalizeMintUrl('Mint.Example.com/Bitcoin/')).toBe('https://mint.example.com/Bitcoin'));
  it('rejects http', () => expect(normalizeMintUrl('http://mint.example.com')).toBeNull());
  it('rejects credentials and query', () => {
    expect(normalizeMintUrl('https://a:b@mint.example.com')).toBeNull();
    expect(normalizeMintUrl('https://mint.example.com/?x=1')).toBeNull();
  });
});
