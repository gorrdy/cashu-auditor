'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { logout } from '@/app/operators/actions';

const LINKS = [
  { href: '/', label: 'Mints' },
  { href: '/#swaps', label: 'Swaps' },
  { href: '/compare', label: 'Compare' },
  { href: '/infrastructure', label: 'Infrastructure' },
  { href: '/methodology', label: 'Methodology' },
  { href: '/operators', label: 'For operators' },
];

export default function MobileMenu({ signedIn }: { signedIn: boolean }) {
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
          <Link href="/operators" onClick={() => setOpen(false)}>{signedIn ? 'Your account' : 'Sign in'}</Link>
          {signedIn && (
            <button type="button" className="menu-item" onClick={async () => { setOpen(false); await logout(); router.refresh(); }}>Sign out</button>
          )}
        </nav>
      )}
    </div>
  );
}
