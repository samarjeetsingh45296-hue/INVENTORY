/**
 * Copies every record into MongoDB, one collection per entity - by hand,
 * whenever wanted. The API does the same by itself every night.
 *
 *   pnpm --filter @inventory/api mirror:mongo                       (local MongoDB)
 *   pnpm --filter @inventory/api mirror:mongo -- --uri "mongodb+srv://..."   (Atlas)
 *
 * What is written and why is described in src/modules/backup/mongo-mirror.ts.
 */
import './load-env';
import { PrismaClient } from '@prisma/client';
import { mirrorToMongo } from '../src/modules/backup/mongo-mirror';

const prisma = new PrismaClient();

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

mirrorToMongo(prisma, { uri: arg('uri'), db: arg('db'), log: (l) => console.log(l) })
  .then((r) => { if (r.mismatches.length) process.exitCode = 1; })
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
