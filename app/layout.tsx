import type { Metadata } from 'next';
import { connection } from 'next/server';
import Link from 'next/link';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import Mark from '@/components/Mark';
import HoverTip from '@/components/HoverTip';
import LiveStatus from '@/components/LiveStatus';
import DonateDialog, { DonateButton } from '@/components/Donate';
import { cashuRequestWithQr } from '@/lib/donate';
import './globals.css';
import { SITE_URL } from '@/lib/site';

const plexSans = IBM_Plex_Sans({
  variable: '--font-plex-sans',
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600'],
});

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Cashu Audit', template: '%s · Cashu Audit' },
  description: 'Independent proof that Cashu mints pay. Uptime, latency and real Lightning swaps between public Cashu mints.',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const cashu = await cashuRequestWithQr();
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <header className="site-header">
          <div className="wrap">
            <Link href="/" className="wordmark" aria-label="Cashu Audit home">
              <Mark />
              <span>cashu <b>audit</b></span>
            </Link>
            <nav className="nav" aria-label="Main" style={{ alignItems: 'center' }}>
              <LiveStatus />
              <Link href="/">Mints</Link>
              <Link href="/#swaps" className="nav-optional">Swaps</Link>
              <Link href="/compare" className="nav-optional">Compare</Link>
              <Link href="/methodology">Methodology</Link>
              <DonateButton className="btn nav-donate">Donate</DonateButton>
            </nav>
          </div>
        </header>
        <main className="wrap" style={{ paddingTop: 32 }}>{children}</main>
        <footer className="site-footer">
          <div className="wrap">
            <span>Cashu Audit · independent proof that Cashu mints pay</span>
            <span>Checks run from Prague, CZ · times in Europe/Prague</span>
          </div>
        </footer>
        <HoverTip />
        <DonateDialog cashuRequest={cashu.request} cashuQr={cashu.qr} />
      </body>
    </html>
  );
}
