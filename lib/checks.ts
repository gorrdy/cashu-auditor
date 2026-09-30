import { Amount, type Proof as CashuProof } from '@cashu/cashu-ts';
import { fetch as undiciFetch, Socks5ProxyAgent } from 'undici';
import { prisma } from './prisma';
import { createWallet, restoreProofs } from './wallet';
import { dleqStatus, errorMessage, withTimeout } from './transfer';

const TOR_SOCKS = process.env.TOR_SOCKS_URL ?? 'socks5://127.0.0.1:9050';
const BATCH = 100;

type MintRef = { id: string; url: string; inputFeePpk: number | null; onionUrl: string | null };

const n = (a: Amount | number) => Amount.from(a).toNumber();
const toCashu = (p: { keysetId: string; amount: number; secret: string; C: string }) => ({ id: p.keysetId, amount: p.amount, secret: p.secret, C: p.C });

async function record(mintId: string, kind: string, ok: boolean, ms: number | null, detail: Record<string, unknown>) {
  await prisma.mintCheck.create({ data: { mintId, kind, ok, ms, detail: JSON.stringify(detail).slice(0, 2000) } });
}

export async function checkProofStates(mint: MintRef) {
  const proofs = await prisma.proof.findMany({ where: { mintId: mint.id, state: 'unspent' } });
  if (proofs.length === 0) return null;
  const started = Date.now();
  try {
    const wallet = createWallet(mint.url);
    await withTimeout(wallet.loadMint());
    let spent = 0, spentSat = 0, pending = 0;
    for (let i = 0; i < proofs.length; i += BATCH) {
      const chunk = proofs.slice(i, i + BATCH);
      const states = await withTimeout(wallet.checkProofsStates(chunk.map(p => ({ secret: p.secret }))));
      for (const [j, s] of states.entries()) {
        if (s.state === 'SPENT') {
          spent++;
          spentSat += chunk[j].amount;
          await prisma.proof.update({ where: { id: chunk[j].id }, data: { state: 'spent_external' } });
        } else if (s.state === 'PENDING') pending++;
      }
    }
    const detail = { checked: proofs.length, spent, spentSat, pending };
    await record(mint.id, 'proof_state', spent === 0, Date.now() - started, detail);
    return detail;
  } catch (error) {
    await record(mint.id, 'proof_state', false, Date.now() - started, { error: errorMessage(error) });
    return { error: errorMessage(error) };
  }
}

export async function swapTest(mint: MintRef) {
  const unspent = await prisma.proof.findMany({ where: { mintId: mint.id, state: 'unspent' }, orderBy: { amount: 'asc' } });
  if (unspent.length === 0) return null;

  const wallet = createWallet(mint.url);
  const started = Date.now();
  let selected = unspent;
  try {
    await withTimeout(wallet.loadMint());
    if ((mint.inputFeePpk ?? 0) > 0) {
      const one = unspent.find(p => p.amount > n(wallet.getFeesForProofs([toCashu(p)])));
      if (!one) return null;
      selected = [one];
    }
  } catch (error) {
    await record(mint.id, 'swap_test', false, Date.now() - started, { error: errorMessage(error) });
    return { error: errorMessage(error) };
  }

  const inputs = selected.map(toCashu);
  const total = inputs.reduce((s, p) => s + p.amount, 0);
  const fee = n(wallet.getFeesForProofs(inputs));
  if (total - fee < 1) return null;

  const tag = `check:${mint.id}:${started}`;
  const reserved = await prisma.proof.updateMany({
    where: { id: { in: selected.map(p => p.id) }, state: 'unspent' },
    data: { state: 'reserved', swapId: tag },
  });
  if (reserved.count !== selected.length) {
    await prisma.proof.updateMany({ where: { swapId: tag }, data: { state: 'unspent', swapId: null } });
    return null;
  }

  try {
    const preview = await withTimeout(wallet.prepareSwapToSend(total - fee, inputs, { includeFees: false }));
    const { keep, send } = await withTimeout(wallet.completeSwap(preview), 30_000);
    const outputs: CashuProof[] = [...keep, ...send];
    await prisma.$transaction([
      prisma.proof.deleteMany({ where: { swapId: tag } }),
      ...outputs.map(p =>
        prisma.proof.create({ data: { mintId: mint.id, keysetId: p.id, amount: n(p.amount), secret: p.secret, C: p.C } })
      ),
    ]);
    const detail = { inputs: inputs.length, outputs: outputs.length, amount: total, fee, dleq: dleqStatus(wallet, outputs) };
    await record(mint.id, 'swap_test', detail.dleq !== 'invalid', Date.now() - started, detail);
    return detail;
  } catch (error) {
    const message = errorMessage(error);
    let outcome = 'released';
    try {
      const states = await withTimeout(wallet.checkProofsStates(inputs.map(p => ({ secret: p.secret }))));
      if (states.some(s => s.state !== 'UNSPENT')) {
        await prisma.proof.deleteMany({ where: { swapId: tag } });
        const restored = await restoreProofs(mint);
        outcome = `inputs spent, restored ${restored.recovered} sat`;
      } else {
        await prisma.proof.updateMany({ where: { swapId: tag }, data: { state: 'unspent', swapId: null } });
      }
    } catch {
      outcome = 'unknown, proofs stay reserved';
    }
    await record(mint.id, 'swap_test', false, Date.now() - started, { error: message, outcome });
    return { error: message, outcome };
  }
}

let torAgent: Socks5ProxyAgent | null = null;

export async function torCheck(mint: MintRef) {
  if (!mint.onionUrl) return null;
  torAgent ??= new Socks5ProxyAgent(TOR_SOCKS);
  const started = Date.now();
  try {
    const res = await undiciFetch(`${mint.onionUrl}/v1/info`, {
      dispatcher: torAgent,
      signal: AbortSignal.timeout(45_000),
      redirect: 'error',
    });
    const body = (await res.json().catch(() => null)) as { nuts?: unknown; pubkey?: unknown } | null;
    const ok = res.ok && !!body && !!(body.nuts || body.pubkey);
    await record(mint.id, 'tor', ok, Date.now() - started, { status: res.status });
    return { ok, ms: Date.now() - started };
  } catch (error) {
    await record(mint.id, 'tor', false, Date.now() - started, { error: errorMessage(error) });
    return { ok: false, error: errorMessage(error) };
  }
}
