import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import { requireWrite } from '../middleware/permissions.js';
import prisma from '../db/client.js';
import { CreatePropertySchema, UpdatePropertySchema, PropertyQueryParamsSchema } from '../../../shared/validation/property.validation.js';
import { z } from 'zod';
import { buildPropertyStatusWhere, withPropertyStatus } from '../services/status.service.js';
import { propertyScope } from '../services/scoping.js';

const router = Router();

const leaseDatesSelect = { startDate: true, endDate: true } as const;

// GET /api/properties - List properties with filtering
router.get('/', requireAuth, async (req, res) => {
  try {
    // Validate query parameters
    const validationResult = PropertyQueryParamsSchema.safeParse(req.query);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: validationResult.error.issues[0].message,
      });
    }

    const { status, propertyType, search } = validationResult.data;

    // Build filter object, scoped to properties the user owns (ADMIN sees all)
    const where: Prisma.PropertyWhereInput = { ...propertyScope(req.user!) };

    if (status) {
      Object.assign(where, buildPropertyStatusWhere(status));
    }

    if (propertyType) {
      where.propertyType = propertyType;
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { street: { contains: search } },
        { city: { contains: search } },
      ];
    }

    const properties = await prisma.property.findMany({
      where,
      include: {
        leases: { select: leaseDatesSelect },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({
      success: true,
      properties: properties.map((property) => withPropertyStatus(property)),
    });
  } catch (error) {
    console.error('Get properties error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while fetching properties',
    });
  }
});

// GET /api/properties/:id - Get single property
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid property ID format',
      });
    }

    const property = await prisma.property.findFirst({
      where: { id, ...propertyScope(req.user!) },
      include: {
        leases: { select: leaseDatesSelect },
      },
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        error: 'Property not found',
      });
    }

    return res.json({
      success: true,
      property: withPropertyStatus(property),
    });
  } catch (error) {
    console.error('Get property error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while fetching property',
    });
  }
});

// POST /api/properties - Create property (requires auth + write permission)
router.post('/', requireAuth, requireWrite, async (req, res) => {
  try {
    // Validate request body
    const validationResult = CreatePropertySchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: validationResult.error.issues[0].message,
      });
    }

    const propertyData = validationResult.data;

    // Create the property and grant the creating user 100% ownership atomically,
    // so it isn't invisible to them the instant ownership scoping applies to
    // subsequent reads (mirrors the GraphQL createProperty resolver).
    const property = await prisma.$transaction(async (tx) => {
      const created = await tx.property.create({
        data: propertyData,
      });
      await tx.propertyOwnership.create({
        data: { userId: req.user!.id, propertyId: created.id, ownershipPercentage: 100 },
      });
      return created;
    });

    // A newly created property has no leases yet.
    return res.status(201).json({
      success: true,
      property: withPropertyStatus({ ...property, leases: [] }),
    });
  } catch (error) {
    console.error('Create property error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while creating property',
    });
  }
});

// PUT /api/properties/:id - Update property (requires auth + write permission)
router.put('/:id', requireAuth, requireWrite, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid property ID format',
      });
    }

    // Validate request body with id
    const validationResult = UpdatePropertySchema.safeParse({
      id,
      ...req.body,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: validationResult.error.issues[0].message,
      });
    }

    // Check if property exists and is in scope (404 for both "doesn't exist" and
    // "exists but you don't own it", to avoid leaking other landlords' records)
    const existingProperty = await prisma.property.findFirst({
      where: { id, ...propertyScope(req.user!) },
    });

    if (!existingProperty) {
      return res.status(404).json({
        success: false,
        error: 'Property not found',
      });
    }

    // Extract id from validated data and use rest for update
    const { id: _, ...updateData } = validationResult.data;

    // Update property
    const property = await prisma.property.update({
      where: { id },
      data: updateData,
      include: {
        leases: { select: leaseDatesSelect },
      },
    });

    return res.json({
      success: true,
      property: withPropertyStatus(property),
    });
  } catch (error) {
    console.error('Update property error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while updating property',
    });
  }
});

// DELETE /api/properties/:id - Delete property (requires auth + write permission)
// Query param ?archive=true for soft delete (listingState to 'FOR_SALE')
// Default: hard delete (permanently remove property and related data)
router.delete('/:id', requireAuth, requireWrite, async (req, res) => {
  try {
    const { id } = req.params;
    const { archive } = req.query;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid property ID format',
      });
    }

    // Check if property exists and is in scope (404 for both cases, see PUT handler above)
    const existingProperty = await prisma.property.findFirst({
      where: { id, ...propertyScope(req.user!) },
    });

    if (!existingProperty) {
      return res.status(404).json({
        success: false,
        error: 'Property not found',
      });
    }

    let property;

    if (archive === 'true') {
      // Soft delete: mark as listed for sale
      property = await prisma.property.update({
        where: { id },
        data: { listingState: 'FOR_SALE' },
        include: {
          leases: { select: leaseDatesSelect },
        },
      });

      return res.json({
        success: true,
        property: withPropertyStatus(property),
      });
    }

    // Hard delete: delete documents manually (polymorphic), then delete property
    // Leases, transactions, and events will cascade automatically via onDelete: Cascade
    await prisma.document.deleteMany({
      where: {
        entityType: 'property',
        entityId: id,
      },
    });

    property = await prisma.property.delete({
      where: { id },
    });

    return res.json({
      success: true,
      property,
    });
  } catch (error) {
    console.error('Delete property error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while deleting property',
    });
  }
});

export default router;
