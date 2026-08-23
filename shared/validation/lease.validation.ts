import { z } from 'zod';

// Lease Status Enum - computed from dates, see server/src/services/status.service.ts
export const LeaseStatusSchema = z.enum(['Upcoming', 'Active', 'Ended']);

// Base Lease Schema (common fields)
const baseLeaseSchema = {
  propertyId: z.string().uuid('Invalid property ID'),
  tenantId: z.string().uuid('Invalid tenant ID'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  monthlyRent: z.number().positive('Monthly rent must be positive'),
  securityDepositAmount: z.number().positive('Security deposit must be positive'),
  securityDepositPaidDate: z.coerce.date().optional().nullable(),
};

// Create Lease Schema (without id, timestamps) with date validation
export const CreateLeaseSchema = z
  .object(baseLeaseSchema)
  .refine(
    (data) => {
      // If endDate exists, ensure startDate <= endDate
      if (data.endDate) {
        return data.startDate <= data.endDate;
      }
      return true;
    },
    {
      message: 'Start date must be before or equal to end date',
      path: ['endDate'],
    }
  );

// Update Lease Schema (all fields optional except id) with date validation
export const UpdateLeaseSchema = z
  .object({
    id: z.string().uuid(),
    propertyId: z.string().uuid('Invalid property ID').optional(),
    tenantId: z.string().uuid('Invalid tenant ID').optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional().nullable(),
    monthlyRent: z.number().positive('Monthly rent must be positive').optional(),
    securityDepositAmount: z.number().positive('Security deposit must be positive').optional(),
    securityDepositPaidDate: z.coerce.date().optional().nullable(),
  })
  .refine(
    (data) => {
      // If both dates exist, ensure startDate <= endDate
      if (data.startDate && data.endDate) {
        return data.startDate <= data.endDate;
      }
      return true;
    },
    {
      message: 'Start date must be before or equal to end date',
      path: ['endDate'],
    }
  );

// Full Lease Schema (with all fields including timestamps).
// `status` is computed server-side (see server/src/services/status.service.ts), not stored -
// it is never accepted on Create/Update, only present on this output schema.
export const LeaseSchema = z
  .object({
    id: z.string().uuid(),
    ...baseLeaseSchema,
    status: LeaseStatusSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .refine(
    (data) => {
      // If endDate exists, ensure startDate <= endDate
      if (data.endDate) {
        return data.startDate <= data.endDate;
      }
      return true;
    },
    {
      message: 'Start date must be before or equal to end date',
      path: ['endDate'],
    }
  );

// Query Params Schema for filtering leases
export const LeaseQueryParamsSchema = z.object({
  property_id: z.union([
    z.string().uuid('Invalid property ID'),
    z.array(z.string().uuid('Invalid property ID'))
  ]).optional(),
  tenant_id: z.string().uuid('Invalid tenant ID').optional(),
  status: LeaseStatusSchema.optional(),
});

// Inferred TypeScript types
export type LeaseStatus = z.infer<typeof LeaseStatusSchema>;
export type CreateLease = z.infer<typeof CreateLeaseSchema>;
export type UpdateLease = z.infer<typeof UpdateLeaseSchema>;
export type Lease = z.infer<typeof LeaseSchema>;
export type LeaseQueryParams = z.infer<typeof LeaseQueryParamsSchema>;
