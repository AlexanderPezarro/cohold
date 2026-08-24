import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireWrite } from '../middleware/permissions.js';
import { upload, handleUploadError } from '../middleware/upload.js';
import prisma from '../db/client.js';
import { LocalStorageService } from '../services/storage/LocalStorageService.js';
import { EntityTypeSchema } from '../../../shared/validation/document.validation.js';
import { z } from 'zod';
import { propertyScope, propertyRelationScope, tenantScope } from '../services/scoping.js';

const router = Router();
const storageService = new LocalStorageService();

// Helper function to validate entity exists
async function validateEntity(entityType: string, entityId: string): Promise<boolean> {
  const modelMap: { [key: string]: any } = {
    Property: prisma.property,
    Tenant: prisma.tenant,
    Lease: prisma.lease,
    Transaction: prisma.transaction,
  };

  const model = modelMap[entityType];
  if (!model) {
    return false;
  }

  const entity = await model.findUnique({ where: { id: entityId } });
  return entity !== null;
}

// Documents are polymorphically associated (entityType + entityId) with no DB-level
// foreign key, so ownership scoping can't be expressed as a single Prisma relation
// filter the way it can for Lease/Event/Transaction. Instead we resolve, per
// entityType, which entityIds of that type the user may see (or, for a specific
// document, whether its one entity is in scope), reusing the same property-ownership
// predicates as the other routes so the rule stays identical everywhere.

type ScopeUser = { id: string; role: string };

// Whether a single (entityType, entityId) pair is visible to this user.
async function isEntityAccessible(entityType: string, entityId: string, user: ScopeUser): Promise<boolean> {
  if (user.role === 'ADMIN') return true;

  switch (entityType) {
    case 'Property':
      return (
        (await prisma.property.findFirst({ where: { id: entityId, ...propertyScope(user) }, select: { id: true } })) !== null
      );
    case 'Tenant':
      return (
        (await prisma.tenant.findFirst({ where: { id: entityId, ...tenantScope(user) }, select: { id: true } })) !== null
      );
    case 'Lease':
      return (
        (await prisma.lease.findFirst({ where: { id: entityId, ...propertyRelationScope(user) }, select: { id: true } })) !== null
      );
    case 'Transaction':
      return (
        (await prisma.transaction.findFirst({ where: { id: entityId, ...propertyRelationScope(user) }, select: { id: true } })) !== null
      );
    default:
      return false;
  }
}

// A Prisma DocumentWhereInput restricting results to documents whose entity is in
// scope for this user, across all entity types at once. ADMIN gets no restriction.
async function documentScopeWhere(user: ScopeUser): Promise<Record<string, unknown>> {
  if (user.role === 'ADMIN') return {};

  const [properties, tenants, leases, transactions] = await Promise.all([
    prisma.property.findMany({ where: propertyScope(user), select: { id: true } }),
    prisma.tenant.findMany({ where: tenantScope(user), select: { id: true } }),
    prisma.lease.findMany({ where: propertyRelationScope(user), select: { id: true } }),
    prisma.transaction.findMany({ where: propertyRelationScope(user), select: { id: true } }),
  ]);

  return {
    OR: [
      { entityType: 'Property', entityId: { in: properties.map((p) => p.id) } },
      { entityType: 'Tenant', entityId: { in: tenants.map((t) => t.id) } },
      { entityType: 'Lease', entityId: { in: leases.map((l) => l.id) } },
      { entityType: 'Transaction', entityId: { in: transactions.map((t) => t.id) } },
    ],
  };
}

// POST /api/documents - Upload document (requires auth + write permission)
router.post(
  '/',
  requireAuth,
  requireWrite,
  upload.single('file'),
  handleUploadError,
  async (req: Request, res: Response) => {
    try {
      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded',
        });
      }

      // Validate entityType and entityId from request body
      const { entityType, entityId } = req.body;

      if (!entityType) {
        return res.status(400).json({
          success: false,
          error: 'entityType is required',
        });
      }

      if (!entityId) {
        return res.status(400).json({
          success: false,
          error: 'entityId is required',
        });
      }

      // Validate entityType
      const entityTypeValidation = EntityTypeSchema.safeParse(entityType);
      if (!entityTypeValidation.success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid entityType. Must be Property, Tenant, Lease, or Transaction',
        });
      }

      // Validate entityId format
      if (!z.string().uuid().safeParse(entityId).success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid entityId format',
        });
      }

      // Validate entity exists
      const entityExists = await validateEntity(entityType, entityId);
      if (!entityExists) {
        return res.status(404).json({
          success: false,
          error: `${entityType} with ID ${entityId} not found`,
        });
      }

      // Save file using LocalStorageService
      const fileMetadata = {
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
      };

      const saveResult = await storageService.saveFile(req.file.buffer, fileMetadata);

      // Create document record in database
      const document = await prisma.document.create({
        data: {
          entityType,
          entityId,
          fileName: req.file.originalname,
          filePath: saveResult.filePath,
          fileType: req.file.mimetype,
          fileSize: req.file.size,
        },
      });

      return res.status(201).json({
        success: true,
        document,
      });
    } catch (error: any) {
      console.error('Upload document error:', error);

      // Handle storage service errors
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        error: 'An error occurred while uploading document',
      });
    }
  }
);

// GET /api/documents - List documents with filtering
router.get('/', requireAuth, async (req, res) => {
  try {
    const { entityType, entityId } = req.query;

    // Build filter object
    const where: any = {};

    if (entityType) {
      // Validate entityType
      const entityTypeValidation = EntityTypeSchema.safeParse(entityType);
      if (!entityTypeValidation.success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid entityType. Must be Property, Tenant, Lease, or Transaction',
        });
      }
      where.entityType = entityType;
    }

    if (entityId) {
      // Validate entityId format
      if (!z.string().uuid().safeParse(entityId).success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid entityId format',
        });
      }
      where.entityId = entityId;
    }

    // Scope to documents whose entity the user can access (ADMIN sees all). Merged
    // with any entityType/entityId filter above via Prisma's implicit AND, so a
    // filter for a specific entity the user doesn't own correctly yields nothing.
    Object.assign(where, await documentScopeWhere(req.user!));

    const documents = await prisma.document.findMany({
      where,
      orderBy: { uploadedAt: 'desc' },
    });

    return res.json({
      success: true,
      documents,
    });
  } catch (error) {
    console.error('Get documents error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while fetching documents',
    });
  }
});

// GET /api/documents/:id - Get document metadata
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid document ID format',
      });
    }

    const document = await prisma.document.findUnique({
      where: { id },
    });

    if (!document || !(await isEntityAccessible(document.entityType, document.entityId, req.user!))) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
      });
    }

    return res.json({
      success: true,
      document,
    });
  } catch (error) {
    console.error('Get document error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while fetching document',
    });
  }
});

// GET /api/documents/:id/download - Download file
router.get('/:id/download', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid document ID format',
      });
    }

    const document = await prisma.document.findUnique({
      where: { id },
    });

    if (!document || !(await isEntityAccessible(document.entityType, document.entityId, req.user!))) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
      });
    }

    const stream = await storageService.getFileStream(document.filePath);

    res.setHeader('Content-Type', document.fileType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`
    );
    res.setHeader('Content-Length', document.fileSize);

    return stream.pipe(res);
  } catch (error: any) {
    console.error('Download document error:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }
    return res.status(500).json({
      success: false,
      error: 'An error occurred while downloading document',
    });
  }
});

// DELETE /api/documents/:id - Delete document (requires auth + write permission)
router.delete('/:id', requireAuth, requireWrite, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid document ID format',
      });
    }

    // Check if document exists and is in scope (404 for both, see properties.ts for rationale)
    const existingDocument = await prisma.document.findUnique({
      where: { id },
    });

    if (!existingDocument || !(await isEntityAccessible(existingDocument.entityType, existingDocument.entityId, req.user!))) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
      });
    }

    // Delete file from storage
    await storageService.deleteFile(existingDocument.filePath);

    // Delete document record from database
    const document = await prisma.document.delete({
      where: { id },
    });

    return res.json({
      success: true,
      document,
    });
  } catch (error: any) {
    console.error('Delete document error:', error);

    // Handle storage service errors
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      error: 'An error occurred while deleting document',
    });
  }
});

export default router;
