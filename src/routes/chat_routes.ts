import { Router } from 'express';
import {
  handleChat,
  endChat,
  serveChatPage,
  serveVoicePage,
  handleHealth
} from '../controllers/chat.controller.js';

const router = Router();

// Page routes
router.get('/chat', serveChatPage);
router.get('/voice', serveVoicePage);

// API routes
router.post('/api/chat', handleChat);
router.post('/api/api/chat/end', (req, res, next) => {
  // Support both /api/chat/end and /api/api/chat/end if client has relative/absolute path variations
  next();
});
router.post('/api/chat/end', endChat);
router.get('/health', handleHealth);

export default router;
