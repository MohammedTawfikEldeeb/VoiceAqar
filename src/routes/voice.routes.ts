import { Router } from 'express';
import { serveVoicePage, handleTwilioIncomingCall } from '../controllers/voice.controller.js';

const router = Router();

// Page routes
router.get('/voice', serveVoicePage);

// Twilio voice webhook
router.post('/api/twilio/voice', handleTwilioIncomingCall);

export default router;
