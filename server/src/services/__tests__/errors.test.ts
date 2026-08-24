import { describe, it, expect } from '@jest/globals';
import {
  DomainError,
  NotFoundError,
  ValidationError,
  ConflictError,
  ForbiddenError,
} from '../errors.js';

describe('Domain error hierarchy', () => {
  describe('DomainError', () => {
    it('carries the provided message, statusCode and errorCode', () => {
      const error = new DomainError('something went wrong', 418, 'TEAPOT');

      expect(error.message).toBe('something went wrong');
      expect(error.statusCode).toBe(418);
      expect(error.errorCode).toBe('TEAPOT');
    });

    it('is an instance of Error and DomainError', () => {
      const error = new DomainError('oops', 500, 'GENERIC');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DomainError);
    });
  });

  describe('NotFoundError', () => {
    it('defaults to 404 / NOT_FOUND', () => {
      const error = new NotFoundError();

      expect(error.statusCode).toBe(404);
      expect(error.errorCode).toBe('NOT_FOUND');
      expect(error.message).toBe('Resource not found');
    });

    it('accepts a custom message while keeping the default status/code', () => {
      const error = new NotFoundError('Property not found');

      expect(error.message).toBe('Property not found');
      expect(error.statusCode).toBe(404);
      expect(error.errorCode).toBe('NOT_FOUND');
    });

    it('is an instance of Error, DomainError and NotFoundError', () => {
      const error = new NotFoundError('missing');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toBeInstanceOf(NotFoundError);
    });

    it('is not an instance of sibling subclasses', () => {
      const error = new NotFoundError('missing');

      expect(error).not.toBeInstanceOf(ValidationError);
      expect(error).not.toBeInstanceOf(ConflictError);
      expect(error).not.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('ValidationError', () => {
    it('defaults to 400 / VALIDATION_ERROR', () => {
      const error = new ValidationError();

      expect(error.statusCode).toBe(400);
      expect(error.errorCode).toBe('VALIDATION_ERROR');
      expect(error.message).toBe('Invalid input');
    });

    it('is an instance of Error, DomainError and ValidationError', () => {
      const error = new ValidationError('Total ownership must equal 100%');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toBeInstanceOf(ValidationError);
    });

    it('is not an instance of sibling subclasses', () => {
      const error = new ValidationError('bad input');

      expect(error).not.toBeInstanceOf(NotFoundError);
      expect(error).not.toBeInstanceOf(ConflictError);
      expect(error).not.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('ConflictError', () => {
    it('defaults to 409 / CONFLICT', () => {
      const error = new ConflictError();

      expect(error.statusCode).toBe(409);
      expect(error.errorCode).toBe('CONFLICT');
      expect(error.message).toBe('Resource conflict');
    });

    it('is an instance of Error, DomainError and ConflictError', () => {
      const error = new ConflictError('already exists');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toBeInstanceOf(ConflictError);
    });

    it('is not an instance of sibling subclasses', () => {
      const error = new ConflictError('already exists');

      expect(error).not.toBeInstanceOf(NotFoundError);
      expect(error).not.toBeInstanceOf(ValidationError);
      expect(error).not.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('ForbiddenError', () => {
    it('defaults to 403 / FORBIDDEN', () => {
      const error = new ForbiddenError();

      expect(error.statusCode).toBe(403);
      expect(error.errorCode).toBe('FORBIDDEN');
      expect(error.message).toBe('Forbidden');
    });

    it('is an instance of Error, DomainError and ForbiddenError', () => {
      const error = new ForbiddenError('not allowed');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toBeInstanceOf(ForbiddenError);
    });

    it('is not an instance of sibling subclasses', () => {
      const error = new ForbiddenError('not allowed');

      expect(error).not.toBeInstanceOf(NotFoundError);
      expect(error).not.toBeInstanceOf(ValidationError);
      expect(error).not.toBeInstanceOf(ConflictError);
    });
  });

  it('can be distinguished via instanceof in a catch block, as route/resolver layers rely on', () => {
    const errors: DomainError[] = [
      new NotFoundError('not found'),
      new ValidationError('bad input'),
      new ConflictError('conflict'),
      new ForbiddenError('forbidden'),
    ];

    const codes = errors.map((error) => {
      if (error instanceof NotFoundError) return 'NOT_FOUND';
      if (error instanceof ValidationError) return 'VALIDATION_ERROR';
      if (error instanceof ConflictError) return 'CONFLICT';
      if (error instanceof ForbiddenError) return 'FORBIDDEN';
      return 'UNKNOWN';
    });

    expect(codes).toEqual(['NOT_FOUND', 'VALIDATION_ERROR', 'CONFLICT', 'FORBIDDEN']);
  });
});
