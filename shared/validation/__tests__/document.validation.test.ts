import { describe, it, expect } from '@jest/globals';
import {
  EntityTypeSchema,
  AllowedMimeTypesSchema,
  CreateDocumentSchema,
  UpdateDocumentSchema,
  DocumentSchema,
  MAX_DOCUMENT_SIZE,
} from '../document.validation';

const entityId = '123e4567-e89b-12d3-a456-426614174000';
const documentId = '123e4567-e89b-12d3-a456-426614174001';

const validDocument = {
  entityType: 'Property' as const,
  entityId,
  fileName: 'lease-agreement.pdf',
  filePath: '/uploads/documents/lease-agreement.pdf',
  fileType: 'application/pdf' as const,
  fileSize: 1024000, // 1MB
};

describe('EntityTypeSchema', () => {
  it('accepts each valid entity type', () => {
    for (const type of ['Property', 'Tenant', 'Lease', 'Transaction']) {
      expect(EntityTypeSchema.parse(type)).toBe(type);
    }
  });

  it('rejects an unknown entity type', () => {
    expect(() => EntityTypeSchema.parse('Invoice')).toThrow();
  });
});

describe('AllowedMimeTypesSchema', () => {
  it('accepts each valid mime type', () => {
    for (const type of ['image/jpeg', 'image/png', 'application/pdf']) {
      expect(AllowedMimeTypesSchema.parse(type)).toBe(type);
    }
  });

  it('rejects a disallowed mime type', () => {
    expect(() => AllowedMimeTypesSchema.parse('application/zip')).toThrow();
  });
});

describe('CreateDocumentSchema', () => {
  it('accepts a valid document', () => {
    expect(() => CreateDocumentSchema.parse(validDocument)).not.toThrow();
  });

  it('rejects a document with size over the 10MB limit', () => {
    const oversizedDocument = {
      ...validDocument,
      fileSize: 15 * 1024 * 1024, // 15MB
    };
    expect(() => CreateDocumentSchema.parse(oversizedDocument)).toThrow();
  });

  it('accepts a document exactly at the size limit', () => {
    expect(() =>
      CreateDocumentSchema.parse({ ...validDocument, fileSize: MAX_DOCUMENT_SIZE })
    ).not.toThrow();
  });

  it('rejects a non-positive file size', () => {
    expect(() => CreateDocumentSchema.parse({ ...validDocument, fileSize: 0 })).toThrow();
  });

  it('rejects a non-integer file size', () => {
    expect(() => CreateDocumentSchema.parse({ ...validDocument, fileSize: 100.5 })).toThrow();
  });

  it('rejects an empty file name', () => {
    expect(() => CreateDocumentSchema.parse({ ...validDocument, fileName: '' })).toThrow();
  });

  it('rejects an empty file path', () => {
    expect(() => CreateDocumentSchema.parse({ ...validDocument, filePath: '' })).toThrow();
  });

  it('rejects an invalid entity ID', () => {
    expect(() =>
      CreateDocumentSchema.parse({ ...validDocument, entityId: 'not-a-uuid' })
    ).toThrow();
  });

  it('rejects a disallowed file type', () => {
    expect(() =>
      CreateDocumentSchema.parse({ ...validDocument, fileType: 'application/zip' })
    ).toThrow();
  });
});

describe('UpdateDocumentSchema', () => {
  it('accepts an update with only id', () => {
    expect(() => UpdateDocumentSchema.parse({ id: documentId })).not.toThrow();
  });

  it('accepts an update with all fields', () => {
    expect(() => UpdateDocumentSchema.parse({ id: documentId, ...validDocument })).not.toThrow();
  });

  it('rejects an update with an oversized file', () => {
    expect(() =>
      UpdateDocumentSchema.parse({ id: documentId, fileSize: 15 * 1024 * 1024 })
    ).toThrow();
  });

  it('rejects an invalid id', () => {
    expect(() => UpdateDocumentSchema.parse({ id: 'not-a-uuid' })).toThrow();
  });
});

describe('DocumentSchema', () => {
  it('accepts a valid full document', () => {
    expect(() =>
      DocumentSchema.parse({ id: documentId, ...validDocument, uploadedAt: new Date() })
    ).not.toThrow();
  });

  it('rejects a full document that is oversized', () => {
    expect(() =>
      DocumentSchema.parse({
        id: documentId,
        ...validDocument,
        fileSize: 15 * 1024 * 1024,
        uploadedAt: new Date(),
      })
    ).toThrow();
  });
});
