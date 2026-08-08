import type { WebSocket } from 'ws';
import crypto from 'node:crypto';
import { db } from '../config/db.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { sttService } from '../infrastructure/stt/index.js';
import { memoryManager } from '../infrastructure/memory/index.js';
import { agent, getAgentCallbacks } from '../agent/voiceaqar_agent.js';
import { resilientTtsService } from '../infrastructure/tts/index.js';

export class PipelineVoiceGateway {
  activeSessions = new Set<string>();

  async handleConnection(ws: WebSocket, url: URL) {
    try {
      const phone = url.searchParams.get('phone');
      if (!phone) {
        ws.send(JSON.stringify({ type: 'error', message: 'Missing phone parameter' }));
        ws.close();
        return;
      }

      // Look up/register user
      let userId: string;
      const existingUser = await db.select().from(users).where(eq(users.phoneNumber, phone)).limit(1);
      
      if (existingUser.length > 0) {
        userId = existingUser[0].userId;
      } else {
        userId = `usr_${crypto.randomUUID()}`;
        await db.insert(users).values({
          userId,
          phoneNumber: phone,
        });
      }

      const sessionId = `pipeline_${Date.now()}`;
      this.activeSessions.add(sessionId);

      await memoryManager.onCallStart(sessionId, userId);
      ws.send(JSON.stringify({ type: 'status', status: 'ready' }));

      let audioChunks: Buffer[] = [];

      ws.on('message', async (data: Buffer | string, isBinary: boolean) => {
        if (isBinary) {
          audioChunks.push(data as Buffer);
        } else {
          try {
            const message = JSON.parse(data.toString());
            if (message.type === 'audio_end') {
              if (audioChunks.length === 0) return;

              // 1. Concatenate audio buffers
              const audioBuffer = Buffer.concat(audioChunks);
              audioChunks = []; // reset for next turn

              // 2. STT
              console.log(`🎤 STT: Transcribing ${audioBuffer.length} bytes of audio...`);
              const transcript = await sttService.transcribe(audioBuffer, 'audio/webm');
              ws.send(JSON.stringify({ type: 'transcript', text: transcript }));

              // 3. Agent invoke
              console.log(`🤖 Agent: Invoking agent with transcript: "${transcript}"`);
              await memoryManager.onUserMessage(sessionId, transcript, userId);
              const result = await agent.invoke(
                { messages: [{ role: 'user', content: transcript }] },
                { configurable: { thread_id: sessionId }, callbacks: getAgentCallbacks() }
              );
              
              const lastMessage = result.messages[result.messages.length - 1];
              const replyText = typeof lastMessage.content === 'string' 
                ? lastMessage.content 
                : JSON.stringify(lastMessage.content);
                
              await memoryManager.onAgentResponse(sessionId, replyText);
              ws.send(JSON.stringify({ type: 'reply_text', text: replyText }));

              // 4. TTS
              console.log(`🔊 TTS: Synthesizing reply: "${replyText}"`);
              const pcmBuffer = await resilientTtsService.synthesize(replyText);
              const wavHeader = this.createWavHeader(pcmBuffer.length);
              const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
              
              ws.send(wavBuffer); // Send WAV as binary
              ws.send(JSON.stringify({ type: 'audio_end' })); // signal playback complete
            }
          } catch (err: any) {
            console.error('Error during pipeline execution:', err);
            ws.send(JSON.stringify({ type: 'error', message: err.message || 'Unknown error' }));
          }
        }
      });

      ws.on('close', async () => {
        this.activeSessions.delete(sessionId);
        try {
          await memoryManager.onCallEnd(sessionId, userId);
        } catch (err) {
          console.error('Error ending call:', err);
        }
      });

    } catch (err: any) {
      console.error('Error handling connection:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message || 'Connection error' }));
      ws.close();
    }
  }

  private createWavHeader(dataLength: number, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
    header.writeUInt16LE(channels * bitsPerSample / 8, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);
    return header;
  }
}

export const pipelineVoiceGateway = new PipelineVoiceGateway();
