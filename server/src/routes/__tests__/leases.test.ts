import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../app.js';
import prisma from '../../db/client.js';
import authService from '../../services/auth.service.js';
import { Roles } from '../../../../shared/types/user.types.js';

const app = createApp();

// Status is now computed from dates, not stored - fixtures must use dates relative to
// "now" (not literal past calendar dates) so a lease intended to read as Active/Upcoming
// actually does, regardless of when the test suite runs.
function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
}

describe('Leases Routes', () => {
  // Test user credentials
  const testUser = {
    email: 'test@example.com',
    password: 'testPassword123',
  };

  const viewerUser = {
    email: 'viewer@example.com',
    password: 'viewerPassword123',
  };

  const landlordUser = {
    email: 'landlord@example.com',
    password: 'landlordPassword123',
  };

  const adminUser = {
    email: 'admin@example.com',
    password: 'adminPassword123',
  };

  let authCookies: string[];
  let viewerCookies: string[];
  let landlordCookies: string[];
  let adminCookies: string[];
  let testProperty: any;
  let testTenant: any;

  // Ids of the seeded users, needed to grant PropertyOwnership. Leases are now
  // scoped by ownership of their property, so any property created directly via
  // `prisma.property.create` (bypassing the POST /api/properties route, which
  // grants ownership itself) needs an explicit PropertyOwnership row - see
  // `createProperty` below.
  let testUserId: string;
  let landlordUserId: string;

  // Valid lease data
  const validLease = {
    propertyId: '', // Will be set in beforeAll
    tenantId: '', // Will be set in beforeAll
    startDate: daysFromNow(-30),
    endDate: daysFromNow(300),
    monthlyRent: 1200,
    securityDepositAmount: 1200,
    securityDepositPaidDate: daysFromNow(-35),
  };

  // Creates a property directly (bypassing the POST route) and grants the given
  // user 100% ownership of it, so leases on it are visible to them under REST
  // ownership scoping. Defaults to `testUser` (authCookies), since that's what
  // almost every test in this file uses.
  async function createProperty(args: { data: any }, ownerId: string = testUserId) {
    const property = await prisma.property.create(args);
    await prisma.propertyOwnership.create({
      data: { userId: ownerId, propertyId: property.id, ownershipPercentage: 100 },
    });
    return property;
  }

  beforeAll(async () => {
    // Clean database
    await prisma.lease.deleteMany({});
    await prisma.tenant.deleteMany({});
    await prisma.property.deleteMany({});
    await prisma.user.deleteMany({});

    // Create test user and login (default LANDLORD role)
    const testUserRecord = await authService.createUser(testUser.email, testUser.password);
    testUserId = testUserRecord.id;

    const loginResponse = await request(app).post('/api/auth/login').send({
      email: testUser.email,
      password: testUser.password,
    });

    authCookies = [loginResponse.headers['set-cookie']];

    // Create viewer user and login
    await authService.createUser(viewerUser.email, viewerUser.password, Roles.VIEWER);

    const viewerLoginResponse = await request(app).post('/api/auth/login').send({
      email: viewerUser.email,
      password: viewerUser.password,
    });

    viewerCookies = [viewerLoginResponse.headers['set-cookie']];

    // Create landlord user and login
    const landlordUserRecord = await authService.createUser(landlordUser.email, landlordUser.password, Roles.LANDLORD);
    landlordUserId = landlordUserRecord.id;

    const landlordLoginResponse = await request(app).post('/api/auth/login').send({
      email: landlordUser.email,
      password: landlordUser.password,
    });

    landlordCookies = [landlordLoginResponse.headers['set-cookie']];

    // Create admin user and login
    await authService.createUser(adminUser.email, adminUser.password, Roles.ADMIN);

    const adminLoginResponse = await request(app).post('/api/auth/login').send({
      email: adminUser.email,
      password: adminUser.password,
    });

    adminCookies = [adminLoginResponse.headers['set-cookie']];

    // Create test property, co-owned by both testUser and landlordUser (this file
    // reuses `testProperty` across POST/PUT/DELETE role-permission tests that act
    // as either user, and those are about role, not ownership).
    testProperty = await prisma.property.create({
      data: {
        name: 'Test Property',
        street: '123 Test Street',
        city: 'London',
        county: 'Greater London',
        postcode: 'SW1A 1AA',
        propertyType: 'Flat',
      },
    });
    await prisma.propertyOwnership.create({
      data: { userId: testUserId, propertyId: testProperty.id, ownershipPercentage: 50 },
    });
    await prisma.propertyOwnership.create({
      data: { userId: landlordUserId, propertyId: testProperty.id, ownershipPercentage: 50 },
    });

    // Create test tenant
    testTenant = await prisma.tenant.create({
      data: {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        phone: '07700900123',
      },
    });

    // Update validLease with actual IDs
    validLease.propertyId = testProperty.id;
    validLease.tenantId = testTenant.id;
  });

  afterAll(async () => {
    // Clean up after all tests
    await prisma.lease.deleteMany({});
    await prisma.tenant.deleteMany({});
    await prisma.property.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean leases before each test
    await prisma.lease.deleteMany({});
  });

  describe('POST /api/leases', () => {
    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/leases')
        .send(validLease);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Authentication required');
    });

    it('should block VIEWER role from creating leases', async () => {
      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', viewerCookies)
        .send(validLease);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Insufficient permissions');
    });

    it('should allow LANDLORD role to create leases', async () => {
      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', landlordCookies)
        .send(validLease);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.lease).toMatchObject({
        propertyId: validLease.propertyId,
        tenantId: validLease.tenantId,
        monthlyRent: validLease.monthlyRent,
      });
    });

    it('should allow ADMIN role to create leases', async () => {
      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', adminCookies)
        .send(validLease);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.lease).toMatchObject({
        propertyId: validLease.propertyId,
        tenantId: validLease.tenantId,
        monthlyRent: validLease.monthlyRent,
      });
    });

    it('should create a lease with valid data', async () => {
      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', authCookies)
        .send(validLease);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.lease).toMatchObject({
        propertyId: validLease.propertyId,
        tenantId: validLease.tenantId,
        monthlyRent: validLease.monthlyRent,
        securityDepositAmount: validLease.securityDepositAmount,
        status: 'Active',
      });
      expect(response.body.lease.id).toBeDefined();
      expect(response.body.lease.createdAt).toBeDefined();
      expect(response.body.lease.updatedAt).toBeDefined();
    });

    it('should reject lease with non-existent property', async () => {
      const invalidLease = {
        ...validLease,
        propertyId: '00000000-0000-0000-0000-000000000000',
      };

      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', authCookies)
        .send(invalidLease);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Property not found');
    });

    it('should reject lease when property is listed "For Sale"', async () => {
      const forSaleProperty = await createProperty({
        data: {
          name: 'For Sale Property',
          street: '456 Test Street',
          city: 'London',
          county: 'Greater London',
          postcode: 'SW1A 2BB',
          propertyType: 'House',
          listingState: 'FOR_SALE',
        },
      });

      const invalidLease = {
        ...validLease,
        propertyId: forSaleProperty.id,
      };

      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', authCookies)
        .send(invalidLease);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Property is not available');

      await prisma.property.delete({ where: { id: forSaleProperty.id } });
    });

    it('should reject lease with non-existent tenant', async () => {
      const invalidLease = {
        ...validLease,
        tenantId: '00000000-0000-0000-0000-000000000000',
      };

      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', authCookies)
        .send(invalidLease);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Tenant not found');
    });

    it('should allow creating a lease for a Former tenant (they become Active again)', async () => {
      const formerTenant = await prisma.tenant.create({
        data: {
          firstName: 'Former',
          lastName: 'Tenant',
          email: 'former@example.com',
          phone: '07700900999',
        },
      });

      // Give them a fully-past lease so they currently read as Former.
      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: formerTenant.id,
          startDate: daysFromNow(-400),
          endDate: daysFromNow(-40),
          monthlyRent: 900,
          securityDepositAmount: 900,
        },
      });

      const formerCheck = await request(app)
        .get(`/api/tenants/${formerTenant.id}`)
        .set('Cookie', authCookies);
      expect(formerCheck.body.tenant.status).toBe('Former');

      const newLease = { ...validLease, tenantId: formerTenant.id };

      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', authCookies)
        .send(newLease);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      const activeCheck = await request(app)
        .get(`/api/tenants/${formerTenant.id}`)
        .set('Cookie', authCookies);
      expect(activeCheck.body.tenant.status).toBe('Active');

      await prisma.tenant.delete({ where: { id: formerTenant.id } });
    });

    it('should reject lease without required propertyId', async () => {
      const invalidLease = { ...validLease };
      delete (invalidLease as any).propertyId;

      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', authCookies)
        .send(invalidLease);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it('should reject lease without required tenantId', async () => {
      const invalidLease = { ...validLease };
      delete (invalidLease as any).tenantId;

      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', authCookies)
        .send(invalidLease);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it('should reject lease with startDate after endDate', async () => {
      const invalidLease = {
        ...validLease,
        startDate: new Date('2024-12-31'),
        endDate: new Date('2024-01-01'),
      };

      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', authCookies)
        .send(invalidLease);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Start date must be before or equal to end date');
    });

    it('should reject lease with negative monthlyRent', async () => {
      const invalidLease = { ...validLease, monthlyRent: -1000 };

      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', authCookies)
        .send(invalidLease);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('positive');
    });

    it('should prevent overlapping current leases for same property', async () => {
      // Create first active lease
      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      // Try to create overlapping active lease
      const overlappingLease = {
        ...validLease,
        startDate: daysFromNow(100),
        endDate: daysFromNow(500),
      };

      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', authCookies)
        .send(overlappingLease);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Cannot create lease: overlapping active lease exists for this property');
    });

    it('should allow a fully-past (Ended) lease even if an Active lease exists on same property', async () => {
      // Create active lease
      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      // Create an overlapping-by-date-range but fully past (Ended) lease - should succeed,
      // since only Upcoming/Active leases are checked for overlap.
      const endedLease = {
        ...validLease,
        startDate: daysFromNow(-400),
        endDate: daysFromNow(-40),
      };

      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', authCookies)
        .send(endedLease);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.lease.status).toBe('Ended');
    });

    it('should prevent overlapping when the conflicting lease is Upcoming (not yet started)', async () => {
      // Create an upcoming lease (not started yet)
      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(50),
          endDate: daysFromNow(400),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      // Try to create another lease overlapping the upcoming one
      const overlappingLease = {
        ...validLease,
        startDate: daysFromNow(100),
        endDate: daysFromNow(200),
      };

      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', authCookies)
        .send(overlappingLease);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Cannot create lease: overlapping active lease exists for this property');
    });

    it('should create lease with optional endDate as null', async () => {
      const leaseWithoutEndDate = {
        ...validLease,
        endDate: null,
      };

      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', authCookies)
        .send(leaseWithoutEndDate);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.lease.endDate).toBeNull();
    });

    it('should handle overlapping logic with null endDate', async () => {
      // Create active lease with no end date
      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: null,
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      // Try to create another active lease (should fail due to overlap)
      const overlappingLease = {
        ...validLease,
        startDate: daysFromNow(100),
        endDate: daysFromNow(500),
      };

      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', authCookies)
        .send(overlappingLease);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Cannot create lease: overlapping active lease exists for this property');
    });
  });

  describe('GET /api/leases', () => {
    it('should require authentication', async () => {
      const response = await request(app).get('/api/leases');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Authentication required');
    });

    it('should return empty array when no leases exist', async () => {
      const response = await request(app)
        .get('/api/leases')
        .set('Cookie', authCookies);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.leases).toEqual([]);
    });

    it('should return all leases with property and tenant relations', async () => {
      // Create leases
      const lease1 = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const lease2 = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: new Date('2023-01-01'),
          endDate: new Date('2023-12-31'),
          monthlyRent: 1100,
          securityDepositAmount: 1100,
        },
      });

      const response = await request(app)
        .get('/api/leases')
        .set('Cookie', authCookies);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.leases).toHaveLength(2);

      // Check relations are included
      expect(response.body.leases[0].property).toBeDefined();
      expect(response.body.leases[0].tenant).toBeDefined();

      // Check ordered by startDate desc (newest first)
      expect(response.body.leases[0].id).toBe(lease1.id);
      expect(response.body.leases[1].id).toBe(lease2.id);
    });

    it('should filter leases by property_id (single)', async () => {
      const otherProperty = await createProperty({
        data: {
          name: 'Other Property',
          street: '789 Test Street',
          city: 'London',
          county: 'Greater London',
          postcode: 'SW1A 3CC',
          propertyType: 'House',
        },
      });

      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      await prisma.lease.create({
        data: {
          propertyId: otherProperty.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1500,
          securityDepositAmount: 1500,
        },
      });

      const response = await request(app)
        .get('/api/leases')
        .set('Cookie', authCookies)
        .query({ property_id: testProperty.id });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.leases).toHaveLength(1);
      expect(response.body.leases[0].propertyId).toBe(testProperty.id);

      await prisma.property.delete({ where: { id: otherProperty.id } });
    });

    it('should filter leases by multiple property_id values (batch query)', async () => {
      const property2 = await createProperty({
        data: {
          name: 'Property 2',
          street: '456 Test Street',
          city: 'London',
          county: 'Greater London',
          postcode: 'SW1A 2BB',
          propertyType: 'Flat',
        },
      });

      const property3 = await createProperty({
        data: {
          name: 'Property 3',
          street: '789 Test Street',
          city: 'London',
          county: 'Greater London',
          postcode: 'SW1A 3CC',
          propertyType: 'House',
        },
      });

      // Create leases for all three properties
      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      await prisma.lease.create({
        data: {
          propertyId: property2.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1300,
          securityDepositAmount: 1300,
        },
      });

      await prisma.lease.create({
        data: {
          propertyId: property3.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1400,
          securityDepositAmount: 1400,
        },
      });

      // Query with multiple property IDs
      const response = await request(app)
        .get('/api/leases')
        .set('Cookie', authCookies)
        .query({ property_id: [testProperty.id, property2.id] });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.leases).toHaveLength(2);

      const propertyIds = response.body.leases.map((l: any) => l.propertyId);
      expect(propertyIds).toContain(testProperty.id);
      expect(propertyIds).toContain(property2.id);
      expect(propertyIds).not.toContain(property3.id);

      await prisma.property.delete({ where: { id: property2.id } });
      await prisma.property.delete({ where: { id: property3.id } });
    });

    it('should combine multiple property_id filter with status filter', async () => {
      const property2 = await createProperty({
        data: {
          name: 'Property 2',
          street: '456 Test Street',
          city: 'London',
          county: 'Greater London',
          postcode: 'SW1A 2BB',
          propertyType: 'Flat',
        },
      });

      // Active lease for property 1
      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      // Ended lease for property 1
      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-400),
          endDate: daysFromNow(-40),
          monthlyRent: 1100,
          securityDepositAmount: 1100,
        },
      });

      // Active lease for property 2
      await prisma.lease.create({
        data: {
          propertyId: property2.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1300,
          securityDepositAmount: 1300,
        },
      });

      // Query both properties but only Active status
      const response = await request(app)
        .get('/api/leases')
        .set('Cookie', authCookies)
        .query({ property_id: [testProperty.id, property2.id], status: 'Active' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.leases).toHaveLength(2);
      expect(response.body.leases.every((l: any) => l.status === 'Active')).toBe(true);

      await prisma.property.delete({ where: { id: property2.id } });
    });

    it('should filter leases by tenant_id', async () => {
      const otherTenant = await prisma.tenant.create({
        data: {
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane.smith@example.com',
          phone: '07700900456',
        },
      });

      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: otherTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app)
        .get('/api/leases')
        .set('Cookie', authCookies)
        .query({ tenant_id: testTenant.id });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.leases).toHaveLength(1);
      expect(response.body.leases[0].tenantId).toBe(testTenant.id);

      await prisma.tenant.delete({ where: { id: otherTenant.id } });
    });

    it('should filter leases by status', async () => {
      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-400),
          endDate: daysFromNow(-40),
          monthlyRent: 1100,
          securityDepositAmount: 1100,
        },
      });

      const response = await request(app)
        .get('/api/leases')
        .set('Cookie', authCookies)
        .query({ status: 'Active' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.leases).toHaveLength(1);
      expect(response.body.leases[0].status).toBe('Active');
    });

    it('should combine multiple filters', async () => {
      const otherProperty = await createProperty({
        data: {
          name: 'Other Property',
          street: '789 Test Street',
          city: 'London',
          county: 'Greater London',
          postcode: 'SW1A 3CC',
          propertyType: 'House',
        },
      });

      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-400),
          endDate: daysFromNow(-40),
          monthlyRent: 1100,
          securityDepositAmount: 1100,
        },
      });

      await prisma.lease.create({
        data: {
          propertyId: otherProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1500,
          securityDepositAmount: 1500,
        },
      });

      const response = await request(app)
        .get('/api/leases')
        .set('Cookie', authCookies)
        .query({ property_id: testProperty.id, status: 'Active' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.leases).toHaveLength(1);
      expect(response.body.leases[0].propertyId).toBe(testProperty.id);
      expect(response.body.leases[0].status).toBe('Active');

      await prisma.property.delete({ where: { id: otherProperty.id } });
    });

    it('should reject invalid query parameters - invalid property_id', async () => {
      const response = await request(app)
        .get('/api/leases')
        .set('Cookie', authCookies)
        .query({ property_id: 'invalid-id' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it('should reject invalid query parameters - invalid tenant_id', async () => {
      const response = await request(app)
        .get('/api/leases')
        .set('Cookie', authCookies)
        .query({ tenant_id: 'invalid-id' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it('should reject invalid query parameters - invalid status', async () => {
      const response = await request(app)
        .get('/api/leases')
        .set('Cookie', authCookies)
        .query({ status: 'InvalidStatus' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it('should filter leases by multiple property IDs', async () => {
      // Arrange: Create test properties and leases
      const property1 = await createProperty({
        data: {
          name: 'Property 1',
          street: '111 Test Street',
          city: 'London',
          county: 'Greater London',
          postcode: 'SW1A 1AA',
          propertyType: 'Flat',
        },
      });
      const property2 = await createProperty({
        data: {
          name: 'Property 2',
          street: '222 Test Street',
          city: 'London',
          county: 'Greater London',
          postcode: 'SW1A 2BB',
          propertyType: 'House',
        },
      });
      const property3 = await createProperty({
        data: {
          name: 'Property 3',
          street: '333 Test Street',
          city: 'London',
          county: 'Greater London',
          postcode: 'SW1A 3CC',
          propertyType: 'Flat',
        },
      });

      const tenant1 = await prisma.tenant.create({
        data: {
          firstName: 'Tenant',
          lastName: 'One',
          email: 'tenant1@example.com',
          phone: '07700900111',
        },
      });
      const tenant2 = await prisma.tenant.create({
        data: {
          firstName: 'Tenant',
          lastName: 'Two',
          email: 'tenant2@example.com',
          phone: '07700900222',
        },
      });

      const lease1 = await prisma.lease.create({
        data: {
          propertyId: property1.id,
          tenantId: tenant1.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1000,
          securityDepositAmount: 1000,
        },
      });
      const lease2 = await prisma.lease.create({
        data: {
          propertyId: property2.id,
          tenantId: tenant2.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1500,
          securityDepositAmount: 1500,
        },
      });
      const lease3 = await prisma.lease.create({
        data: {
          propertyId: property3.id,
          tenantId: tenant1.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      // Act: Query for leases from property1 and property2 only
      const response = await request(app)
        .get('/api/leases')
        .set('Cookie', authCookies)
        .query({ property_id: [property1.id, property2.id] });

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.leases).toHaveLength(2);

      const leaseIds = response.body.leases.map((l: any) => l.id);
      expect(leaseIds).toContain(lease1.id);
      expect(leaseIds).toContain(lease2.id);
      expect(leaseIds).not.toContain(lease3.id);

      // Cleanup
      await prisma.property.delete({ where: { id: property1.id } });
      await prisma.property.delete({ where: { id: property2.id } });
      await prisma.property.delete({ where: { id: property3.id } });
      await prisma.tenant.delete({ where: { id: tenant1.id } });
      await prisma.tenant.delete({ where: { id: tenant2.id } });
    });

    it('should handle single property ID as array', async () => {
      // Arrange
      const property = await createProperty({
        data: {
          name: 'Single Property',
          street: '999 Test Street',
          city: 'London',
          county: 'Greater London',
          postcode: 'SW1A 9ZZ',
          propertyType: 'Flat',
        },
      });
      const tenant = await prisma.tenant.create({
        data: {
          firstName: 'Single',
          lastName: 'Tenant',
          email: 'single@example.com',
          phone: '07700900999',
        },
      });
      const lease = await prisma.lease.create({
        data: {
          propertyId: property.id,
          tenantId: tenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1100,
          securityDepositAmount: 1100,
        },
      });

      // Act: Query with single ID (gets converted to array by route)
      const response = await request(app)
        .get('/api/leases')
        .set('Cookie', authCookies)
        .query({ property_id: property.id });

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.leases).toHaveLength(1);
      expect(response.body.leases[0].id).toBe(lease.id);

      // Cleanup
      await prisma.property.delete({ where: { id: property.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } });
    });
  });

  describe('GET /api/leases/:id', () => {
    it('should require authentication', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app).get(`/api/leases/${lease.id}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Authentication required');
    });

    it('should return lease by id with relations', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app)
        .get(`/api/leases/${lease.id}`)
        .set('Cookie', authCookies);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.lease.id).toBe(lease.id);
      expect(response.body.lease.property).toBeDefined();
      expect(response.body.lease.tenant).toBeDefined();
      expect(response.body.lease.property.id).toBe(testProperty.id);
      expect(response.body.lease.tenant.id).toBe(testTenant.id);
    });

    it('should return 404 for non-existent lease', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .get(`/api/leases/${nonExistentId}`)
        .set('Cookie', authCookies);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Lease not found');
    });

    it('should return 400 for invalid UUID format', async () => {
      const response = await request(app)
        .get('/api/leases/invalid-id')
        .set('Cookie', authCookies);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid lease ID format');
    });
  });

  describe('PUT /api/leases/:id', () => {
    it('should require authentication', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app)
        .put(`/api/leases/${lease.id}`)
        .send({ monthlyRent: 1300 });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Authentication required');
    });

    it('should block VIEWER role from updating leases', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app)
        .put(`/api/leases/${lease.id}`)
        .set('Cookie', viewerCookies)
        .send({ monthlyRent: 1300 });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Insufficient permissions');
    });

    it('should allow LANDLORD role to update leases', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app)
        .put(`/api/leases/${lease.id}`)
        .set('Cookie', landlordCookies)
        .send({ monthlyRent: 1300 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.lease.monthlyRent).toBe(1300);
    });

    it('should allow ADMIN role to update leases', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app)
        .put(`/api/leases/${lease.id}`)
        .set('Cookie', adminCookies)
        .send({ monthlyRent: 1300 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.lease.monthlyRent).toBe(1300);
    });

    it('should update lease with valid data', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const updateData = {
        monthlyRent: 1300,
      };

      const response = await request(app)
        .put(`/api/leases/${lease.id}`)
        .set('Cookie', authCookies)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.lease.monthlyRent).toBe(1300);
      expect(response.body.lease.status).toBe('Active');
      expect(response.body.lease.propertyId).toBe(testProperty.id); // Unchanged
    });

    it('recomputes status when endDate is updated to the past (status is not a settable field)', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app)
        .put(`/api/leases/${lease.id}`)
        .set('Cookie', authCookies)
        .send({ endDate: daysFromNow(-1), status: 'Active' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.lease.status).toBe('Ended');
    });

    it('should return 404 for non-existent lease', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app)
        .put(`/api/leases/${nonExistentId}`)
        .set('Cookie', authCookies)
        .send({ monthlyRent: 1300 });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Lease not found');
    });

    it('should return 400 for invalid UUID format', async () => {
      const response = await request(app)
        .put('/api/leases/invalid-id')
        .set('Cookie', authCookies)
        .send({ monthlyRent: 1300 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid lease ID format');
    });

    it('should validate new property exists if property is changed', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app)
        .put(`/api/leases/${lease.id}`)
        .set('Cookie', authCookies)
        .send({ propertyId: '00000000-0000-0000-0000-000000000000' });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Property not found');
    });

    it('should reject update if new property is listed "For Sale"', async () => {
      const forSaleProperty = await createProperty({
        data: {
          name: 'For Sale Property',
          street: '456 Test Street',
          city: 'London',
          county: 'Greater London',
          postcode: 'SW1A 2BB',
          propertyType: 'House',
          listingState: 'FOR_SALE',
        },
      });

      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app)
        .put(`/api/leases/${lease.id}`)
        .set('Cookie', authCookies)
        .send({ propertyId: forSaleProperty.id });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Property is not available');

      await prisma.property.delete({ where: { id: forSaleProperty.id } });
    });

    it('should validate new tenant exists if tenant is changed', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app)
        .put(`/api/leases/${lease.id}`)
        .set('Cookie', authCookies)
        .send({ tenantId: '00000000-0000-0000-0000-000000000000' });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Tenant not found');
    });

    it('should allow reassigning a lease to a Former tenant (they become Active again)', async () => {
      const formerTenant = await prisma.tenant.create({
        data: {
          firstName: 'Former',
          lastName: 'Tenant',
          email: 'former@example.com',
          phone: '07700900999',
        },
      });
      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: formerTenant.id,
          startDate: daysFromNow(-400),
          endDate: daysFromNow(-40),
          monthlyRent: 900,
          securityDepositAmount: 900,
        },
      });

      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app)
        .put(`/api/leases/${lease.id}`)
        .set('Cookie', authCookies)
        .send({ tenantId: formerTenant.id });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const tenantAfter = await request(app)
        .get(`/api/tenants/${formerTenant.id}`)
        .set('Cookie', authCookies);
      expect(tenantAfter.body.tenant.status).toBe('Active');

      await prisma.tenant.delete({ where: { id: formerTenant.id } });
    });

    it('should prevent overlapping ACTIVE leases when dates are changed', async () => {
      await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(60),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const lease2 = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(200),
          endDate: daysFromNow(400),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      // Try to move lease2's start date earlier so it overlaps with lease1
      const response = await request(app)
        .put(`/api/leases/${lease2.id}`)
        .set('Cookie', authCookies)
        .send({ startDate: daysFromNow(20) });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Cannot update lease: overlapping active lease exists for this property');
    });

    it('should allow updating dates if no overlap exists', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const newEndDate = daysFromNow(500);
      const response = await request(app)
        .put(`/api/leases/${lease.id}`)
        .set('Cookie', authCookies)
        .send({ endDate: newEndDate });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(new Date(response.body.lease.endDate).toISOString()).toBe(newEndDate.toISOString());
    });

    it('should allow partial updates', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app)
        .put(`/api/leases/${lease.id}`)
        .set('Cookie', authCookies)
        .send({ monthlyRent: 1250 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.lease.monthlyRent).toBe(1250);
      expect(response.body.lease.status).toBe('Active'); // Unchanged
    });
  });

  describe('DELETE /api/leases/:id', () => {
    it('should require authentication', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app).delete(`/api/leases/${lease.id}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Authentication required');
    });

    it('should block VIEWER role from deleting leases', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app)
        .delete(`/api/leases/${lease.id}`)
        .set('Cookie', viewerCookies);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Insufficient permissions');
    });

    it('should allow LANDLORD role to delete leases', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app)
        .delete(`/api/leases/${lease.id}`)
        .set('Cookie', landlordCookies);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.lease.id).toBe(lease.id);
    });

    it('should allow ADMIN role to delete leases', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app)
        .delete(`/api/leases/${lease.id}`)
        .set('Cookie', adminCookies);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.lease.id).toBe(lease.id);
    });

    it('should permanently delete the lease (no soft-delete concept remains for leases)', async () => {
      const lease = await prisma.lease.create({
        data: {
          propertyId: testProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const response = await request(app)
        .delete(`/api/leases/${lease.id}`)
        .set('Cookie', authCookies);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.lease.id).toBe(lease.id);

      // Verify lease no longer exists in database
      const stillExists = await prisma.lease.findUnique({
        where: { id: lease.id },
      });
      expect(stillExists).toBeNull();
    });

    it('should return 404 for non-existent lease', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app)
        .delete(`/api/leases/${nonExistentId}`)
        .set('Cookie', authCookies);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Lease not found');
    });

    it('should return 400 for invalid UUID format', async () => {
      const response = await request(app)
        .delete('/api/leases/invalid-id')
        .set('Cookie', authCookies);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid lease ID format');
    });

  });

  describe('Integration scenarios', () => {
    it('should create, read, update, and delete a lease', async () => {
      // Create
      const createResponse = await request(app)
        .post('/api/leases')
        .set('Cookie', authCookies)
        .send(validLease);

      expect(createResponse.status).toBe(201);
      const leaseId = createResponse.body.lease.id;

      // Read single
      const readResponse = await request(app)
        .get(`/api/leases/${leaseId}`)
        .set('Cookie', authCookies);

      expect(readResponse.status).toBe(200);
      expect(readResponse.body.lease.id).toBe(leaseId);

      // Update
      const updateResponse = await request(app)
        .put(`/api/leases/${leaseId}`)
        .set('Cookie', authCookies)
        .send({ monthlyRent: 1400 });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.lease.monthlyRent).toBe(1400);

      // Delete (no soft-delete concept for leases anymore)
      const deleteResponse = await request(app)
        .delete(`/api/leases/${leaseId}`)
        .set('Cookie', authCookies);

      expect(deleteResponse.status).toBe(200);

      // Verify no longer accessible
      const finalReadResponse = await request(app)
        .get(`/api/leases/${leaseId}`)
        .set('Cookie', authCookies);
      expect(finalReadResponse.status).toBe(404);
    });

    it('should handle multiple leases in list', async () => {
      // Create 3 leases
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/leases')
          .set('Cookie', authCookies)
          .send({
            ...validLease,
            startDate: daysFromNow(-400 + i * 10),
            endDate: daysFromNow(-300 + i * 10),
          });
      }

      // List all
      const listResponse = await request(app)
        .get('/api/leases')
        .set('Cookie', authCookies);
      expect(listResponse.status).toBe(200);
      expect(listResponse.body.leases).toHaveLength(3);

      // Verify ordered by startDate desc (newest first)
      for (let i = 0; i < 2; i++) {
        const current = new Date(listResponse.body.leases[i].startDate);
        const next = new Date(listResponse.body.leases[i + 1].startDate);
        expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
      }
    });
  });

  describe('Ownership scoping', () => {
    it('should not let a non-admin user see a lease on a property they do not own, via list or by id', async () => {
      const otherUsersProperty = await createProperty(
        {
          data: {
            name: 'Someone Else\'s Property',
            street: '1 Elsewhere Road',
            city: 'London',
            county: 'Greater London',
            postcode: 'SW1A 4DD',
            propertyType: 'Flat',
          },
        },
        landlordUserId
      );

      const lease = await prisma.lease.create({
        data: {
          propertyId: otherUsersProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const listResponse = await request(app)
        .get('/api/leases')
        .set('Cookie', authCookies);
      expect(listResponse.status).toBe(200);
      expect(listResponse.body.leases.map((l: any) => l.id)).not.toContain(lease.id);

      const readResponse = await request(app)
        .get(`/api/leases/${lease.id}`)
        .set('Cookie', authCookies);
      expect(readResponse.status).toBe(404);
      expect(readResponse.body.error).toBe('Lease not found');

      const updateResponse = await request(app)
        .put(`/api/leases/${lease.id}`)
        .set('Cookie', authCookies)
        .send({ monthlyRent: 1 });
      expect(updateResponse.status).toBe(404);

      const deleteResponse = await request(app)
        .delete(`/api/leases/${lease.id}`)
        .set('Cookie', authCookies);
      expect(deleteResponse.status).toBe(404);

      await prisma.lease.delete({ where: { id: lease.id } });
    });

    it('should not let a non-admin user create a lease against a property they do not own', async () => {
      const otherUsersProperty = await createProperty(
        {
          data: {
            name: 'Someone Else\'s Property 3',
            street: '3 Elsewhere Road',
            city: 'London',
            county: 'Greater London',
            postcode: 'SW1A 6FF',
            propertyType: 'Flat',
          },
        },
        landlordUserId
      );

      const response = await request(app)
        .post('/api/leases')
        .set('Cookie', authCookies)
        .send({ ...validLease, propertyId: otherUsersProperty.id });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Property not found');

      const leases = await prisma.lease.findMany({ where: { propertyId: otherUsersProperty.id } });
      expect(leases).toHaveLength(0);
    });

    it('should not let a non-admin user move a lease onto a property they do not own', async () => {
      const otherUsersProperty = await createProperty(
        {
          data: {
            name: 'Someone Else\'s Property 4',
            street: '4 Elsewhere Road',
            city: 'London',
            county: 'Greater London',
            postcode: 'SW1A 7GG',
            propertyType: 'Flat',
          },
        },
        landlordUserId
      );

      const lease = await prisma.lease.create({ data: validLease });

      const response = await request(app)
        .put(`/api/leases/${lease.id}`)
        .set('Cookie', authCookies)
        .send({ propertyId: otherUsersProperty.id });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Property not found');

      const unchangedLease = await prisma.lease.findUnique({ where: { id: lease.id } });
      expect(unchangedLease?.propertyId).toBe(testProperty.id);
    });

    it('should let an ADMIN user see leases on any property regardless of ownership', async () => {
      const otherUsersProperty = await createProperty(
        {
          data: {
            name: 'Someone Else\'s Property 2',
            street: '2 Elsewhere Road',
            city: 'London',
            county: 'Greater London',
            postcode: 'SW1A 5EE',
            propertyType: 'Flat',
          },
        },
        landlordUserId
      );

      const lease = await prisma.lease.create({
        data: {
          propertyId: otherUsersProperty.id,
          tenantId: testTenant.id,
          startDate: daysFromNow(-30),
          endDate: daysFromNow(300),
          monthlyRent: 1200,
          securityDepositAmount: 1200,
        },
      });

      const listResponse = await request(app)
        .get('/api/leases')
        .set('Cookie', adminCookies);
      expect(listResponse.status).toBe(200);
      expect(listResponse.body.leases.map((l: any) => l.id)).toContain(lease.id);

      const readResponse = await request(app)
        .get(`/api/leases/${lease.id}`)
        .set('Cookie', adminCookies);
      expect(readResponse.status).toBe(200);
      expect(readResponse.body.lease.id).toBe(lease.id);

      await prisma.lease.delete({ where: { id: lease.id } });
    });
  });
});
