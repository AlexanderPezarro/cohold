import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import prisma from '../../db/client.js';
import authService from '../../services/auth.service.js';
import { seedAdmin } from '../seed-admin.js';

describe('seed-admin', () => {
  const originalOwnerEmail = process.env.OWNER_EMAIL;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;

  beforeAll(async () => {
    await prisma.user.deleteMany({});
  });

  afterAll(async () => {
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({});
  });

  afterEach(() => {
    process.env.OWNER_EMAIL = originalOwnerEmail;
    process.env.ADMIN_PASSWORD = originalAdminPassword;
    jest.restoreAllMocks();
  });

  it('is a no-op when OWNER_EMAIL is missing', async () => {
    delete process.env.OWNER_EMAIL;
    process.env.ADMIN_PASSWORD = 'somePassword123';

    await seedAdmin();

    expect(await prisma.user.count()).toBe(0);
  });

  it('is a no-op when ADMIN_PASSWORD is missing', async () => {
    process.env.OWNER_EMAIL = 'owner@example.com';
    delete process.env.ADMIN_PASSWORD;

    await seedAdmin();

    expect(await prisma.user.count()).toBe(0);
  });

  it('creates an ADMIN user when both env vars are set and setup is required', async () => {
    process.env.OWNER_EMAIL = 'owner@example.com';
    process.env.ADMIN_PASSWORD = 'somePassword123';

    await seedAdmin();

    const user = await prisma.user.findUnique({ where: { email: 'owner@example.com' } });
    expect(user).not.toBeNull();
    expect(user?.role).toBe('ADMIN');
    expect(user?.email).toBe('owner@example.com');
  });

  it('is a no-op when setup has already been completed', async () => {
    await authService.createUser('existing@example.com', 'existingPassword123');

    process.env.OWNER_EMAIL = 'owner@example.com';
    process.env.ADMIN_PASSWORD = 'somePassword123';

    await seedAdmin();

    const seededUser = await prisma.user.findUnique({ where: { email: 'owner@example.com' } });
    expect(seededUser).toBeNull();
    expect(await prisma.user.count()).toBe(1);
  });

  it('handles a P2002 race without throwing', async () => {
    process.env.OWNER_EMAIL = 'owner@example.com';
    process.env.ADMIN_PASSWORD = 'somePassword123';

    // Simulate another process winning the race and creating the user first.
    await prisma.user.create({
      data: {
        email: 'owner@example.com',
        password: 'irrelevant-hash',
        role: 'ADMIN',
      },
    });

    jest.spyOn(authService, 'isSetupRequired').mockResolvedValueOnce(true);

    await expect(seedAdmin()).resolves.toBeUndefined();
    expect(await prisma.user.count()).toBe(1);
  });
});
