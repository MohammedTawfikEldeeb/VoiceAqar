import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { env } from './config/env.js';
import { agent, initializeAgent, getAgentCallbacks } from './agent/voiceaqar_agent.js';
import { memoryManager } from './infrastructure/memory/index.js';
import { db } from './config/db.js';
import { users } from './db/schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import { GeminiLiveGateway } from './gateway/gemini_live_gateway.js';
import { PipelineVoiceGateway } from './gateway/pipeline_voice_gateway.js';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve static assets (AudioWorklet processor, etc.)
app.use('/public', express.static(path.resolve('public')));

const activeSessions = new Set<string>();

// --- Page Routes ---

app.get('/chat', (req, res) => {
  res.sendFile(path.resolve('test_text_client.html'));
});

app.get('/voice', (req, res) => {
  res.sendFile(path.resolve('test_voice_client.html'));
});

// --- API Routes ---

app.post('/api/chat', async (req, res) => {
  try {
    const { message, phoneNumber, sessionId } = req.body;
    const activeSessionId = sessionId || `sess_${Date.now()}`;
    const activePhone = phoneNumber || 'unknown_phone';

    let activeUserId = '';
    let userName = 'anonymous';

    const foundUsers = await db.select().from(users).where(eq(users.phoneNumber, activePhone)).limit(1);
    if (foundUsers.length > 0) {
      activeUserId = foundUsers[0].userId;
      userName = foundUsers[0].name || 'anonymous';
      console.log(` Recognized existing user for phone ${activePhone}: "${userName}" (ID: ${activeUserId})`);
    } else {
      activeUserId = `usr_${crypto.randomUUID()}`;
      await db.insert(users).values({
        userId: activeUserId,
        phoneNumber: activePhone,
      });
      console.log(` Registered new user for phone ${activePhone} (ID: ${activeUserId})`);
    }

    if (!activeSessions.has(activeSessionId)) {
      activeSessions.add(activeSessionId);
      await memoryManager.onCallStart(activeSessionId, activeUserId);
    }

    await memoryManager.onUserMessage(activeSessionId, message, activeUserId);

    const result = await agent.invoke(
      {
        messages: [{ role: 'user', content: message }]
      },
      {
        configurable: { thread_id: activeSessionId },
        callbacks: getAgentCallbacks()
      }
    );

    const lastMessage = result.messages[result.messages.length - 1];
    const reply = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

    await memoryManager.onAgentResponse(activeSessionId, reply);

    res.json({ reply, sessionId: activeSessionId, userId: activeUserId, name: userName });
  } catch (error: any) {
    console.error(' Error in /api/chat:', error);
    res.status(500).json({ error: error.message || String(error) });
  }
});

app.post('/api/chat/end', async (req, res) => {
  try {
    const { sessionId, userId } = req.body;
    if (sessionId) {
      activeSessions.delete(sessionId);
      await memoryManager.onCallEnd(sessionId, userId || 'anonymous');
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'VoiceAqar Server is running' });
});

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