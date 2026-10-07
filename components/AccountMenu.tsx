'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { logout } from '@/app/operators/actions';

export type Profile = { name: string; identity: string; avatar: string } | null;

export const ACCOUNT_LINKS = [
  { href: '/operators#mints', label: 'My mints' },
  { href: '/operators#alerts', label: 'Alerts' },
  { href: '/operators/profile', label: 'Profile' },
];

export default function AccountMenu({ profile }: { profile: Profile }) {
  const router = useRouter();
  if (!profile) return <Link href="/operators" className="nav-account">Log in</Link>;
  return (
    <details className="filter-menu account-menu">
      <summary className="avatar-button" aria-label={`Account: ${profile.name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={profile.avatar} alt="" width={36} height={36} />
      </summary>
      <div className="filter-list account-list">
        <div className="account-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={profile.avatar} alt="" width={40} height={40} />
          <div>
            <strong>{profile.name}</strong>
            {profile.name !== profile.identity && <span className="small muted">{profile.identity}</span>}
          </div>
        </div>
        {ACCOUNT_LINKS.map(l => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        <button type="button" className="menu-item account-logout" onClick={async () => { await logout(); router.refresh(); }}>Log out</button>
      </div>
    </details>
  );
}
