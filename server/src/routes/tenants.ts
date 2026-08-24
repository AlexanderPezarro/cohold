import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import { requireWrite } from '../middleware/permissions.js';
import prisma from '../db/client.js';
import { CreateTenantSchema, UpdateTenantSchema, TenantQueryParamsSchema, LeaseHistoryQueryParamsSchema } from '../../../shared/validation/tenant.validation.js';
import { z } from 'zod';
import { buildTenantStatusWhere, withTenantStatus, withLeaseStatus, withPropertyStatus } from '../services/status.service.js';
import { tenantScope, propertyRelationScope } from '../services/scoping.js';

const router = Router();

const leaseDatesSelect = { startDate: true, endDate: true } as const;

// GET /api/tenants - List tenants with filtering
router.get('/', requireAuth, async (req, res) => {
  try {
    // Validate query parameters
    const validationResult = TenantQueryParamsSchema.safeParse(req.query);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: validationResult.error.issues[0].message,
      });
    }

    const { status, search } = validationResult.data;

    // Build filter object, scoped to tenants with at least one lease on a property
    // the user owns (ADMIN sees all). A tenant with no leases at all has no
    // ownership path and is therefore excluded for non-admins.
    const where: Prisma.TenantWhereInput = { ...tenantScope(req.user!) };

    if (status) {
      Object.assign(where, buildTenantStatusWhere(status));
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { email: { contains: search } },
      ];
    }

    const tenants = await prisma.tenant.findMany({
      where,
      include: {
        leases: { select: leaseDatesSelect },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({
      success: true,
      tenants: tenants.map((tenant) => withTenantStatus(tenant)),
    });
  } catch (error) {
    console.error('Get tenants error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while fetching tenants',
    });
  }
});

// GET /api/tenants/:id - Get single tenant
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid tenant ID format',
      });
    }

    const tenant = await prisma.tenant.findFirst({
      where: { id, ...tenantScope(req.user!) },
      include: {
        leases: { select: leaseDatesSelect },
      },
    });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found',
      });
    }

    return res.json({
      success: true,
      tenant: withTenantStatus(tenant),
    });
  } catch (error) {
    console.error('Get tenant error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while fetching tenant',
    });
  }
});

// POST /api/tenants - Create tenant (requires auth + write permission)
router.post('/', requireAuth, requireWrite, async (req, res) => {
  try {
    // Validate request body
    const validationResult = CreateTenantSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: validationResult.error.issues[0].message,
      });
    }

    const tenantData = validationResult.data;

    // Create tenant
    const tenant = await prisma.tenant.create({
      data: tenantData,
    });

    // A newly created tenant has no leases yet, so status is always 'Prospective'.
    return res.status(201).json({
      success: true,
      tenant: withTenantStatus({ ...tenant, leases: [] }),
    });
  } catch (error) {
    console.error('Create tenant error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while creating tenant',
    });
  }
});

// PUT /api/tenants/:id - Update tenant (requires auth + write permission)
router.put('/:id', requireAuth, requireWrite, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid tenant ID format',
      });
    }

    // Validate request body with id
    const validationResult = UpdateTenantSchema.safeParse({
      id,
      ...req.body,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: validationResult.error.issues[0].message,
      });
    }

    // Check if tenant exists and is in scope (404 for both, see properties.ts for rationale)
    const existingTenant = await prisma.tenant.findFirst({
      where: { id, ...tenantScope(req.user!) },
    });

    if (!existingTenant) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found',
      });
    }

    // Extract id from validated data and use rest for update
    const { id: _, ...updateData } = validationResult.data;

    // Update tenant
    const tenant = await prisma.tenant.update({
      where: { id },
      data: updateData,
      include: {
        leases: { select: leaseDatesSelect },
      },
    });

    return res.json({
      success: true,
      tenant: withTenantStatus(tenant),
    });
  } catch (error) {
    console.error('Update tenant error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while updating tenant',
    });
  }
});

// DELETE /api/tenants/:id - Hard delete tenant (requires auth + write permission)
router.delete('/:id', requireAuth, requireWrite, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid tenant ID format',
      });
    }

    // Check if tenant exists and is in scope (404 for both, see properties.ts for rationale)
    const existingTenant = await prisma.tenant.findFirst({
      where: { id, ...tenantScope(req.user!) },
    });

    if (!existingTenant) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found',
      });
    }

    // Delete documents manually (polymorphic), then delete tenant.
    // Leases will cascade automatically via onDelete: Cascade.
    await prisma.document.deleteMany({
      where: {
        entityType: 'tenant',
        entityId: id,
      },
    });

    const tenant = await prisma.tenant.delete({
      where: { id },
    });

    return res.json({
      success: true,
      tenant,
    });
  } catch (error) {
    console.error('Delete tenant error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while deleting tenant',
    });
  }
});

// GET /api/tenants/:id/lease-history - Get tenant lease history with property details
router.get('/:id/lease-history', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid tenant ID format',
      });
    }

    // Validate query parameters
    const validationResult = LeaseHistoryQueryParamsSchema.safeParse(req.query);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: validationResult.error.issues[0].message,
      });
    }

    const { fromDate, toDate } = validationResult.data;

    // Check if tenant exists and is in scope (404 for both, see properties.ts for rationale)
    const existingTenant = await prisma.tenant.findFirst({
      where: { id, ...tenantScope(req.user!) },
    });

    if (!existingTenant) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found',
      });
    }

    // Build filter for lease date ranges. Also scope by property ownership - a
    // tenant shared across landlords (via separate leases) should only surface
    // this user's own leases for them, not every landlord's.
    const where: Prisma.LeaseWhereInput = {
      tenantId: id,
      ...propertyRelationScope(req.user!),
    };

    // Apply date filtering: leases that overlap with the date range
    // A lease overlaps if: startDate <= toDate AND (endDate >= fromDate OR endDate is null)
    if (fromDate || toDate) {
      where.AND = [];

      if (toDate) {
        where.AND.push({
          startDate: { lte: toDate },
        });
      }

      if (fromDate) {
        where.AND.push({
          OR: [
            { endDate: { gte: fromDate } },
            { endDate: null },
          ],
        });
      }
    }

    const leases = await prisma.lease.findMany({
      where,
      include: {
        property: {
          include: {
            leases: { select: leaseDatesSelect },
          },
        },
      },
      orderBy: { startDate: 'desc' },
    });

    return res.json({
      success: true,
      leases: leases.map((lease) =>
        withLeaseStatus({ ...lease, property: withPropertyStatus(lease.property) })
      ),
    });
  } catch (error) {
    console.error('Get tenant lease history error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while fetching tenant lease history',
    });
  }
});

export default router;
