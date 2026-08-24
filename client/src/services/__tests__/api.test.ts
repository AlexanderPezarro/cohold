import type { AxiosRequestConfig } from 'axios';

// Build a fresh mock axios instance shape (interceptors.use spies, request
// method spies) that our mocked axios.create() will return.
function createMockAxiosInstance() {
  return {
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    request: jest.fn(),
  };
}

type MockAxiosInstance = ReturnType<typeof createMockAxiosInstance>;

const mockAxiosInstance: MockAxiosInstance = createMockAxiosInstance();
const mockAxiosCreate = jest.fn((..._args: unknown[]) => mockAxiosInstance);

jest.mock('axios', () => ({
  create: (...args: unknown[]) => mockAxiosCreate(...args),
}));

const mockToast = {
  success: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
  info: jest.fn(),
  showToast: jest.fn(),
};

jest.mock('../../contexts/ToastContext', () => ({
  toast: mockToast,
}));

// Import after mocks are registered so api.ts's top-level axios.create() call
// picks up our mock instance and interceptor registration.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const apiModule = require('../api');
const { api, default: apiClient } = apiModule as typeof import('../api');
import { ApiError } from '../../types/api.types';

describe('api.ts', () => {
  const [requestSuccess, requestError] =
    mockAxiosInstance.interceptors.request.use.mock.calls[0];
  const [responseSuccess, responseError] =
    mockAxiosInstance.interceptors.response.use.mock.calls[0];

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('axios instance setup', () => {
    it('creates the axios instance with the expected base configuration', () => {
      expect(mockAxiosCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: '/api',
          timeout: 10000,
          withCredentials: true,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('exports the created axios instance as the default export', () => {
      expect(apiClient).toBe(mockAxiosInstance);
    });
  });

  describe('request interceptor (success path)', () => {
    it('passes the config through unchanged', () => {
      const config = { method: 'get', url: '/properties' };
      expect(requestSuccess(config)).toBe(config);
    });
  });

  describe('request interceptor (error path)', () => {
    it('rejects with the original error', async () => {
      const error = new Error('request setup failed');
      await expect(requestError(error)).rejects.toBe(error);
    });
  });

  describe('response interceptor (success path)', () => {
    it('passes the response through unchanged', () => {
      const response = { status: 200, data: { success: true }, config: { method: 'get', url: '/x' } };
      expect(responseSuccess(response)).toBe(response);
    });
  });

  describe('response interceptor (error path)', () => {
    describe('401 Unauthorized', () => {
      it('dispatches an api:unauthorized event and throws an ApiError', async () => {
        const listener = jest.fn();
        window.addEventListener('api:unauthorized', listener);

        const error = {
          response: {
            status: 401,
            data: { success: false, error: 'Session expired' },
          },
          config: {},
        };

        await expect(responseError(error)).rejects.toMatchObject({
          status: 401,
          message: 'You are not authenticated. Please log in.',
        });
        expect(listener).toHaveBeenCalledTimes(1);

        window.removeEventListener('api:unauthorized', listener);
      });
    });

    describe('403 Forbidden', () => {
      it('shows a toast and throws an ApiError', async () => {
        const error = {
          response: {
            status: 403,
            data: { success: false, error: 'No permission' },
          },
          config: {},
        };

        await expect(responseError(error)).rejects.toMatchObject({
          status: 403,
          message: 'You do not have permission to perform this action.',
        });
        expect(mockToast.error).toHaveBeenCalledWith(
          "You don't have permission to perform this action"
        );
      });
    });

    describe('404 Not Found', () => {
      it('throws an ApiError using the string error message from the payload', async () => {
        const error = {
          response: {
            status: 404,
            data: { success: false, error: 'Property not found' },
          },
          config: {},
        };

        await expect(responseError(error)).rejects.toMatchObject({
          status: 404,
          message: 'Property not found',
        });
      });

      it('throws an ApiError using the object error message from the payload', async () => {
        const error = {
          response: {
            status: 404,
            data: {
              success: false,
              error: { code: 'NOT_FOUND', message: 'Tenant not found' },
            },
          },
          config: {},
        };

        await expect(responseError(error)).rejects.toMatchObject({
          status: 404,
          message: 'Tenant not found',
        });
      });

      it('falls back to a default message when the object error has no message', async () => {
        const error = {
          response: {
            status: 404,
            data: { success: false, error: { code: 'NOT_FOUND' } },
          },
          config: {},
        };

        await expect(responseError(error)).rejects.toMatchObject({
          status: 404,
          message: 'An unexpected error occurred',
        });
      });

      it('falls back to a default message when data indicates success (unexpected shape)', async () => {
        const error = {
          response: {
            status: 404,
            data: { success: true },
          },
          config: {},
        };

        await expect(responseError(error)).rejects.toMatchObject({
          status: 404,
          message: 'An unexpected error occurred',
        });
      });

      it('falls back to a default message when there is no data at all', async () => {
        const error = { response: { status: 404, data: undefined }, config: {} };

        await expect(responseError(error)).rejects.toMatchObject({
          status: 404,
          message: 'An unexpected error occurred',
        });
      });

      it('falls back to a default message when data.error is neither a string nor an object', async () => {
        const error = {
          response: { status: 404, data: { success: false, error: undefined } },
          config: {},
        };

        await expect(responseError(error)).rejects.toMatchObject({
          status: 404,
          message: 'An unexpected error occurred',
        });
      });
    });

    describe('5xx Server Errors with retry', () => {
      it('retries once after a 1s delay, mutating config._retry', async () => {
        jest.useFakeTimers();

        const config: AxiosRequestConfig & { _retry?: boolean } = { url: '/properties' };
        const error = {
          response: { status: 500, data: { success: false, error: 'boom' } },
          config,
        };

        mockAxiosInstance.request.mockResolvedValue({ status: 200, data: { success: true } });

        const promise = responseError(error);
        await jest.advanceTimersByTimeAsync(1000);
        const result = await promise;

        expect(config._retry).toBe(true);
        expect(mockAxiosInstance.request).toHaveBeenCalledWith(config);
        expect(result).toEqual({ status: 200, data: { success: true } });

        jest.useRealTimers();
      });

      it('throws an ApiError after the retry attempt has already happened', async () => {
        const config: AxiosRequestConfig & { _retry?: boolean } = {
          url: '/properties',
          _retry: true,
        };
        const error = {
          response: { status: 503, data: { success: false, error: 'still down' } },
          config,
        };

        await expect(responseError(error)).rejects.toMatchObject({
          status: 503,
          message: 'Server error. Please try again later.',
        });
        expect(mockAxiosInstance.request).not.toHaveBeenCalled();
      });
    });

    describe('other 4xx errors', () => {
      it('throws an ApiError for a 400 Bad Request', async () => {
        const error = {
          response: {
            status: 400,
            data: { success: false, error: 'Invalid payload' },
          },
          config: {},
        };

        await expect(responseError(error)).rejects.toMatchObject({
          status: 400,
          message: 'Invalid payload',
        });
      });

      it('throws an ApiError for a 422 Unprocessable Entity', async () => {
        const error = {
          response: {
            status: 422,
            data: { success: false, error: 'Validation failed' },
          },
          config: {},
        };

        await expect(responseError(error)).rejects.toMatchObject({
          status: 422,
          message: 'Validation failed',
        });
      });
    });

    describe('unexpected status codes', () => {
      it('falls through to the generic ApiError branch for a 3xx status', async () => {
        const error = {
          response: {
            status: 300,
            data: { success: false, error: 'Multiple choices' },
          },
          config: {},
        };

        await expect(responseError(error)).rejects.toMatchObject({
          status: 300,
          message: 'Multiple choices',
        });
      });
    });

    describe('network errors (no response)', () => {
      it('throws a network-error ApiError when the request was made but no response arrived', async () => {
        const error = { request: {}, config: {} };

        await expect(responseError(error)).rejects.toMatchObject({
          status: 0,
          message: 'Network error. Please check your connection and try again.',
        });
      });
    });

    describe('other errors (no response, no request)', () => {
      it('throws an ApiError using error.message when present', async () => {
        const error = { message: 'Something exploded', config: {} };

        await expect(responseError(error)).rejects.toMatchObject({
          status: 0,
          message: 'Something exploded',
        });
      });

      it('falls back to a default message when error.message is empty', async () => {
        const error = { message: '', config: {} };

        await expect(responseError(error)).rejects.toMatchObject({
          status: 0,
          message: 'An unexpected error occurred',
        });
      });
    });

    it('rejects with a real ApiError instance', async () => {
      const error = { request: {}, config: {} };

      try {
        await responseError(error);
        throw new Error('expected responseError to reject');
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
      }
    });
  });

  describe('api convenience wrapper', () => {
    it('get() delegates to apiClient.get and returns its result', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: { success: true, properties: [] } });

      const result = await api.get('/properties', { params: { status: 'Active' } });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/properties', {
        params: { status: 'Active' },
      });
      expect(result).toEqual({ data: { success: true, properties: [] } });
    });

    it('post() delegates to apiClient.post with data and config', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { success: true } });

      await api.post('/properties', { name: 'New Property' }, { headers: { 'X-Test': '1' } });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/properties',
        { name: 'New Property' },
        { headers: { 'X-Test': '1' } }
      );
    });

    it('put() delegates to apiClient.put with data and config', async () => {
      mockAxiosInstance.put.mockResolvedValue({ data: { success: true } });

      await api.put('/properties/1', { name: 'Updated' });

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/properties/1', { name: 'Updated' }, undefined);
    });

    it('patch() delegates to apiClient.patch with data and config', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

      await api.patch('/properties/1', { name: 'Patched' });

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/properties/1', { name: 'Patched' }, undefined);
    });

    it('delete() delegates to apiClient.delete', async () => {
      mockAxiosInstance.delete.mockResolvedValue({ data: { success: true } });

      await api.delete('/properties/1');

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/properties/1', undefined);
    });
  });
});

describe('api.ts (development mode logging)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('logs request/response/error/retry activity when viteEnv.DEV is true', async () => {
    jest.resetModules();

    const devInstance = createMockAxiosInstance();
    const devCreate = jest.fn((..._args: unknown[]) => devInstance);

    jest.doMock('axios', () => ({
      create: (...args: unknown[]) => devCreate(...args),
    }));
    jest.doMock('../../contexts/ToastContext', () => ({
      toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn(), info: jest.fn(), showToast: jest.fn() },
    }));
    jest.doMock('../viteEnv', () => ({
      viteEnv: {
        DEV: true,
        PROD: false,
        MODE: 'development',
        BASE_URL: '/',
        SSR: false,
        VITE_API_BASE_URL: undefined,
      },
    }));

    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../api');

    const [reqSuccess, reqError] = devInstance.interceptors.request.use.mock.calls[0];
    const [resSuccess, resError] = devInstance.interceptors.response.use.mock.calls[0];

    reqSuccess({ method: 'get', url: '/properties', params: {}, data: {} });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('[API Request]'),
      expect.any(Object)
    );

    await expect(reqError(new Error('bad config'))).rejects.toThrow('bad config');
    expect(consoleErrorSpy).toHaveBeenCalledWith('[API Request Error]', expect.any(Error));

    resSuccess({ status: 200, data: {}, config: { method: 'get', url: '/properties' } });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('[API Response]'),
      expect.any(Object)
    );

    // Non-retryable error path (404) logs the response error.
    await expect(
      resError({
        response: { status: 404, data: { success: false, error: 'missing' } },
        config: { method: 'get', url: '/properties/1' },
      })
    ).rejects.toMatchObject({ status: 404 });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[API Response Error]',
      expect.objectContaining({ status: 404 })
    );

    // Retry path additionally logs a "[API Retry]" message.
    jest.useFakeTimers();
    devInstance.request.mockResolvedValue({ status: 200, data: { success: true } });
    const retryConfig: AxiosRequestConfig & { _retry?: boolean } = { url: '/x' };
    const retryPromise = resError({
      response: { status: 500, data: { success: false, error: 'down' } },
      config: retryConfig,
    });
    await jest.advanceTimersByTimeAsync(1000);
    await retryPromise;
    expect(consoleLogSpy).toHaveBeenCalledWith('[API Retry] Retrying request due to 5xx error');
    jest.useRealTimers();

    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
