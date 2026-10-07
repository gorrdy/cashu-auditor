'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { logout } from '@/app/operators/actions';

export default function AccountMenu({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  if (!signedIn) return <Link href="/operators" className="nav-account">Sign in</Link>;
  return (
    <details className="filter-menu account-menu">
      <summary className="nav-account">Account</summary>
      <div className="filter-list">
        <Link href="/operators">Your mints &amp; alerts</Link>
        <button type="button" className="menu-item" onClick={async () => { await logout(); router.refresh(); }}>Sign out</button>
      </div>
    </details>
  );
}
