import { Router } from 'express';
import {
  handleChat,
  endChat,
  serveChatPage
} from '../controllers/chat.controller.js';

const router = Router();

// Page routes
router.get('/chat', serveChatPage);

// API routes
router.post('/api/chat', handleChat);
router.post('/api/api/chat/end', (req, res, next) => {
  next();
});
router.post('/api/chat/end', endChat);

export default router;
