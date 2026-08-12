import type { WebSocket } from 'ws';
import { memoryManager } from '../infrastructure/memory/index.js';
import { getOrCreateUser } from '../utils/user_helper.js';
import { pickRandomPersonality } from '../config/personalities.js';
import { decodeMuLaw, encodeMuLaw, resample8To16, resample24To8 } from '../utils/audio_helper.js';
import { VoiceSession } from './voice_session.js';

export class TwilioGateway {
  async handleConnection(ws: WebSocket, url: URL) {
    const phone = url.searchParams.get('phone') || 'unknown_twilio';
    console.log(`📞 Twilio Gateway: New call stream connection for phone ${phone}`);

    try {
      // --- User lookup/registration via centralized helper ---
      const { userId, userName } = await getOrCreateUser(phone);
      console.log(`👤 Twilio: Recognized user "${userName}" (${userId})`);

      const sessionId = `twilio_${Date.now()}`;
      await memoryManager.onCallStart(sessionId, userId);

      // --- Random personality per call (voice + persona) ---
      const personality = pickRandomPersonality();
      console.log(`🎭 Twilio: Assigned personality "${personality.name}" (voice: ${personality.voice})`);

      const { systemPrompt } = await memoryManager.getAgentContext(sessionId, userId, personality.personality);

      let streamSid = '';

      // --- Shared voice session (connect + tools + memory + Opik) ---
      const voice = new VoiceSession({
        sessionId,
        userId,
        userName,
        phone,
        systemPrompt,
        voiceName: personality.voice,
        traceName: 'Twilio Live Session',
        handlers: {
          onAudio: (audioBuffer24k) => {
            // Resample: 24kHz PCM -> 8kHz PCM, encode to Mulaw, send to Twilio
            const audioBuffer8k = resample24To8(audioBuffer24k);
            const mulawBuffer = encodeMuLaw(audioBuffer8k);
            if (ws.readyState === 1 && streamSid) {
              ws.send(
                JSON.stringify({
                  event: 'media',
                  streamSid,
                  media: { payload: mulawBuffer.toString('base64') },
                })
              );
            }
          },
        },
      });

      await voice.connect();

      // --- Process incoming Twilio WebSocket messages ---
      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message);

          if (data.event === 'start') {
            streamSid = data.streamSid;
            console.log(`🎬 Twilio: Audio stream started with streamSid: ${streamSid}`);
          } else if (data.event === 'media') {
            // Decode: 8kHz Mulaw -> 8kHz PCM -> 16kHz PCM for Gemini Live
            const mulawBuffer = Buffer.from(data.media.payload, 'base64');
            const pcmBuffer8k = decodeMuLaw(mulawBuffer);
            const pcmBuffer16k = resample8To16(pcmBuffer8k);
            voice.sendAudioInput(pcmBuffer16k.toString('base64'));
          } else if (data.event === 'stop') {
            console.log('Twilio: Audio stream stopped');
          }
        } catch (err) {
          console.error('❌ Twilio Gateway: Error processing Twilio message:', err);
        }
      });

      // --- Cleanup on disconnect ---
      ws.on('close', async () => {
        console.log('🔴 Twilio client disconnected');
        await voice.close();
        try {
          await memoryManager.onCallEnd(sessionId, userId);
        } catch (err) {
          console.error('Error ending call:', err);
        }
      });

      ws.on('error', (err) => {
        console.error('❌ Twilio WebSocket error:', err);
      });
    } catch (err: any) {
      console.error('❌ Twilio Gateway: Connection handler error:', err);
      try {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'error', message: err?.message || 'Internal error' }));
        }
      } catch {}
      ws.close();
    }
  }
}

export default TwilioGateway;