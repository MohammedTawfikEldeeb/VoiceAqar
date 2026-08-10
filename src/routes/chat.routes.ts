import { Router } from 'express';
import {
  handleChat,
  endChat,
  serveChatPage
} from '../controllers/chat.controller.js';
import { requireApiToken, createRateLimiter } from '../utils/auth.js';

const router = Router();

// Chat API endpoints rate limiter (60 requests per 10 minutes)
const apiRateLimiter = createRateLimiter(10 * 60 * 1000, 60, 'Too many chat requests. Please try again later.');

// Page routes (unauthenticated)
router.get('/chat', serveChatPage);

// API routes (secured with token authorization and rate limiting)
router.post('/api/chat', requireApiToken, apiRateLimiter, handleChat);
router.post('/api/api/chat/end', requireApiToken, endChat);
router.post('/api/chat/end', requireApiToken, endChat);

export default router;