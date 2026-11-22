import bcrypt from 'bcrypt';
import crypto from 'crypto';
import prisma from '../db/client.js';
import { User } from '../../../shared/types/auth.types.js';
import { Role } from '../../../shared/types/user.types.js';
import { SALT_ROUNDS } from '../config/constants.js';

const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
/** Invites use the same token table, but people don't open them within the hour. */
export const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class AuthService {
  async createUser(email: string, password: string, role: Role = 'LANDLORD'): Promise<User> {
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role,
      },
    });

    return {
      id: user.id,
      email: user.email,
      role: user.role as Role,
    };
  }

  async validateCredentials(email: string, password: string): Promise<User | null> {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return null;
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role as Role,
    };
  }

  async getUserById(id: string): Promise<User | null> {
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role as Role,
    };
  }

  async isSetupRequired(): Promise<boolean> {
    const userCount = await prisma.user.count();
    return userCount === 0;
  }

  async createUserWithAutoRole(email: string, password: string): Promise<User> {
    return await prisma.$transaction(async (tx) => {
      const userCount = await tx.user.count();
      const role: Role = userCount === 0 ? 'ADMIN' : 'VIEWER';

      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      const user = await tx.user.create({
        data: { email, password: hashedPassword, role },
        select: { id: true, email: true, role: true },
      });

      return {
        id: user.id,
        email: user.email,
        role: user.role as Role,
      };
    });
  }

  async createPasswordResetToken(
    userId: string,
    ttlMs: number = PASSWORD_RESET_TOKEN_TTL_MS
  ): Promise<string> {
    await prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });

    return rawToken;
  }

  async redeemPasswordResetToken(rawToken: string, newPassword: string): Promise<boolean> {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date()) {
      return false;
    }

    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { password: hashedPassword },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return true;
  }
}

export default new AuthService();
