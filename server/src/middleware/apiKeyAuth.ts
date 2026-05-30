import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../db/client.js';

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer chk_')) {
    return next();
  }

  const rawKey = authHeader.slice('Bearer '.length);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  try {
    const key = await prisma.apiKey.findUnique({ where: { keyHash } });
    if (!key) {
      res.status(401).json({ success: false, error: 'Invalid API key' });
      return;
    }
    if (key.revokedAt !== null) {
      res.status(401).json({ success: false, error: 'API key has been revoked' });
      return;
    }
    if (key.expiresAt < new Date()) {
      res.status(401).json({ success: false, error: 'API key has expired' });
      return;
    }

    req.apiKey = {
      id: key.id,
      userId: key.userId,
      scopes: JSON.parse(key.scopes),
    };

    // Fire-and-forget lastUsedAt update
    prisma.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});
  } catch {
    res.status(500).json({ success: false, error: 'Authentication error' });
    return;
  }

  next();
}
