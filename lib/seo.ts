import { SITE_URL } from './site';

export const SITE_NAME = 'Cashu Mints Auditor';

export const ORGANIZATION = {
  '@type': 'Organization',
  '@id': `${SITE_URL}/#org`,
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/icon-512.png`,
  sameAs: ['https://github.com/gorrdy/cashu-auditor'],
};

export const breadcrumbs = (items: { name: string; path: string }[]) => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: `${SITE_URL}${it.path}` })),
});

export const graph = (...nodes: object[]) => ({ '@context': 'https://schema.org', '@graph': nodes });
