// Single shared PrismaClient.
//
// Every controller used to construct its own, which meant one connection pool
// per module — and a process that never exits, because each client holds open
// handles. Tests in particular need exactly one client they can disconnect.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn', 'error']
});

export default prisma;
export { prisma };
