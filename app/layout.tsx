import type { Metadata } from 'next';
import { connection } from 'next/server';
import Link from 'next/link';
import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import Mark from '@/components/Mark';
import HoverTip from '@/components/HoverTip';
import LiveStatus from '@/components/LiveStatus';
import MobileMenu from '@/components/MobileMenu';
import MenuCloser from '@/components/MenuCloser';
import AccountMenu from '@/components/AccountMenu';
import UpdateBanner from '@/components/UpdateBanner';
import { buildVersion } from '@/lib/version';
import { currentOperator } from '@/lib/operator/session';
import { profileOf } from '@/lib/operator/avatar';
import DonateDialog, { DonateButton } from '@/components/Donate';
import { cashuRequestWithQr } from '@/lib/donate';
import './globals.css';
import { SITE_URL } from '@/lib/site';
import JsonLd from '@/components/JsonLd';
import { ORGANIZATION, SITE_NAME, graph } from '@/lib/seo';

const jakarta = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800'],
});

const jetbrains = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500'],
});

const DEV = process.env.APP_ENV === 'dev';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: DEV ? { default: '[dev] Cashu Mints Auditor', template: '[dev] %s · Cashu Mints Auditor' } : { default: 'Cashu Mints Auditor: live Cashu mint list and reliability', template: '%s · Cashu Mints Auditor' },
  applicationName: SITE_NAME,
  keywords: ['Cashu', 'Cashu mint', 'Cashu mints list', 'ecash', 'Chaumian ecash', 'Bitcoin', 'Lightning Network', 'Nutshell', 'CDK', 'mint uptime', 'Bitcoin privacy'],
  alternates: { types: { 'text/plain': '/llms.txt' } },
  openGraph: { siteName: SITE_NAME, type: 'website', locale: 'en_US' },
  twitter: { card: 'summary_large_image' },
  ...(DEV ? { robots: { index: false, follow: false } } : {}),
  manifest: '/manifest.webmanifest',
  description: 'Find a reliable Cashu mint. Live list of Cashu ecash mints for Bitcoin with uptime, latency and real Lightning payouts tested every day.',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const cashu = await cashuRequestWithQr();
  const operator = await currentOperator();
  const profile = operator ? profileOf(operator) : null;
  return (
    <html lang="en" data-env={DEV ? 'dev' : undefined} className={`${jakarta.variable} ${jetbrains.variable}`}>
      <body>
        <JsonLd data={graph(ORGANIZATION, {
          '@type': 'WebSite',
          '@id': `${SITE_URL}/#website`,
          name: SITE_NAME,
          url: SITE_URL,
          description: 'Live, independent reliability data for public Cashu ecash mints.',
          publisher: { '@id': `${SITE_URL}/#org` },
          potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
        })} />
        <UpdateBanner version={buildVersion()} />
        <header className="site-header">
          <div className="wrap">
            <Link href="/" className="wordmark" aria-label="Cashu Mints Auditor home">
              <Mark />
              <span>Cashu Mints <b>Auditor</b></span>
              {DEV && <span className="env-badge">DEV</span>}
            </Link>
            <nav className="nav" aria-label="Main" style={{ alignItems: 'center' }}>
              <LiveStatus />
              <Link href="/" className="nav-optional">Mints</Link>
              <Link href="/#swaps" className="nav-optional nav-wide">Swaps</Link>
              <Link href="/compare" className="nav-optional nav-wide">Compare</Link>
              <Link href="/infrastructure" className="nav-optional nav-wide">Infrastructure</Link>
              <Link href="/run" className="nav-optional nav-wide">Mint run</Link>
              <Link href="/learn" className="nav-optional nav-wide">Learn</Link>
              <Link href="/methodology" className="nav-optional">Methodology</Link>
              <span className="nav-optional"><AccountMenu profile={profile} /></span>
              <DonateButton className="btn nav-donate">Donate</DonateButton>
              <MobileMenu profile={profile} />
            </nav>
          </div>
        </header>
        <main className="wrap" style={{ paddingTop: 32 }}>{children}</main>
        <footer className="site-footer">
          <div className="wrap">
            <span>Cashu Mints Auditor · independent proof that Cashu mints pay</span>
            <nav className="footer-nav" aria-label="Footer">
              <Link href="/">Mints</Link>
              <Link href="/compare">Compare</Link>
              <Link href="/infrastructure">Infrastructure</Link>
              <Link href="/run">Mint run</Link>
              <Link href="/learn">What is Cashu</Link>
              <Link href="/methodology">Methodology</Link>
              <Link href="/operators">For operators</Link>
              <a href="/llms.txt">For AI agents</a>
              <a href="https://github.com/gorrdy/cashu-auditor">Source</a>
            </nav>
            <span>Checks run from Prague, CZ · times in Europe/Prague</span>
          </div>
        </footer>
        <HoverTip />
        <MenuCloser />
        <DonateDialog cashuRequest={cashu.request} cashuQr={cashu.qr} />
      </body>
    </html>
  );
}
