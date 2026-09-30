import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from './generated/prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

function createClient() {
  const url = (process.env.DATABASE_URL ?? 'file:./prisma/dev.db').replace(/^file:/, '');
  const adapter = new PrismaBetterSqlite3({ url }, { timestampFormat: 'unixepoch-ms' });
  return new PrismaClient({ adapter, log: ['warn', 'error'] });
}

export const prisma = globalForPrisma.prisma || createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
