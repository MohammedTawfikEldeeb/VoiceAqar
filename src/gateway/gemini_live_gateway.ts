import type { WebSocket } from 'ws';
import { memoryManager } from '../infrastructure/memory/index.js';
import { getOrCreateUser } from '../utils/user_helper.js';
import { pickRandomPersonality } from '../config/personalities.js';
import { VoiceSession } from './voice_session.js';

export class GeminiLiveGateway {
  async handleConnection(ws: WebSocket, url: URL) {
    const startTime = Date.now();
    const phone = url.searchParams.get('phone');
    if (!phone) {
      ws.send(JSON.stringify({ type: 'error', message: 'Phone number is required' }));
      ws.close();
      return;
    }

    console.log(`[0ms] Call started`);

    try {
      // --- User lookup/registration via centralized helper ---
      const { userId, userName } = await getOrCreateUser(phone);
      
      const elapsed1 = Date.now() - startTime;
      console.log(`[+${elapsed1}ms] Backend received request (User: ${userName})`);

      // --- Session + Memory ---
      const sessionId = `live_${Date.now()}`;
      await memoryManager.onCallStart(sessionId, userId);

      // --- Random personality per call (voice + persona) ---
      const personality = pickRandomPersonality();

      const { systemPrompt } = await memoryManager.getAgentContext(sessionId, userId, personality.personality);

      const elapsed2 = Date.now() - startTime;
      console.log(`[+${elapsed2}ms] User context loaded`);

      // --- Shared voice session (connect + tools + memory + Opik) ---
      const voice = new VoiceSession({
        sessionId,
        userId,
        userName,
        phone,
        systemPrompt,
        voiceName: personality.voice,
        traceName: 'Gemini Live Session',
        sessionStartTime: startTime,
        handlers: {
          onOpen: () => {
            ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
          },
          onAudio: (audioBuffer) => {
            if (ws.readyState === 1) {
              ws.send(audioBuffer);
            }
          },
          onError: (message) => {
            try {
              ws.send(JSON.stringify({ type: 'error', message }));
            } catch {}
          },
        },
      });

      await voice.connect();
      voice.triggerGreeting();

      // --- Forward browser PCM audio to Gemini ---
      ws.on('message', (data: Buffer) => {
        try {
          voice.sendAudioInput(Buffer.from(data).toString('base64'));
        } catch (err) {
          console.error(' Error forwarding audio to Gemini:', err);
        }
      });

      // --- Cleanup on disconnect ---
      ws.on('close', async () => {
        console.log(' Gemini Live client disconnected');
        await voice.close();
        try {
          await memoryManager.onCallEnd(sessionId, userId);
        } catch (err) {
          console.error('Error ending call:', err);
        }
      });

      ws.on('error', (err) => {
        console.error(' WebSocket error:', err);
      });
    } catch (err: any) {
      console.error(' Gemini Live Gateway: Connection handler error:', err);
      try {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'error', message: err?.message || 'Internal error' }));
        }
      } catch {}
      ws.close();
    }
  }
}

export const geminiLiveGateway = new GeminiLiveGateway();
export default GeminiLiveGateway;