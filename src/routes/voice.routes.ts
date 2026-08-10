import { Router } from 'express';
import twilio from 'twilio';
import { serveVoicePage, handleTwilioIncomingCall } from '../controllers/voice.controller.js';
import { env } from '../config/env.js';

const router = Router();

// Twilio signature validation middleware
const twilioValidator = (req: any, res: any, next: any) => {
  if (env.TWILIO_AUTH_TOKEN) {
    // Standard Twilio Express webhook validator middleware
    return twilio.webhook({
      authToken: env.TWILIO_AUTH_TOKEN,
      // If host contains port (like localhost:3000), specify custom url if needed,
      // but Twilio's webhook middleware resolves this natively in most deployment configurations.
    })(req, res, next);
  }
  
  console.warn('⚠️ Twilio Security Warning: TWILIO_AUTH_TOKEN is not configured. Webhook signature validation skipped (allow in dev)!');
  next();
};

// Page routes
router.get('/voice', serveVoicePage);

// Twilio voice webhook - secured with signature validation middleware in production
router.post('/api/twilio/voice', twilioValidator, handleTwilioIncomingCall);

export default router;
