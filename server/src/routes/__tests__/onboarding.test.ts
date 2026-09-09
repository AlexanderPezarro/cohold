import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../app.js';
import prisma from '../../db/client.js';
import authService from '../../services/auth.service.js';
import type { OnboardingStatus, OnboardingStepId } from '../../../../shared/onboarding/steps.js';

const app = createApp();

const adminUser = { email: 'onboarding-admin@example.com', password: 'adminPassword123' };
const landlordUser = { email: 'onboarding-landlord@example.com', password: 'landlordPassword123' };
const viewerUser = { email: 'onboarding-viewer@example.com', password: 'viewerPassword123' };

/** Pulls one step out of a status payload, failing loudly if it isn't there. */
function stepOf(status: OnboardingStatus, id: OnboardingStepId) {
  const step = status.steps.find((s) => s.id === id);
  if (!step) {
    throw new Error(`Step ${id} missing from status: ${status.steps.map((s) => s.id).join(', ')}`);
  }
  return step;
}

async function createProperty(name = 'Test Property') {
  return prisma.property.create({
    data: {
      name,
      street: '1 Test Street',
      city: 'Bristol',
      county: 'Avon',
      postcode: 'BS1 1AA',
      propertyType: 'House',
    },
  });
}

async function createTenant(email = 'tenant@example.com') {
  return prisma.tenant.create({
    data: {
      firstName: 'Test',
      lastName: 'Tenant',
      email,
      phone: '07700900000',
    },
  });
}

describe('Onboarding Routes', () => {
  let adminCookies: string[];
  let landlordCookies: string[];
  let adminUserId: string;

  const clearData = async () => {
    await prisma.lease.deleteMany({});
    await prisma.tenant.deleteMany({});
    await prisma.property.deleteMany({});
    await prisma.onboardingStepOverride.deleteMany({});
    await prisma.user.deleteMany({});
  };

  beforeAll(async () => {
    await clearData();
  });

  afterAll(async () => {
    await clearData();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await clearData();

    const admin = await authService.createUser(adminUser.email, adminUser.password, 'ADMIN');
    adminUserId = admin.id;

    const adminLogin = await request(app).post('/api/auth/login').send(adminUser);
    adminCookies = adminLogin.headers['set-cookie'] as unknown as string[];
  });

  /** Signs in a second, non-admin user. Not every test needs one. */
  const loginLandlord = async () => {
    await authService.createUser(landlordUser.email, landlordUser.password, 'LANDLORD');
    const login = await request(app).post('/api/auth/login').send(landlordUser);
    landlordCookies = login.headers['set-cookie'] as unknown as string[];
    return landlordCookies;
  };

  describe('GET /api/onboarding', () => {
    it('requires authentication', async () => {
      const response = await request(app).get('/api/onboarding');
      expect(response.status).toBe(401);
    });

    it('reports a brand new install as untouched and redirectable', async () => {
      const response = await request(app).get('/api/onboarding').set('Cookie', adminCookies);

      expect(response.status).toBe(200);
      const status: OnboardingStatus = response.body.onboarding;
      expect(status.isComplete).toBe(false);
      expect(status.completedCount).toBe(0);
      expect(status.dismissed).toBe(false);
      expect(status.shouldRedirect).toBe(true);
      expect(status.nextStepId).toBe('co-owners');
      expect(stepOf(status, 'property').status).toBe('todo');
    });

    it('derives completion from existing data', async () => {
      await createProperty();
      await createTenant();

      const response = await request(app).get('/api/onboarding').set('Cookie', adminCookies);

      const status: OnboardingStatus = response.body.onboarding;
      expect(stepOf(status, 'property').status).toBe('complete');
      expect(stepOf(status, 'property').detail).toBe('1 property');
      expect(stepOf(status, 'tenant').status).toBe('complete');
      // Data already exists, so we no longer drag the user into the flow.
      expect(status.shouldRedirect).toBe(false);
    });

    it('locks a step until its dependencies are met, then unlocks it', async () => {
      const before = await request(app).get('/api/onboarding').set('Cookie', adminCookies);
      expect(stepOf(before.body.onboarding, 'lease').status).toBe('locked');
      expect(stepOf(before.body.onboarding, 'lease').blockedBy).toEqual(['property', 'tenant']);

      await createProperty();
      await createTenant();

      const after = await request(app).get('/api/onboarding').set('Cookie', adminCookies);
      expect(stepOf(after.body.onboarding, 'lease').status).toBe('todo');
      expect(stepOf(after.body.onboarding, 'lease').blockedBy).toEqual([]);
    });

    it('counts a second user as co-owners being set up', async () => {
      await loginLandlord();

      const response = await request(app).get('/api/onboarding').set('Cookie', adminCookies);
      expect(stepOf(response.body.onboarding, 'co-owners').status).toBe('complete');
      expect(stepOf(response.body.onboarding, 'co-owners').detail).toBe('1 co-owner');
    });

    it('gives a read-only account nothing to do', async () => {
      await authService.createUser(viewerUser.email, viewerUser.password, 'VIEWER');
      const login = await request(app).post('/api/auth/login').send(viewerUser);
      const cookies = login.headers['set-cookie'] as unknown as string[];

      const response = await request(app).get('/api/onboarding').set('Cookie', cookies);
      const status: OnboardingStatus = response.body.onboarding;

      // Every step needs write access, so a VIEWER gets an empty - and
      // therefore already complete - checklist rather than one ending in a 403.
      expect(status.steps).toEqual([]);
      expect(status.isComplete).toBe(true);
      expect(status.shouldRedirect).toBe(false);
    });

    it('hides admin-only steps from non-admins', async () => {
      const cookies = await loginLandlord();

      const response = await request(app).get('/api/onboarding').set('Cookie', cookies);
      const ids = response.body.onboarding.steps.map((s: { id: string }) => s.id);

      expect(ids).not.toContain('co-owners');
      expect(ids).not.toContain('bank-account');
      expect(ids).toContain('property');
    });

    it('marks onboarding complete once every essential step is settled', async () => {
      const property = await createProperty();
      const tenant = await createTenant();
      await prisma.lease.create({
        data: {
          propertyId: property.id,
          tenantId: tenant.id,
          startDate: new Date('2026-01-01'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });
      // The only essential left for a solo landlord is inviting co-owners.
      await request(app)
        .post('/api/onboarding/steps/co-owners/skip')
        .set('Cookie', adminCookies);

      const response = await request(app).get('/api/onboarding').set('Cookie', adminCookies);
      const status: OnboardingStatus = response.body.onboarding;

      expect(status.isComplete).toBe(true);
      expect(status.completedCount).toBe(status.totalCount);
      expect(status.nextStepId).not.toBeNull(); // optional extras remain
      expect(stepOf(status, 'co-owners').status).toBe('skipped');
    });
  });

  describe('POST /api/onboarding/steps/:stepId/skip', () => {
    it('skips a step and returns the updated status', async () => {
      const response = await request(app)
        .post('/api/onboarding/steps/tenant/skip')
        .set('Cookie', adminCookies);

      expect(response.status).toBe(200);
      expect(stepOf(response.body.onboarding, 'tenant').status).toBe('skipped');
    });

    it('refuses to skip a step the registry marks unskippable', async () => {
      const response = await request(app)
        .post('/api/onboarding/steps/property/skip')
        .set('Cookie', adminCookies);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('404s on an unknown step', async () => {
      const response = await request(app)
        .post('/api/onboarding/steps/not-a-step/skip')
        .set('Cookie', adminCookies);

      expect(response.status).toBe(404);
    });

    it('shows a skipped step as complete once the data turns up anyway', async () => {
      await request(app).post('/api/onboarding/steps/tenant/skip').set('Cookie', adminCookies);
      await createTenant();

      const response = await request(app).get('/api/onboarding').set('Cookie', adminCookies);
      expect(stepOf(response.body.onboarding, 'tenant').status).toBe('complete');
    });

    it('keeps skips per user', async () => {
      const cookies = await loginLandlord();
      await request(app).post('/api/onboarding/steps/tenant/skip').set('Cookie', adminCookies);

      const landlordStatus = await request(app).get('/api/onboarding').set('Cookie', cookies);
      expect(stepOf(landlordStatus.body.onboarding, 'tenant').status).toBe('todo');
    });
  });

  describe('DELETE /api/onboarding/steps/:stepId/skip', () => {
    it('404s on an unknown step', async () => {
      const response = await request(app)
        .delete('/api/onboarding/steps/not-a-step/skip')
        .set('Cookie', adminCookies);

      expect(response.status).toBe(404);
    });

    it('is a no-op for a step that was never skipped', async () => {
      const response = await request(app)
        .delete('/api/onboarding/steps/tenant/skip')
        .set('Cookie', adminCookies);

      expect(response.status).toBe(200);
      expect(stepOf(response.body.onboarding, 'tenant').status).toBe('todo');
    });

    it('restores a skipped step', async () => {
      await request(app).post('/api/onboarding/steps/tenant/skip').set('Cookie', adminCookies);

      const response = await request(app)
        .delete('/api/onboarding/steps/tenant/skip')
        .set('Cookie', adminCookies);

      expect(response.status).toBe(200);
      expect(stepOf(response.body.onboarding, 'tenant').status).toBe('todo');
    });
  });

  describe('POST /api/onboarding/steps/:stepId/complete', () => {
    it('404s on an unknown step', async () => {
      const response = await request(app)
        .post('/api/onboarding/steps/not-a-step/complete')
        .set('Cookie', adminCookies);

      expect(response.status).toBe(404);
    });

    it('refuses to tick off a step whose completion comes from data', async () => {
      const response = await request(app)
        .post('/api/onboarding/steps/property/complete')
        .set('Cookie', adminCookies);

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/completed by doing it/i);
    });
  });

  describe('POST /api/onboarding/dismiss and /restart', () => {
    it('dismisses the checklist and stops redirecting', async () => {
      const response = await request(app)
        .post('/api/onboarding/dismiss')
        .set('Cookie', adminCookies);

      expect(response.status).toBe(200);
      expect(response.body.onboarding.dismissed).toBe(true);
      expect(response.body.onboarding.shouldRedirect).toBe(false);

      const stored = await prisma.user.findUnique({
        where: { id: adminUserId },
        select: { onboardingDismissedAt: true },
      });
      expect(stored?.onboardingDismissedAt).not.toBeNull();
    });

    it('restart clears dismissal and every skip', async () => {
      await request(app).post('/api/onboarding/steps/tenant/skip').set('Cookie', adminCookies);
      await request(app).post('/api/onboarding/dismiss').set('Cookie', adminCookies);

      const response = await request(app)
        .post('/api/onboarding/restart')
        .set('Cookie', adminCookies);

      expect(response.status).toBe(200);
      expect(response.body.onboarding.dismissed).toBe(false);
      expect(stepOf(response.body.onboarding, 'tenant').status).toBe('todo');
      expect(await prisma.onboardingStepOverride.count({ where: { userId: adminUserId } })).toBe(0);
    });
  });
});
