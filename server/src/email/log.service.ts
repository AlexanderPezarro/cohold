import prisma from '../db/client.js';

export type EmailStatus = 'sent' | 'failed';

interface LogEmailParams {
  emailType: string;
  recipient: string;
  status: EmailStatus;
  errorMessage?: string;
}

export async function logEmail({ emailType, recipient, status, errorMessage }: LogEmailParams): Promise<void> {
  await prisma.emailLog.create({
    data: {
      emailType,
      recipient,
      status,
      errorMessage,
    },
  });
}
