/**
 * Domain error hierarchy for service-layer business errors.
 *
 * Services should throw one of these subclasses instead of a plain `Error`
 * so that route/resolver layers can map errors to HTTP status codes (or
 * GraphQL error codes) via `instanceof` checks instead of matching on the
 * error message string. Matching on message strings is brittle: renaming a
 * message in the service silently turns a 400 into an unhandled 500.
 *
 * Modelled on `server/src/services/storage/errors.ts`, which already
 * establishes this pattern for storage-related errors. `StorageError` is
 * intentionally left as-is (not merged into this hierarchy) - a later pass
 * can decide whether `StorageError` should extend `DomainError`.
 */

/**
 * Base domain error class. Carries an HTTP status code and a machine
 * readable error code so callers don't need to inspect the message.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorCode: string
  ) {
    super(message);
    this.name = 'DomainError';
    // Required for `instanceof` to work correctly when compiling to targets
    // where built-in classes like Error aren't properly subclassable
    // (see server/src/services/storage/errors.ts for the same pattern).
    Object.setPrototypeOf(this, DomainError.prototype);
  }
}

/**
 * Error for a requested resource that does not exist.
 */
export class NotFoundError extends DomainError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Error for invalid input / a business rule violation on the submitted
 * data (e.g. a sum that must equal 100%, a malformed set of splits).
 */
export class ValidationError extends DomainError {
  constructor(message: string = 'Invalid input') {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Error for a request that conflicts with the current state of a resource
 * (e.g. a duplicate that would violate a uniqueness constraint).
 */
export class ConflictError extends DomainError {
  constructor(message: string = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictError';
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

/**
 * Error for an action the caller is not permitted to perform.
 */
export class ForbiddenError extends DomainError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}
