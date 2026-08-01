import { z } from 'zod';

export const PropertyOwnershipCreateSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  propertyId: z.string().uuid('Invalid property ID'),
  ownershipPercentage: z
    .number()
    .min(0.01, 'Ownership must be at least 0.01%')
    .max(100, 'Ownership cannot exceed 100%'),
});

export const PropertyOwnershipUpdateSchema = z.object({
  ownershipPercentage: z
    .number()
    .min(0.01, 'Ownership must be at least 0.01%')
    .max(100, 'Ownership cannot exceed 100%'),
});

export const PropertyOwnershipSplitsSchema = z.object({
  splits: z
    .array(
      z.object({
        userId: z.string().uuid('Invalid user ID'),
        ownershipPercentage: z
          .number()
          .min(0.01, 'Ownership must be at least 0.01%')
          .max(100, 'Ownership cannot exceed 100%'),
      })
    )
    .min(1),
});

export type PropertyOwnershipCreate = z.infer<typeof PropertyOwnershipCreateSchema>;
export type PropertyOwnershipUpdate = z.infer<typeof PropertyOwnershipUpdateSchema>;
export type PropertyOwnershipSplits = z.infer<typeof PropertyOwnershipSplitsSchema>;

// Helper function for server-side aggregate validation
export function validateOwnershipSum(
  ownerships: Array<{ ownershipPercentage: number }>
): { valid: boolean; sum: number } {
  const sum = ownerships.reduce((acc, o) => acc + o.ownershipPercentage, 0);
  // Allow for floating point precision issues
  const valid = Math.abs(sum - 100) < 0.01;
  return { valid, sum };
}
