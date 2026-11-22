import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/permissions.js';
import prisma from '../db/client.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { createElement } from 'react';
import { z } from 'zod';
import { SALT_ROUNDS } from '../config/constants.js';
import {
  CreateUserSchema,
  InviteUserSchema,
  UpdateUserRoleSchema,
} from '../../../shared/validation/index.js';
import authService, { INVITE_TOKEN_TTL_MS } from '../services/auth.service.js';
import { sendEmail } from '../email/service.js';
import { InviteEmail } from '../email/templates/InviteEmail.js';

const router = Router();

// GET /api/users - List all users
router.get('/', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ success: true, users });
  } catch (error) {
    console.error('Get users error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while fetching users',
    });
  }
});

// POST /api/users - Create new user
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = CreateUserSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error.issues[0].message });
    }
    const { email, password, role } = result.data;

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Email already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, role },
      select: { id: true, email: true, role: true, createdAt: true },
    });
    return res.status(201).json({ success: true, user });
  } catch (error) {
    console.error('Create user error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while creating user',
    });
  }
});

// POST /api/users/invite - Create an account and email a link to choose a password
router.post('/invite', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = InviteUserSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error.issues[0].message });
    }
    const { email, role } = result.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Email already in use' });
    }

    // Nobody knows this password; the account is only usable once the invitee
    // sets their own from the link.
    const unusablePassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), SALT_ROUNDS);
    const user = await prisma.user.create({
      data: { email, password: unusablePassword, role },
      select: { id: true, email: true, role: true, createdAt: true },
    });

    const rawToken = await authService.createPasswordResetToken(user.id, INVITE_TOKEN_TTL_MS);
    const inviteUrl = `${process.env.CLIENT_URL}/reset-password?token=${rawToken}&invite=1`;

    const inviter = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { email: true },
    });
    const emailSent = await sendEmail(
      'user_invite',
      email,
      'You have been invited to Cohold',
      createElement(InviteEmail, {
        inviteUrl,
        invitedBy: inviter?.email ?? 'A co-owner',
      })
    );

    // The link goes back to the admin only when the email didn't go out (e.g. no
    // RESEND_API_KEY on a self-hosted install), so they can pass it on themselves.
    return res.status(201).json({
      success: true,
      user,
      emailSent,
      ...(emailSent ? {} : { inviteUrl }),
    });
  } catch (error) {
    console.error('Invite user error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while inviting user',
    });
  }
});

// DELETE /api/users/:id - Delete user
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID format',
      });
    }

    // Prevent self-delete
    if (req.session.userId === id) {
      return res.status(400).json({ success: false, error: 'Cannot delete yourself' });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    await prisma.user.delete({ where: { id } });
    return res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    console.error('Delete user error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while deleting user',
    });
  }
});

// PUT /api/users/:id/role - Change user role
router.put('/:id/role', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID format',
      });
    }

    // Validate role
    const result = UpdateUserRoleSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error.issues[0].message,
      });
    }
    const { role } = result.data;

    if (req.session.userId === id) {
      return res.status(403).json({
        success: false,
        error: 'Cannot change your own role',
      });
    }

    const currentUser = await prisma.user.findUnique({ where: { id } });
    if (!currentUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    if (currentUser.role === 'ADMIN' && role !== 'ADMIN') {
      const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
      if (adminCount <= 1) {
        return res.status(400).json({
          success: false,
          error: 'Cannot remove last admin',
        });
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: { role },
    });

    return res.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error('Change user role error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while changing user role',
    });
  }
});

export default router;
