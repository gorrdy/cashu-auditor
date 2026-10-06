import { describe, expect, it } from 'vitest';
import { newestVersions, parseVersion, versionStatus } from '@/lib/versions';

describe('versions', () => {
  it('parses implementation and version', () => {
    expect(parseVersion('Nutshell/0.20.3.1')).toEqual({ impl: 'Nutshell', parts: [0, 20, 3, 1], prerelease: false });
    expect(parseVersion('cdk-mintd/0.17.0-rc.3')?.prerelease).toBe(true);
    expect(parseVersion('weird')).toBeNull();
  });
  it('flags mints two minor versions behind the newest seen', () => {
    const newest = newestVersions(['Nutshell/0.21.0', 'Nutshell/0.20.3', 'Nutshell/0.19.2', 'cdk-mintd/0.18.1', 'cdk-mintd/0.19.0-rc.1']);
    expect(versionStatus('Nutshell/0.19.2', newest)).toMatchObject({ outdated: true, newest: 'Nutshell/0.21.0' });
    expect(versionStatus('Nutshell/0.20.3', newest)?.outdated).toBe(false);
    expect(versionStatus('cdk-mintd/0.18.1', newest)).toBeNull();
  });
  it('ignores implementations seen only once', () => {
    expect(versionStatus('LekMint/1.1.1', newestVersions(['LekMint/1.1.1']))).toBeNull();
  });
});
