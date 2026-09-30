import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CONTAINER = 'cashu-audit-test-mint';
const PORT = 3350;
const IMAGE = 'cashubtc/nutshell:0.20.3';

async function waitFor(url: string, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    testMintUrl: string | null;
  }
}

export default async function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), 'cashu-audit-test-'));
  process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`;
  process.env.WALLET_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  execSync('npx prisma db push', { env: process.env, stdio: 'ignore' });

  const docker = spawnSync('docker', ['version'], { stdio: 'ignore' }).status === 0;
  if (docker) {
    spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
    const run = spawnSync('docker', [
      'run', '-d', '--rm', '--name', CONTAINER, '-p', `127.0.0.1:${PORT}:3338`,
      '-e', 'MINT_LISTEN_HOST=0.0.0.0', '-e', 'MINT_LISTEN_PORT=3338',
      '-e', `MINT_PRIVATE_KEY=cashu-audit-test-${Date.now()}`,
      '-e', 'MINT_BACKEND_BOLT11_SAT=FakeWallet', '-e', 'FAKEWALLET_DELAY_PAYMENT=FALSE',
      '-e', 'MINT_INPUT_FEE_PPK=0', '-e', 'MINT_DATABASE=data/mint', IMAGE, 'poetry', 'run', 'mint',
    ], { encoding: 'utf8' });
    if (run.status === 0 && (await waitFor(`http://127.0.0.1:${PORT}/v1/info`, 60_000))) {
      process.env.TEST_MINT_URL = `http://127.0.0.1:${PORT}`;
    }
  }

  project.provide('databaseUrl', process.env.DATABASE_URL!);
  project.provide('testMintUrl', process.env.TEST_MINT_URL ?? null);

  return () => {
    if (docker) spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
    rmSync(dir, { recursive: true, force: true });
  };
}
