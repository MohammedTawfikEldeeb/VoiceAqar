import { Router } from 'express';
import { handleHealth } from '../controllers/health.controller.js';

const router = Router();

// Health route
router.get('/health', handleHealth);

export default router;
