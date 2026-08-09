import { Router } from 'express';
import { serveVoicePage } from '../controllers/voice.controller.js';

const router = Router();

// Page routes
router.get('/voice', serveVoicePage);

export default router;
