import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import { requireWrite } from '../middleware/permissions.js';
import prisma from '../db/client.js';
import { CreateLeaseSchema, UpdateLeaseSchema, LeaseQueryParamsSchema } from '../../../shared/validation/lease.validation.js';
import { z } from 'zod';
import { buildLeaseStatusWhere, buildCurrentLeaseWhere, withLeaseStatus, withTenantStatus, withPropertyStatus } from '../services/status.service.js';
import { propertyRelationScope, propertyScope } from '../services/scoping.js';

const router = Router();

const leaseDatesSelect = { startDate: true, endDate: true } as const;

// Attaches computed status to a lease and its nested property/tenant, all consistently
// derived at the same point in time.
function withNestedStatus<
  T extends {
    startDate: Date;
    endDate: Date | null;
    property: { listingState: string | null; leases: Array<{ startDate: Date; endDate: Date | null }> };
    tenant: { leases: Array<{ startDate: Date; endDate: Date | null }> };
  },
>(lease: T, now: Date = new Date()) {
  return withLeaseStatus(
    {
      ...lease,
      property: withPropertyStatus(lease.property, now),
      tenant: withTenantStatus(lease.tenant, now),
    },
    now
  );
}

// GET /api/leases - List leases with filtering
router.get('/', requireAuth, async (req, res) => {
  try {
    // Validate query parameters
    const validationResult = LeaseQueryParamsSchema.safeParse(req.query);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: validationResult.error.issues[0].message,
      });
    }

    const { property_id, tenant_id, status } = validationResult.data;

    // Build filter object, scoped to leases on properties the user owns (ADMIN sees all)
    const where: Prisma.LeaseWhereInput = { ...propertyRelationScope(req.user!) };

    if (property_id) {
      // Normalize to array - works for both single and multiple IDs
      const propertyIds = Array.isArray(property_id) ? property_id : [property_id];
      if (propertyIds.length > 0) {
        where.propertyId = { in: propertyIds };
      }
    }

    if (tenant_id) {
      where.tenantId = tenant_id;
    }

    if (status) {
      Object.assign(where, buildLeaseStatusWhere(status));
    }

    const leases = await prisma.lease.findMany({
      where,
      include: {
        property: { include: { leases: { select: leaseDatesSelect } } },
        tenant: { include: { leases: { select: leaseDatesSelect } } },
      },
      orderBy: { startDate: 'desc' },
    });

    return res.json({
      success: true,
      leases: leases.map((lease) => withNestedStatus(lease)),
    });
  } catch (error) {
    console.error('Get leases error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while fetching leases',
    });
  }
});

// GET /api/leases/:id - Get single lease
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid lease ID format',
      });
    }

    const lease = await prisma.lease.findFirst({
      where: { id, ...propertyRelationScope(req.user!) },
      include: {
        property: { include: { leases: { select: leaseDatesSelect } } },
        tenant: { include: { leases: { select: leaseDatesSelect } } },
      },
    });

    if (!lease) {
      return res.status(404).json({
        success: false,
        error: 'Lease not found',
      });
    }

    return res.json({
      success: true,
      lease: withNestedStatus(lease),
    });
  } catch (error) {
    console.error('Get lease error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while fetching lease',
    });
  }
});

// POST /api/leases - Create lease (requires auth + write permission)
router.post('/', requireAuth, requireWrite, async (req, res) => {
  try {
    // Validate request body
    const validationResult = CreateLeaseSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: validationResult.error.issues[0].message,
      });
    }

    const leaseData = validationResult.data;

    // Check property exists, is owned by the requester (or ADMIN), and is not listed
    // 'For Sale'. 404 for both missing and out-of-scope (see properties.ts rationale).
    const property = await prisma.property.findFirst({
      where: { id: leaseData.propertyId, ...propertyScope(req.user!) },
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        error: 'Property not found',
      });
    }

    if (property.listingState === 'FOR_SALE') {
      return res.status(400).json({
        success: false,
        error: 'Property is not available for lease',
      });
    }

    // Check tenant exists
    const tenant = await prisma.tenant.findUnique({
      where: { id: leaseData.tenantId },
    });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found',
      });
    }

    // Validate no overlapping non-Ended (Upcoming or Active) leases for the same property.
    // Overlap condition: (new.startDate <= existing.endDate OR existing.endDate is null)
    //                AND (new.endDate >= existing.startDate OR new.endDate is null)
    const overlapWhere: Prisma.LeaseWhereInput = {
      propertyId: leaseData.propertyId,
      ...buildCurrentLeaseWhere(),
      AND: leaseData.endDate
        ? [
            {
              OR: [
                { endDate: { gte: leaseData.startDate } },
                { endDate: null },
              ],
            },
            { startDate: { lte: leaseData.endDate } },
          ]
        : [
            {
              OR: [
                { endDate: { gte: leaseData.startDate } },
                { endDate: null },
              ],
            },
          ],
    };

    const overlappingLeases = await prisma.lease.findMany({
      where: overlapWhere,
    });

    if (overlappingLeases.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot create lease: overlapping active lease exists for this property',
      });
    }

    // Create lease
    const lease = await prisma.lease.create({
      data: leaseData,
      include: {
        property: { include: { leases: { select: leaseDatesSelect } } },
        tenant: { include: { leases: { select: leaseDatesSelect } } },
      },
    });

    return res.status(201).json({
      success: true,
      lease: withNestedStatus(lease),
    });
  } catch (error) {
    console.error('Create lease error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while creating lease',
    });
  }
});

// PUT /api/leases/:id - Update lease (requires auth + write permission)
router.put('/:id', requireAuth, requireWrite, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid lease ID format',
      });
    }

    // Validate request body with id
    const validationResult = UpdateLeaseSchema.safeParse({
      id,
      ...req.body,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: validationResult.error.issues[0].message,
      });
    }

    // Check if lease exists and is in scope (404 for both, see properties.ts for rationale)
    const existingLease = await prisma.lease.findFirst({
      where: { id, ...propertyRelationScope(req.user!) },
    });

    if (!existingLease) {
      return res.status(404).json({
        success: false,
        error: 'Lease not found',
      });
    }

    // Extract id from validated data and use rest for update
    const { id: _, ...updateData } = validationResult.data;

    // If property changed, validate the new property exists, is owned by the
    // requester (or ADMIN), and is not listed 'For Sale' - otherwise a lease could
    // be moved onto a property the requester doesn't own.
    if (updateData.propertyId) {
      const property = await prisma.property.findFirst({
        where: { id: updateData.propertyId, ...propertyScope(req.user!) },
      });

      if (!property) {
        return res.status(404).json({
          success: false,
          error: 'Property not found',
        });
      }

      if (property.listingState === 'FOR_SALE') {
        return res.status(400).json({
          success: false,
          error: 'Property is not available for lease',
        });
      }
    }

    // If tenant changed, validate they exist
    if (updateData.tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: updateData.tenantId },
      });

      if (!tenant) {
        return res.status(404).json({
          success: false,
          error: 'Tenant not found',
        });
      }
    }

    // If dates or property changed, validate no overlapping non-Ended leases remain
    if (updateData.startDate || updateData.endDate !== undefined || updateData.propertyId) {
      const startDate = updateData.startDate || existingLease.startDate;
      const endDate = updateData.endDate !== undefined ? updateData.endDate : existingLease.endDate;
      const propertyId = updateData.propertyId || existingLease.propertyId;

      const overlapWhere: Prisma.LeaseWhereInput = {
        propertyId,
        id: { not: id }, // Exclude current lease from overlap check
        ...buildCurrentLeaseWhere(),
        AND: endDate
          ? [
              {
                OR: [
                  { endDate: { gte: startDate } },
                  { endDate: null },
                ],
              },
              { startDate: { lte: endDate } },
            ]
          : [
              {
                OR: [
                  { endDate: { gte: startDate } },
                  { endDate: null },
                ],
              },
            ],
      };

      const overlappingLeases = await prisma.lease.findMany({
        where: overlapWhere,
      });

      if (overlappingLeases.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Cannot update lease: overlapping active lease exists for this property',
        });
      }
    }

    // Update lease
    const lease = await prisma.lease.update({
      where: { id },
      data: updateData,
      include: {
        property: { include: { leases: { select: leaseDatesSelect } } },
        tenant: { include: { leases: { select: leaseDatesSelect } } },
      },
    });

    return res.json({
      success: true,
      lease: withNestedStatus(lease),
    });
  } catch (error) {
    console.error('Update lease error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while updating lease',
    });
  }
});

// DELETE /api/leases/:id - Hard delete lease (requires auth + write permission)
router.delete('/:id', requireAuth, requireWrite, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid lease ID format',
      });
    }

    // Check if lease exists and is in scope (404 for both, see properties.ts for rationale)
    const existingLease = await prisma.lease.findFirst({
      where: { id, ...propertyRelationScope(req.user!) },
    });

    if (!existingLease) {
      return res.status(404).json({
        success: false,
        error: 'Lease not found',
      });
    }

    const lease = await prisma.lease.delete({
      where: { id },
    });

    return res.json({
      success: true,
      lease,
    });
  } catch (error) {
    console.error('Delete lease error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while deleting lease',
    });
  }
});

export default router;
