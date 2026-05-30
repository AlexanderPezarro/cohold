import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import bcrypt from 'bcrypt';
import 'dotenv/config';

const databaseUrl = process.env.DATABASE_URL || 'file:./data/landlord.db';
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = 'smoke@cohold.app';
  const rawPassword = process.env.SMOKE_TEST_PASSWORD;

  if (!rawPassword) {
    console.error('SMOKE_TEST_PASSWORD env var is required');
    process.exit(1);
  }

  const password = await bcrypt.hash(rawPassword, 10);

  await prisma.user.upsert({
    where: { email },
    update: { password },
    create: { email, password, role: 'ADMIN' },
  });

  console.log(`✓ Smoke test user upserted: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
