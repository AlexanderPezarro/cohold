import prisma from '../db/client.js';
import {
  PropertyOwnershipCreate,
  PropertyOwnershipUpdate,
  validateOwnershipSum,
} from '../../../shared/validation/index.js';

export class PropertyOwnershipService {
  /**
   * Add an owner to a property
   */
  async addOwner(data: PropertyOwnershipCreate) {
    // Check if property exists
    const property = await prisma.property.findUnique({
      where: { id: data.propertyId },
    });

    if (!property) {
      throw new Error('Property not found');
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Check if ownership already exists
    const existingOwnership = await prisma.propertyOwnership.findUnique({
      where: {
        userId_propertyId: {
          userId: data.userId,
          propertyId: data.propertyId,
        },
      },
    });

    if (existingOwnership) {
      throw new Error('User already owns this property');
    }

    // Create ownership
    const ownership = await prisma.propertyOwnership.create({
      data,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });

    // Validate total ownership percentage after creation
    // Only validate if there are multiple owners
    const allOwnerships = await prisma.propertyOwnership.findMany({
      where: { propertyId: data.propertyId },
    });

    if (allOwnerships.length > 1) {
      const validation = validateOwnershipSum(allOwnerships);
      if (!validation.valid) {
        // Store the invalid sum before rollback
        const invalidSum = validation.sum;
        // Rollback by deleting the just-created ownership
        await prisma.propertyOwnership.delete({
          where: { id: ownership.id },
        });
        throw new Error(
          `Total ownership must equal 100%. Current total: ${invalidSum.toFixed(2)}%`
        );
      }
    }

    return ownership;
  }

  /**
   * Update an owner's percentage for a property
   */
  async updateOwnership(propertyId: string, userId: string, data: PropertyOwnershipUpdate) {
    // Check if ownership exists
    const ownership = await prisma.propertyOwnership.findUnique({
      where: {
        userId_propertyId: {
          userId,
          propertyId,
        },
      },
    });

    if (!ownership) {
      throw new Error('Ownership not found');
    }

    // Update ownership
    const updatedOwnership = await prisma.propertyOwnership.update({
      where: {
        userId_propertyId: {
          userId,
          propertyId,
        },
      },
      data,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });

    // Validate total ownership percentage after update
    // Only validate if there are multiple owners
    const allOwnerships = await prisma.propertyOwnership.findMany({
      where: { propertyId },
    });

    if (allOwnerships.length > 1) {
      const validation = validateOwnershipSum(allOwnerships);
      if (!validation.valid) {
        // Store the invalid sum before rollback
        const invalidSum = validation.sum;
        // Rollback by restoring the original percentage
        await prisma.propertyOwnership.update({
          where: {
            userId_propertyId: {
              userId,
              propertyId,
            },
          },
          data: {
            ownershipPercentage: ownership.ownershipPercentage,
          },
        });
        throw new Error(
          `Total ownership must equal 100%. Current total: ${invalidSum.toFixed(2)}%`
        );
      }
    }

    return updatedOwnership;
  }

  /**
   * Atomically replace ownership percentages for a property's owners.
   * Unlike updateOwnership (which validates/rolls back a single row at a
   * time and can never redistribute between 2+ existing owners), this
   * validates the full new split sums to 100% before writing anything.
   *
   * The splits must include every current owner (this is not a way to
   * remove an owner - use removeOwner, which enforces the related
   * transaction-split/settlement checks) but may also introduce brand-new
   * owners, so a 3+-owner split can be built from an existing property in
   * one atomic call instead of only via sequential addOwner calls (which
   * can never get past 2 owners, since adding a 3rd necessarily breaks the
   * running 100% sum addOwner validates after every single-row write).
   */
  async updateOwnershipSplits(
    propertyId: string,
    splits: Array<{ userId: string; ownershipPercentage: number }>
  ) {
    // Check if property exists
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
    });

    if (!property) {
      throw new Error('Property not found');
    }

    // Fetch current owners
    const currentOwnerships = await prisma.propertyOwnership.findMany({
      where: { propertyId },
    });

    const currentUserIds = new Set(currentOwnerships.map((o) => o.userId));
    const splitUserIds = new Set(splits.map((s) => s.userId));

    const coversAllCurrentOwners = [...currentUserIds].every((id) => splitUserIds.has(id));

    if (!coversAllCurrentOwners) {
      throw new Error("Splits must cover exactly the property's current owners");
    }

    // Users being introduced as owners for the first time in this call must exist
    const newUserIds = [...splitUserIds].filter((id) => !currentUserIds.has(id));
    if (newUserIds.length > 0) {
      const newUsers = await prisma.user.findMany({
        where: { id: { in: newUserIds } },
      });
      if (newUsers.length !== newUserIds.length) {
        throw new Error('User not found');
      }
    }

    // Validate the new percentages sum to 100% before writing anything
    const validation = validateOwnershipSum(splits);
    if (!validation.valid) {
      throw new Error(
        `Total ownership must equal 100%. Current total: ${validation.sum.toFixed(2)}%`
      );
    }

    // Apply all updates/creates atomically
    await prisma.$transaction(
      splits.map((split) =>
        currentUserIds.has(split.userId)
          ? prisma.propertyOwnership.update({
              where: {
                userId_propertyId: {
                  userId: split.userId,
                  propertyId,
                },
              },
              data: {
                ownershipPercentage: split.ownershipPercentage,
              },
            })
          : prisma.propertyOwnership.create({
              data: {
                userId: split.userId,
                propertyId,
                ownershipPercentage: split.ownershipPercentage,
              },
            })
      )
    );

    const updatedOwnerships = await prisma.propertyOwnership.findMany({
      where: { propertyId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: {
        ownershipPercentage: 'desc',
      },
    });

    return updatedOwnerships;
  }

  /**
   * Remove an owner from a property
   */
  async removeOwner(propertyId: string, userId: string) {
    // Check if ownership exists
    const ownership = await prisma.propertyOwnership.findUnique({
      where: {
        userId_propertyId: {
          userId,
          propertyId,
        },
      },
    });

    if (!ownership) {
      throw new Error('Ownership not found');
    }

    // Check for related transaction splits
    const transactionSplits = await prisma.transactionSplit.findFirst({
      where: {
        userId,
        transaction: {
          propertyId,
        },
      },
    });

    if (transactionSplits) {
      throw new Error('Cannot remove owner with existing transaction splits');
    }

    // Check for related settlements (from or to)
    const settlements = await prisma.settlement.findFirst({
      where: {
        propertyId,
        OR: [{ fromUserId: userId }, { toUserId: userId }],
      },
    });

    if (settlements) {
      throw new Error('Cannot remove owner with existing settlements');
    }

    // Delete ownership (no ownership sum validation required after deletion)
    await prisma.propertyOwnership.delete({
      where: {
        userId_propertyId: {
          userId,
          propertyId,
        },
      },
    });

    return { success: true };
  }

  /**
   * List all owners of a property
   */
  async listOwners(propertyId: string) {
    // Check if property exists
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
    });

    if (!property) {
      throw new Error('Property not found');
    }

    const ownerships = await prisma.propertyOwnership.findMany({
      where: { propertyId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: {
        ownershipPercentage: 'desc',
      },
    });

    return ownerships;
  }
}

export default new PropertyOwnershipService();
