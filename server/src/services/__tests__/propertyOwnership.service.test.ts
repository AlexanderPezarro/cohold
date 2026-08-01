import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import prisma from '../../db/client.js';
import propertyOwnershipService from '../propertyOwnership.service.js';

describe('PropertyOwnershipService.updateOwnershipSplits', () => {
  let propertyId: string;
  let userAId: string;
  let userBId: string;
  let userCId: string;

  beforeAll(async () => {
    const userA = await prisma.user.create({
      data: { email: 'splits-a@test.com', password: 'password', role: 'LANDLORD' },
    });
    userAId = userA.id;

    const userB = await prisma.user.create({
      data: { email: 'splits-b@test.com', password: 'password', role: 'LANDLORD' },
    });
    userBId = userB.id;

    const userC = await prisma.user.create({
      data: { email: 'splits-c@test.com', password: 'password', role: 'LANDLORD' },
    });
    userCId = userC.id;

    const property = await prisma.property.create({
      data: {
        name: 'Splits Test Property',
        street: '456 Test St',
        city: 'Test City',
        county: 'Test County',
        postcode: 'TS2 2ST',
        propertyType: 'Flat',
        status: 'Available',
      },
    });
    propertyId = property.id;
  });

  afterAll(async () => {
    await prisma.propertyOwnership.deleteMany({});
    await prisma.property.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.propertyOwnership.deleteMany({});
    await prisma.propertyOwnership.createMany({
      data: [
        { userId: userAId, propertyId, ownershipPercentage: 60 },
        { userId: userBId, propertyId, ownershipPercentage: 40 },
      ],
    });
  });

  it('redistributes 60/40 to 50/50 in one call', async () => {
    const result = await propertyOwnershipService.updateOwnershipSplits(propertyId, [
      { userId: userAId, ownershipPercentage: 50 },
      { userId: userBId, ownershipPercentage: 50 },
    ]);

    expect(result).toHaveLength(2);
    const byUser = Object.fromEntries(result.map((o) => [o.userId, o.ownershipPercentage]));
    expect(byUser[userAId]).toBe(50);
    expect(byUser[userBId]).toBe(50);

    // Confirm persisted
    const persisted = await prisma.propertyOwnership.findMany({ where: { propertyId } });
    const persistedByUser = Object.fromEntries(
      persisted.map((o) => [o.userId, o.ownershipPercentage])
    );
    expect(persistedByUser[userAId]).toBe(50);
    expect(persistedByUser[userBId]).toBe(50);
  });

  it('includes user data in the returned ownership rows', async () => {
    const result = await propertyOwnershipService.updateOwnershipSplits(propertyId, [
      { userId: userAId, ownershipPercentage: 50 },
      { userId: userBId, ownershipPercentage: 50 },
    ]);

    const ownershipA = result.find((o) => o.userId === userAId);
    expect(ownershipA?.user).toMatchObject({ id: userAId, email: 'splits-a@test.com' });
  });

  it('throws when property does not exist', async () => {
    const fakePropertyId = '00000000-0000-0000-0000-000000000000';
    await expect(
      propertyOwnershipService.updateOwnershipSplits(fakePropertyId, [
        { userId: userAId, ownershipPercentage: 100 },
      ])
    ).rejects.toThrow('Property not found');
  });

  it('rejects a splits set that does not match current owners (missing an owner)', async () => {
    await expect(
      propertyOwnershipService.updateOwnershipSplits(propertyId, [
        { userId: userAId, ownershipPercentage: 100 },
      ])
    ).rejects.toThrow("Splits must cover exactly the property's current owners");

    // No partial writes
    const persisted = await prisma.propertyOwnership.findMany({ where: { propertyId } });
    const persistedByUser = Object.fromEntries(
      persisted.map((o) => [o.userId, o.ownershipPercentage])
    );
    expect(persistedByUser[userAId]).toBe(60);
    expect(persistedByUser[userBId]).toBe(40);
  });

  it('allows introducing a brand-new owner as long as every current owner is still covered, so 3+-owner splits can be built from an existing 2-owner property', async () => {
    const result = await propertyOwnershipService.updateOwnershipSplits(propertyId, [
      { userId: userAId, ownershipPercentage: 30 },
      { userId: userBId, ownershipPercentage: 30 },
      { userId: userCId, ownershipPercentage: 40 },
    ]);

    expect(result).toHaveLength(3);
    const byUser = Object.fromEntries(result.map((o) => [o.userId, o.ownershipPercentage]));
    expect(byUser[userAId]).toBe(30);
    expect(byUser[userBId]).toBe(30);
    expect(byUser[userCId]).toBe(40);

    const persisted = await prisma.propertyOwnership.findMany({ where: { propertyId } });
    expect(persisted).toHaveLength(3);
  });

  it('rejects a new owner in the splits who does not exist, without writing anything', async () => {
    const fakeUserId = '00000000-0000-0000-0000-0000000000ff';
    await expect(
      propertyOwnershipService.updateOwnershipSplits(propertyId, [
        { userId: userAId, ownershipPercentage: 30 },
        { userId: userBId, ownershipPercentage: 30 },
        { userId: fakeUserId, ownershipPercentage: 40 },
      ])
    ).rejects.toThrow('User not found');

    const persisted = await prisma.propertyOwnership.findMany({ where: { propertyId } });
    expect(persisted).toHaveLength(2);
    const persistedByUser = Object.fromEntries(
      persisted.map((o) => [o.userId, o.ownershipPercentage])
    );
    expect(persistedByUser[userAId]).toBe(60);
    expect(persistedByUser[userBId]).toBe(40);
  });

  it('can build a multi-owner split from scratch on a property with no owners yet, in one atomic call', async () => {
    await prisma.propertyOwnership.deleteMany({ where: { propertyId } });

    const result = await propertyOwnershipService.updateOwnershipSplits(propertyId, [
      { userId: userAId, ownershipPercentage: 34 },
      { userId: userBId, ownershipPercentage: 33 },
      { userId: userCId, ownershipPercentage: 33 },
    ]);

    expect(result).toHaveLength(3);
    const persisted = await prisma.propertyOwnership.findMany({ where: { propertyId } });
    expect(persisted).toHaveLength(3);
  });

  it('rejects a sum that is not ~100%', async () => {
    await expect(
      propertyOwnershipService.updateOwnershipSplits(propertyId, [
        { userId: userAId, ownershipPercentage: 70 },
        { userId: userBId, ownershipPercentage: 50 },
      ])
    ).rejects.toThrow('Total ownership must equal 100%. Current total: 120.00%');

    // Verify no partial writes occurred (atomic rejection before any writes)
    const persisted = await prisma.propertyOwnership.findMany({ where: { propertyId } });
    const persistedByUser = Object.fromEntries(
      persisted.map((o) => [o.userId, o.ownershipPercentage])
    );
    expect(persistedByUser[userAId]).toBe(60);
    expect(persistedByUser[userBId]).toBe(40);
  });
});
