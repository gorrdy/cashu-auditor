import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentOperator } from '@/lib/operator/session';
import { profileOf } from '@/lib/operator/avatar';
import { fmtDate } from '@/components/format';
import Profile from '@/components/operator/Profile';

export const metadata: Metadata = { title: 'Profile' };

export default async function ProfilePage() {
  const operator = await currentOperator();
  if (!operator) redirect('/operators');
  const p = profileOf(operator);
  const method = operator.pubkey ? 'Nostr' : operator.lnKey ? 'Lightning wallet (LNURL-auth)' : 'Email';
  return (
    <>
      <p className="eyebrow">Account</p>
      <h1 className="h1" style={{ marginTop: 8 }}>Profile</h1>
      <section className="section">
        <Profile name={p.name} identity={p.identity} avatar={p.avatar} method={method} since={fmtDate(operator.createdAt)} />
      </section>
    </>
  );
}
