import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { createElement } from 'react';
import prisma from '../../db/client.js';

type SendResult = { data: { id: string } | null; error: { message: string } | null };

const mockSend = jest.fn<(payload: unknown) => Promise<SendResult>>();

jest.unstable_mockModule('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

const { sendEmail } = await import('../service.js');
const { PasswordResetEmail } = await import('../templates/PasswordResetEmail.js');

describe('email service', () => {
  const template = createElement(PasswordResetEmail, { resetUrl: 'http://localhost:5173/reset-password?token=abc' });

  beforeAll(async () => {
    await prisma.emailLog.deleteMany({});
  });

  afterAll(async () => {
    await prisma.emailLog.deleteMany({});
  });

  beforeEach(async () => {
    await prisma.emailLog.deleteMany({});
    mockSend.mockReset();
    process.env.RESEND_API_KEY = 'test-api-key';
  });

  it('logs a sent row and calls resend when the send succeeds', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email_123' }, error: null });

    await sendEmail('password_reset', 'user@example.com', 'Reset your password', template);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [payload] = mockSend.mock.calls[0] as [Record<string, unknown>];
    expect(payload.to).toBe('user@example.com');
    expect(payload.subject).toBe('Reset your password');
    expect(typeof payload.html).toBe('string');
    expect(typeof payload.text).toBe('string');

    const logs = await prisma.emailLog.findMany({ where: { recipient: 'user@example.com' } });
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('sent');
    expect(logs[0].emailType).toBe('password_reset');
    expect(logs[0].errorMessage).toBeNull();
  });

  it('logs a failed row with the error message when resend returns an error', async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: 'Invalid API key' } });

    await sendEmail('password_reset', 'fails@example.com', 'Reset your password', template);

    const logs = await prisma.emailLog.findMany({ where: { recipient: 'fails@example.com' } });
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('failed');
    expect(logs[0].errorMessage).toBe('Invalid API key');
  });

  it('logs a failed row with the error message when resend throws', async () => {
    mockSend.mockRejectedValue(new Error('network unreachable'));

    await sendEmail('password_reset', 'throws@example.com', 'Reset your password', template);

    const logs = await prisma.emailLog.findMany({ where: { recipient: 'throws@example.com' } });
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('failed');
    expect(logs[0].errorMessage).toBe('network unreachable');
  });

  it('logs a failed row when RESEND_API_KEY is not configured', async () => {
    delete process.env.RESEND_API_KEY;

    await sendEmail('password_reset', 'nokey@example.com', 'Reset your password', template);

    expect(mockSend).not.toHaveBeenCalled();

    const logs = await prisma.emailLog.findMany({ where: { recipient: 'nokey@example.com' } });
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('failed');
    expect(logs[0].errorMessage).toBe('RESEND_API_KEY is not configured');
  });
});
