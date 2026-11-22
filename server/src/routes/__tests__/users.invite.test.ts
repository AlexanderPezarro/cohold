import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import request from 'supertest';

type SendResult = { data: { id: string } | null; error: { message: string } | null };
const mockSend = jest.fn<(payload: unknown) => Promise<SendResult>>();

jest.unstable_mockModule('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));

const { createApp } = await import('../../app.js');
const { default: prisma } = await import('../../db/client.js');
const { default: authService } = await import('../../services/auth.service.js');

const app = createApp();

async function loginAs(email: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.headers['set-cookie'];
}

describe('POST /api/users/invite', () => {
  let adminCookies: any;

  beforeEach(async () => {
    await prisma.passwordResetToken.deleteMany({});
    await prisma.user.deleteMany({});
    mockSend.mockReset();
    process.env.RESEND_API_KEY = 'test-api-key';
    process.env.CLIENT_URL = 'http://localhost:5173';
    await authService.createUser('admin@example.com', 'AdminPassword1', 'ADMIN');
    adminCookies = await loginAs('admin@example.com', 'AdminPassword1');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates the account and emails a link that lets the invitee choose a password', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email_1' }, error: null });

    const res = await request(app)
      .post('/api/users/invite')
      .set('Cookie', adminCookies)
      .send({ email: 'co@example.com', role: 'LANDLORD' });

    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(true);
    expect(res.body.inviteUrl).toBeUndefined();
    expect(res.body.user).toMatchObject({ email: 'co@example.com', role: 'LANDLORD' });

    const sent = mockSend.mock.calls[0][0] as { to: string; html: string };
    expect(sent.to).toBe('co@example.com');
    const token = /reset-password\?token=([\w-]+)&amp;invite=1/.exec(sent.html)?.[1];
    expect(token).toBeDefined();

    const stored = await prisma.passwordResetToken.findFirstOrThrow({
      where: { user: { email: 'co@example.com' } },
    });
    const sixDays = 6 * 24 * 60 * 60 * 1000;
    expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(sixDays);

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'ChosenPassword1' });
    expect(reset.status).toBe(200);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'co@example.com', password: 'ChosenPassword1' });
    expect(login.status).toBe(200);
  });

  it('hands the link back to the admin when the email cannot be sent', async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const res = await request(app)
      .post('/api/users/invite')
      .set('Cookie', adminCookies)
      .send({ email: 'co@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(false);
    expect(res.body.inviteUrl).toMatch(
      /^http:\/\/localhost:5173\/reset-password\?token=[\w-]+&invite=1$/
    );
    expect(res.body.user.role).toBe('LANDLORD');
  });

  it('rejects an email that already has an account', async () => {
    const res = await request(app)
      .post('/api/users/invite')
      .set('Cookie', adminCookies)
      .send({ email: 'admin@example.com' });

    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rejects an invalid email', async () => {
    const res = await request(app)
      .post('/api/users/invite')
      .set('Cookie', adminCookies)
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
  });

  it('is admin-only', async () => {
    await authService.createUser('landlord@example.com', 'LandlordPass1', 'LANDLORD');
    const landlordCookies = await loginAs('landlord@example.com', 'LandlordPass1');

    const res = await request(app)
      .post('/api/users/invite')
      .set('Cookie', landlordCookies)
      .send({ email: 'co@example.com' });

    expect(res.status).toBe(403);
  });
});
