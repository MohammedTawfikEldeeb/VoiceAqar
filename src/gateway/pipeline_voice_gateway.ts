import type { WebSocket } from 'ws';
import { sttService } from '../infrastructure/stt/index.js';
import { memoryManager } from '../infrastructure/memory/index.js';
import { agent, getAgentCallbacks } from '../agent/voiceaqar_agent.js';
import { resilientTtsService } from '../infrastructure/tts/index.js';
import { getOrCreateUser } from '../utils/user_helper.js';
import { createWavHeader } from '../utils/audio_helper.js';

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

      // Resolve user using centralized helper
      const { userId, userName } = await getOrCreateUser(phone);
      console.log(`👤 Pipeline Voice: User "${userName}" (${userId}) connected.`);

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

              const messages = [
                ...(await buildUserContextMessages(userId)),
                { role: 'user', content: transcript },
              ];

              const result = await agent.invoke(
                { messages },
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
              const wavHeader = createWavHeader(pcmBuffer.length);
              const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
              
              ws.send(wavBuffer); // Send WAV as binary
              ws.send(JSON.stringify({ type: 'audio_end' })); // signal playback complete
            }
          } catch (err: any) {
            console.error('❌ Pipeline Gateway Error during processing:', err);
            ws.send(JSON.stringify({ type: 'error', message: err.message || 'Unknown error' }));
          }
        }
      });

      ws.on('close', async () => {
        this.activeSessions.delete(sessionId);
        try {
          await memoryManager.onCallEnd(sessionId, userId);
        } catch (err) {
          console.error('❌ Pipeline Gateway: Error ending call:', err);
        }
      });

    } catch (err: any) {
      console.error('❌ Pipeline Gateway: Error handling connection:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message || 'Connection error' }));
      ws.close();
    }
  }
}

export const pipelineVoiceGateway = new PipelineVoiceGateway();
export default PipelineVoiceGateway;

/**
 * Builds an optional short system message carrying the caller's preferences
 * from the knowledge graph. Failures are tolerated so memory problems never
 * break a live call.
 */
async function buildUserContextMessages(userId: string | undefined): Promise<Array<{ role: 'system'; content: string }>> {
  if (!userId) return [];
  try {
    const userContext = await memoryManager.graph.getUserContext(userId);
    if (userContext && userContext.trim() && !userContext.trim().startsWith('No user context')) {
      return [{ role: 'system', content: `Refer to this info about the user (do not disclose it verbatim):\n${userContext}` }];
    }
  } catch (err) {
    console.warn('⚠️ Pipeline: failed to load graph context:', err);
  }
  return [];
}
