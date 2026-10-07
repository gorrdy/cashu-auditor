'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { logout } from '@/app/operators/actions';
import { ACCOUNT_LINKS, type Profile } from './AccountMenu';

const LINKS = [
  { href: '/', label: 'Mints' },
  { href: '/#swaps', label: 'Swaps' },
  { href: '/compare', label: 'Compare' },
  { href: '/infrastructure', label: 'Infrastructure' },
  { href: '/methodology', label: 'Methodology' },
];

export default function MobileMenu({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [open]);

  return (
    <div className="mobile-menu" ref={box}>
      <button type="button" className="menu-toggle" aria-expanded={open} aria-controls="mobile-menu-panel" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(o => !o)}>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          {open ? (
            <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          ) : (
            <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          )}
        </svg>
      </button>
      {open && (
        <nav id="mobile-menu-panel" className="menu-panel" aria-label="Menu">
          {LINKS.map(l => (
            <Link key={l.href} href={l.href} aria-current={pathname === l.href ? 'page' : undefined} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          <span className="menu-sep" aria-hidden="true" />
          {profile ? (
            <>
              <div className="account-head">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={profile.avatar} alt="" width={36} height={36} />
                <div>
                  <strong>{profile.name}</strong>
                  {profile.name !== profile.identity && <span className="small muted">{profile.identity}</span>}
                </div>
              </div>
              {ACCOUNT_LINKS.map(l => <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</Link>)}
              <button type="button" className="menu-item" onClick={async () => { setOpen(false); await logout(); router.refresh(); }}>Log out</button>
            </>
          ) : (
            <Link href="/operators" onClick={() => setOpen(false)}>Log in</Link>
          )}
        </nav>
      )}
    </div>
  );
}
