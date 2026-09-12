import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import { requireWrite } from '../middleware/permissions.js';
import { upload, handleUploadError } from '../middleware/upload.js';
import prisma from '../db/client.js';
import { getStorageService } from '../services/storage/getStorageService.js';
import { StorageError } from '../services/storage/errors.js';
import { EntityTypeSchema } from '../../../shared/validation/document.validation.js';
import { z } from 'zod';
// Ownership-scoping for Document's polymorphic association now lives in a shared
// service so the GraphQL `documents` resolvers enforce the identical rule (they
// previously skipped scoping entirely - migration plan Risk 6).
import {
  isEntityAccessible,
  documentScopeWhere,
} from '../services/documentScope.service.js';

const router = Router();

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

      // Validate entity exists and is owned by the requester (or ADMIN) - otherwise
      // a document could be attached to another landlord's property/tenant/lease/transaction.
      const entityAccessible = await isEntityAccessible(entityType, entityId, req.user!);
      if (!entityAccessible) {
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

      const saveResult = await getStorageService().saveFile(req.file.buffer, fileMetadata);

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
    } catch (error) {
      console.error('Upload document error:', error);

      // Handle storage service errors
      if (error instanceof StorageError) {
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
    const where: Prisma.DocumentWhereInput = {};

    if (entityType) {
      // Validate entityType
      const entityTypeValidation = EntityTypeSchema.safeParse(entityType);
      if (!entityTypeValidation.success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid entityType. Must be Property, Tenant, Lease, or Transaction',
        });
      }
      where.entityType = entityTypeValidation.data;
    }

    if (entityId) {
      // Validate entityId format
      if (!z.string().uuid().safeParse(entityId).success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid entityId format',
        });
      }
      where.entityId = String(entityId);
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

    const stream = await getStorageService().getFileStream(document.filePath);

    res.setHeader('Content-Type', document.fileType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`
    );
    res.setHeader('Content-Length', document.fileSize);

    return stream.pipe(res);
  } catch (error) {
    console.error('Download document error:', error);
    if (error instanceof StorageError) {
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
    await getStorageService().deleteFile(existingDocument.filePath);

    // Delete document record from database
    const document = await prisma.document.delete({
      where: { id },
    });

    return res.json({
      success: true,
      document,
    });
  } catch (error) {
    console.error('Delete document error:', error);

    // Handle storage service errors
    if (error instanceof StorageError) {
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
