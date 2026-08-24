import { ApiError } from '../api.types';

describe('ApiError', () => {
  it('sets status, message and name', () => {
    const err = new ApiError(404, 'Not found');

    expect(err.status).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.name).toBe('ApiError');
  });

  it('is an instance of Error and ApiError', () => {
    const err = new ApiError(500, 'Server error');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
  });

  it('stores optional details', () => {
    const details = { field: 'email', reason: 'invalid' };
    const err = new ApiError(400, 'Bad request', details);

    expect(err.details).toEqual(details);
  });

  it('leaves details undefined when not provided', () => {
    const err = new ApiError(0, 'Network error');

    expect(err.details).toBeUndefined();
  });
});
