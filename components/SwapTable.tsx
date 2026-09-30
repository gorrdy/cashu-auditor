import Link from 'next/link';
import StateBadge from './StateBadge';
import { fmtDateTime, fmtMs, fmtSat, mintLabel } from './format';

type SwapRow = {
  id: string;
  kind: string;
  status: string;
  stage: string | null;
  amount: number;
  fee: number;
  duration: number;
  error: string | null;
  timestamp: Date;
  sourceMint: { id: string; name: string | null; url: string };
  destMint: { id: string; name: string | null; url: string };
};

const STAGE: Record<string, string> = {
  mint_quote: 'mint quote at destination',
  melt_quote: 'melt quote at source',
  melt: 'Lightning payment from source',
  mint: 'minting at destination',
  balance: 'balance check',
  reserve: 'proof reservation',
};

export default function SwapTable({ swaps, emptyText }: { swaps: SwapRow[]; emptyText: string }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Result</th>
            <th>From</th>
            <th>To</th>
            <th className="r">Amount</th>
            <th className="r c-md">Fee</th>
            <th className="r c-lg">Time</th>
            <th className="c-sm">When</th>
            <th className="c-lg">Detail</th>
          </tr>
        </thead>
        <tbody>
          {swaps.map(s => (
            <tr key={s.id}>
              <td><StateBadge kind={s.status as 'success' | 'failed' | 'pending'} title={s.error ?? undefined} /></td>
              <td className="cell-wrap"><Link href={`/mint/${s.sourceMint.id}`} prefetch={false}>{mintLabel(s.sourceMint)}</Link></td>
              <td className="cell-wrap"><Link href={`/mint/${s.destMint.id}`} prefetch={false}>{mintLabel(s.destMint)}</Link></td>
              <td className="r nowrap">{fmtSat(s.amount)}</td>
              <td className="r nowrap c-md">{s.status === 'success' ? fmtSat(s.fee) : '—'}</td>
              <td className="r nowrap c-lg">{s.status === 'pending' ? '—' : fmtMs(s.duration)}</td>
              <td className="nowrap soft c-sm">{fmtDateTime(s.timestamp)}</td>
              <td className="small soft cell-wrap c-lg">
                {s.kind === 'consolidate' && <span className="chip" style={{ marginRight: 6 }}>consolidation</span>}
                {s.status === 'success' ? '' : `${s.stage ? `At ${STAGE[s.stage] ?? s.stage}` : ''}${s.error ? `: ${s.error}` : ''}`}
              </td>
            </tr>
          ))}
          {swaps.length === 0 && (
            <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 32 }}>{emptyText}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
