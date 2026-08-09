import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { env } from './config/env.js';
import { initializeAgent } from './agent/voiceaqar_agent.js';
import { GeminiLiveGateway } from './gateway/gemini_live_gateway.js';
import { PipelineVoiceGateway } from './gateway/pipeline_voice_gateway.js';
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

// Initialize voice gateways
const geminiLiveGateway = new GeminiLiveGateway();
const pipelineGateway = new PipelineVoiceGateway();

// Attach WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/ws/voice-live' && ['live', 'both'].includes(env.VOICE_MODE)) {
    console.log('🎤 New Gemini Live voice connection');
    geminiLiveGateway.handleConnection(ws, url);
  } else if (pathname === '/ws/voice-pipeline' && ['pipeline', 'both'].includes(env.VOICE_MODE)) {
    console.log('🎤 New Pipeline voice connection');
    pipelineGateway.handleConnection(ws, url);
  } else {
    console.warn(`⚠️ Unknown WebSocket path: ${pathname}`);
    ws.close(4004, 'Unknown path or mode disabled');
  }
});

const PORT = env.PORT || 3000;

server.listen(PORT, async () => {
  try {
    console.log(` VoiceAqar server starting on port ${PORT}...`);
    console.log(' Initializing agent schemas and memory stores...');
    await initializeAgent();
    console.log(`🎙️ Voice mode: ${env.VOICE_MODE}`);
    if (['live', 'both'].includes(env.VOICE_MODE)) {
      console.log(`  ⚡ Gemini Live: ws://localhost:${PORT}/ws/voice-live`);
    }
    if (['pipeline', 'both'].includes(env.VOICE_MODE)) {
      console.log(`  🔄 Pipeline:    ws://localhost:${PORT}/ws/voice-pipeline`);
    }
    console.log(`📝 Text chat:    http://localhost:${PORT}/chat`);
    console.log(`🎤 Voice chat:   http://localhost:${PORT}/voice`);
    console.log(' Initialization complete. Server is ready to receive calls, voice streams, and chat messages!');
  } catch (err) {
    console.error(' Failed to initialize VoiceAqar backend:', err);
  }
});