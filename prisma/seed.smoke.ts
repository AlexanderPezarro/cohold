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

  // The smoke user is not a new landlord being onboarded: mark the setup flow
  // dismissed so the onboarding redirect never intercepts the smoke run's
  // landing on /dashboard.
  await prisma.user.upsert({
    where: { email },
    update: { password, onboardingDismissedAt: new Date() },
    create: { email, password, role: 'ADMIN', onboardingDismissedAt: new Date() },
  });

  console.log(`✓ Smoke test user upserted: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
