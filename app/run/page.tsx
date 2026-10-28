import type { Metadata } from 'next';
import Link from 'next/link';
import RunStart from '@/components/RunStart';
import { RUN_MAX, RUN_MIN, RUN_STATUS, recentRuns } from '@/lib/mintrun';
import { fmtDateTime, fmtSat } from '@/components/format';

export const metadata: Metadata = {
  title: 'Mint run: push real sats through every recommended Cashu mint',
  description: 'Fund a mint run and watch 10,000 sat or more move over Lightning through every recommended Cashu mint in a row, like a bank run. Every hop is public.',
  alternates: { canonical: '/run' },
};

export const dynamic = 'force-dynamic';

export default async function RunPage() {
  const runs = await recentRuns(15);
  return (
    <>
      <section className="run-hero">
        <div>
          <p className="eyebrow">Mint run</p>
          <h1 className="h1" style={{ marginTop: 8 }}>A bank run on the recommended mints</h1>
          <p className="soft" style={{ maxWidth: 640 }}>
            Daily swaps move a few sats. A mint run moves a real amount. You pay {fmtSat(RUN_MIN)} or more over Lightning or as Cashu ecash, and the auditor
            sends the whole sum over Lightning from mint to mint through every recommended mint in turn: each one has to issue the
            ecash and then pay it all out again. The run ends back at the home mint, and what is left after fees goes back to your
            Lightning address or to the audit.
          </p>
          <ul className="soft small run-points">
            <li>One run at a time, one hop roughly every few seconds. A run of 20 mints usually takes 10 to 30 minutes.</li>
            <li>A mint that cannot take or pay the amount is skipped and the failure is shown. After three failures in a row the run goes straight home.</li>
            <li>Each hop costs its Lightning fee reserve, usually under 1 %. The run carries on with exactly what arrived.</li>
            <li>Every hop is public on the run page. Your Lightning address is not.</li>
          </ul>
        </div>
        <RunStart min={RUN_MIN} max={RUN_MAX} />
      </section>

      <section className="section">
        <div className="section-head"><h2 className="h2">Recent runs</h2></div>
        {runs.length === 0 ? (
          <p className="soft">No runs yet. Be the first.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Started</th><th>Status</th><th className="r">Amount</th><th className="r c-sm">Left</th><th className="r c-md">Progress</th></tr></thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id}>
                    <td><Link href={`/run/${r.id}`}>{fmtDateTime(r.startedAt ?? r.createdAt)}</Link></td>
                    <td>{RUN_STATUS[r.status] ?? r.status}</td>
                    <td className="r nowrap">{fmtSat(r.amount)}</td>
                    <td className="r nowrap c-sm">{fmtSat(r.value)}</td>
                    <td className="r c-md">{Math.min(r.position, (JSON.parse(r.route) as string[]).length)} / {(JSON.parse(r.route) as string[]).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ marginTop: 8 }}>
          Runs do not change mint scores. They are shown on each mint&apos;s page as large payment tests. See the <Link href="/methodology#mint-run">methodology</Link>.
        </p>
      </section>
    </>
  );
}
