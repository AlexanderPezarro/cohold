import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  InvalidPostcodeError,
  PostcodeNotFoundError,
  lookupPostcode,
} from '../services/addressLookup.service.js';

const router = Router();

// GET /api/address-lookup/:postcode - Town, county and (if configured) addresses
router.get('/:postcode', requireAuth, async (req, res) => {
  try {
    const result = await lookupPostcode(req.params.postcode);
    return res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof InvalidPostcodeError) {
      return res.status(400).json({ success: false, error: error.message });
    }
    if (error instanceof PostcodeNotFoundError) {
      return res.status(404).json({ success: false, error: error.message });
    }
    console.error('Postcode lookup error:', error);
    return res.status(502).json({
      success: false,
      error: 'Postcode lookup is unavailable right now — enter the address by hand',
    });
  }
});

export default router;
