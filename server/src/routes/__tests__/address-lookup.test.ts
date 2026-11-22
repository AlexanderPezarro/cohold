import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  jest,
} from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../app.js';
import prisma from '../../db/client.js';
import authService from '../../services/auth.service.js';

const app = createApp();

function jsonResponse(status: number, body: unknown) {
  return { status, json: async () => body } as Response;
}

describe('GET /api/address-lookup/:postcode', () => {
  const fetchMock = jest.fn<typeof fetch>();
  const originalFetch = global.fetch;
  let cookies: any;

  beforeAll(async () => {
    await prisma.user.deleteMany({});
    await authService.createUser('admin@example.com', 'AdminPassword1', 'ADMIN');
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'AdminPassword1' });
    cookies = login.headers['set-cookie'];
  });

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
    delete process.env.OS_PLACES_API_KEY;
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('requires a session', async () => {
    const res = await request(app).get('/api/address-lookup/GU11AA');
    expect(res.status).toBe(401);
  });

  it('returns town and county for a known postcode', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        result: {
          postcode: 'GU1 1AA',
          admin_district: 'Guildford',
          admin_county: 'Surrey',
          region: 'South East',
        },
      })
    );

    const res = await request(app).get('/api/address-lookup/gu11aa').set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      postcode: 'GU1 1AA',
      city: 'Guildford',
      county: 'Surrey',
      addressesAvailable: false,
    });
  });

  it('maps a malformed postcode to 400, an unknown one to 404 and an outage to 502', async () => {
    expect((await request(app).get('/api/address-lookup/nope').set('Cookie', cookies)).status).toBe(
      400
    );

    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
    expect(
      (await request(app).get('/api/address-lookup/ZZ99ZZ').set('Cookie', cookies)).status
    ).toBe(404);

    fetchMock.mockRejectedValueOnce(new Error('down'));
    expect(
      (await request(app).get('/api/address-lookup/GU11AA').set('Cookie', cookies)).status
    ).toBe(502);
  });
});
