import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import prisma from '../db/client.js';
import { CreateApiKeySchema } from '../../../shared/validation/index.js';

const router = Router();

// GET / — list keys for current user (exclude keyHash)
router.get('/', requireAuth, async (req, res) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { userId: req.user!.id },
      select: {
        id: true,
        userId: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const parsed = keys.map(k => ({ ...k, scopes: JSON.parse(k.scopes) }));
    return res.json({ success: true, keys: parsed });
  } catch (error) {
    console.error('List API keys error:', error);
    return res.status(500).json({ success: false, error: 'An error occurred while fetching API keys' });
  }
});

// POST / — create new key
router.post('/', requireAuth, async (req, res) => {
  try {
    const result = CreateApiKeySchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error.issues[0].message });
    }
    const { name, scopes, expiresAt } = result.data;

    const rawKey = 'chk_' + crypto.randomBytes(32).toString('base64url');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.slice(4, 12);

    const key = await prisma.apiKey.create({
      data: {
        userId: req.user!.id,
        name,
        keyHash,
        keyPrefix,
        scopes: JSON.stringify(scopes),
        expiresAt: new Date(expiresAt),
      },
      select: {
        id: true,
        userId: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    return res.status(201).json({
      success: true,
      key: { ...key, scopes: JSON.parse(key.scopes), rawKey },
    });
  } catch (error) {
    console.error('Create API key error:', error);
    return res.status(500).json({ success: false, error: 'An error occurred while creating API key' });
  }
});

// DELETE /:id — revoke key
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const key = await prisma.apiKey.findUnique({ where: { id } });
    if (!key || key.userId !== req.user!.id) {
      return res.status(404).json({ success: false, error: 'API key not found' });
    }

    await prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Revoke API key error:', error);
    return res.status(500).json({ success: false, error: 'An error occurred while revoking API key' });
  }
});

export default router;
