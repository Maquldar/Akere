import { PrismaClient } from '@prisma/client';
import { seedOrg } from './org';

const prisma = new PrismaClient();

/** Seeders run in order; each receives the context produced by the previous ones. Later phases append here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Seeder = (prisma: PrismaClient, ctx: any) => Promise<object>;
const seeders: Seeder[] = [seedOrg];

async function truncateAll() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_FORCE !== 'true') {
    throw new Error('Refusing to seed a production database (set SEED_FORCE=true to override).');
  }
  await truncateAll();
  let ctx: Record<string, unknown> = {};
  for (const seed of seeders) {
    const started = Date.now();
    ctx = { ...ctx, ...(await seed(prisma, ctx)) };
    console.log(`✔ ${seed.name} (${Date.now() - started} ms)`);
  }
  console.log('Seed complete. Demo password for all accounts: Akere2026demo');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
