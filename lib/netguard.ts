import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { isPrivateAddress } from './mintUrl';

export const blocked = (host: string) => new Error(`Blocked connection to private address ${host}`);

export const guardedLookup = ((hostname: string, options: LookupOptions, callback: (...args: unknown[]) => void) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err);
    if (addresses.length === 0 || addresses.some(a => isPrivateAddress(a.address))) return callback(blocked(hostname));
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}) as LookupFunction;
