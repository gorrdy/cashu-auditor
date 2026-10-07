export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cashu.info';
export const USER_AGENT = `cashu-audit/1.0 (+${SITE_URL}/methodology)`;
export const mintPage = (id: string) => `${SITE_URL}/mint/${id}`;
