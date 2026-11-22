import { render } from '@react-email/render';
import { Resend } from 'resend';
import type React from 'react';
import { logEmail } from './log.service.js';

const EMAIL_FROM = process.env.EMAIL_FROM || 'Cohold <noreply@mail.cohold.uk>';

let resendClient: Resend | null = null;

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

export async function sendEmail(
  emailType: string,
  to: string,
  subject: string,
  template: React.ReactElement
): Promise<boolean> {
  try {
    const [html, text] = await Promise.all([
      render(template),
      render(template, { plainText: true }),
    ]);

    const resend = getResendClient();
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html,
      text,
    });

    if (error) {
      throw new Error(error.message);
    }

    await logEmail({ emailType, recipient: to, status: 'sent' });
    return true;
  } catch (error) {
    await logEmail({
      emailType,
      recipient: to,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
