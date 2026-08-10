import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { env } from './config/env.js';
import { initializeAgent } from './agent/voiceaqar_agent.js';
import { GeminiLiveGateway } from './gateway/gemini_live_gateway.js';
import { TwilioGateway } from './gateway/twilio_gateway.js';
import chatRouter from './routes/chat.routes.js';
import voiceRouter from './routes/voice.routes.js';
import healthRouter from './routes/health.routes.js';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve static assets (AudioWorklet processor, etc.)
app.use('/public', express.static(path.resolve('public')));

// Mount routes from the MVC systems
app.use(chatRouter);
app.use(voiceRouter);
app.use(healthRouter);

// --- HTTP + WebSocket Server ---
const server = createServer(app);

// Initialize voice gateways for Gemini Live
const geminiLiveGateway = new GeminiLiveGateway();
const twilioGateway = new TwilioGateway();

// Attach WebSocket server
const wss = new WebSocketServer({ server });

// Simple in-memory WebSocket connection rate limiter for security (max 10 active connections per IP)
const ipConnectionCounts = new Map<string, number>();

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || 'unknown-ip';
  const currentCount = ipConnectionCounts.get(ip) || 0;

  if (currentCount >= 15) {
    console.warn(`⚠️ WebSocket connection rate limited for IP: ${ip}`);
    ws.close(4029, 'Too many concurrent connections from this IP');
    return;
  }

  // Track the active connection
  ipConnectionCounts.set(ip, currentCount + 1);
  ws.on('close', () => {
    const count = ipConnectionCounts.get(ip) || 1;
    if (count <= 1) {
      ipConnectionCounts.delete(ip);
    } else {
      ipConnectionCounts.set(ip, count - 1);
    }
  });

  const url = new URL(req.url!, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Enforce access token authorization on WebSockets if configured (dev bypass if empty)
  if (env.WSS_ACCESS_TOKEN && pathname !== '/ws/twilio') {
    const token = url.searchParams.get('access_token');
    if (!token || token !== env.WSS_ACCESS_TOKEN) {
      console.warn(`⚠️ WebSocket connection rejected for IP ${ip}: Invalid or missing access_token`);
      ws.close(4003, 'Unauthorized access token required');
      return;
    }
  }

  // Route incoming connection to Gemini Live gateways
  if (pathname === '/ws/voice-live') {
    console.log('🎤 New Gemini Live voice connection');
    geminiLiveGateway.handleConnection(ws, url);
  } else if (pathname === '/ws/twilio') {
    console.log('🎤 New Gemini Twilio Stream voice connection');
    twilioGateway.handleConnection(ws, url);
  } else {
    console.warn(`⚠️ Unknown or disabled WebSocket path: ${pathname}`);
    ws.close(4004, 'Unknown path');
  }
});

const PORT = env.PORT || 3000;

server.listen(PORT, async () => {
  try {
    console.log(` VoiceAqar server starting on port ${PORT}...`);
    console.log(' Initializing agent schemas and memory stores...');
    await initializeAgent();
    console.log(`🎙️ Voice Provider: ${env.VOICE_PROVIDER.toUpperCase()}`);
    console.log(`  ⚡ Web Voice Client: ws://localhost:${PORT}/ws/voice-live`);
    console.log(`  📞 Twilio Stream:    ws://localhost:${PORT}/ws/twilio`);
    console.log(`📝 Text chat:          http://localhost:${PORT}/chat`);
    console.log(`🎤 Voice chat:         http://localhost:${PORT}/voice`);
    console.log(' Initialization complete. Server is ready to receive calls, voice streams, and chat messages!');
  } catch (err) {
    console.error(' Failed to initialize VoiceAqar backend:', err);
  }
});