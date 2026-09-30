import { isIP } from 'node:net';
import { Agent, buildConnector, setGlobalDispatcher } from 'undici';
import { isPrivateAddress } from './mintUrl';
import { blocked, guardedLookup } from './netguard';

const connect = buildConnector({ lookup: guardedLookup, timeout: 10_000 });

setGlobalDispatcher(
  new Agent({
    connect: (options, callback) => {
      const host = options.hostname.replace(/^\[|\]$/g, '');
      if (isIP(host) && isPrivateAddress(host)) return callback(blocked(host), null);
      connect(options, callback);
    },
  })
);
