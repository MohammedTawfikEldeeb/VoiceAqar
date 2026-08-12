import { GoogleGenAI, Modality } from '@google/genai';
import { Opik } from 'opik';
import { env } from '../config/env.js';
import { memoryManager } from '../infrastructure/memory/index.js';
import { functionDeclarations, executeToolCall } from '../tools/registry.js';

export interface VoiceSessionHandlers {
  /** Called once the Gemini Live session is open. */
  onOpen?: () => void;
  /** Called for each audio chunk returned by Gemini (raw 24kHz PCM). */
  onAudio?: (audioBuffer: Buffer) => void;
  /** Called for each text transcript chunk of the agent response. */
  onTextChunk?: (text: string) => void;
  /** Called when a full agent turn is complete. */
  onTurnComplete?: (fullText: string) => void;
  /** Called on a session error. */
  onError?: (message: string) => void;
  /** Called when the session closes. */
  onClose?: (reason: string) => void;
}

/**
 * Shared voice session around Gemini Live.
 *
 * Owns everything that is identical across channels (web + Twilio):
 * - Gemini Live connect with the shared system prompt and auto-generated tools
 * - message parsing (audio / transcript / tool calls)
 * - centralized tool execution + memory + Opik tracing
 *
 * Channels only provide transport-specific audio plumbing via handlers.
 */
export class VoiceSession {
  private ai: GoogleGenAI;
  private session: any;
  private trace: any = null;
  private currentAgentResponse = '';
  private closed = false;

  constructor(
    private readonly opts: {
      sessionId: string;
      userId: string;
      userName: string;
      phone: string;
      systemPrompt: string;
      voiceName?: string;
      traceName: string;
      handlers: VoiceSessionHandlers;
    }
  ) {
    this.ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }

  private initOpikTrace() {
    if (!env.OPIK_API_KEY) return;
    try {
      process.env.OPIK_API_KEY = env.OPIK_API_KEY;
      if (env.OPIK_WORKSPACE) process.env.OPIK_WORKSPACE = env.OPIK_WORKSPACE;
      process.env.OPIK_PROJECT_NAME = env.OPIK_PROJECT_NAME;
      const opik = new Opik();
      this.trace = opik.trace({
        name: this.opts.traceName,
        input: {
          phone: this.opts.phone,
          sessionId: this.opts.sessionId,
          userId: this.opts.userId,
          userName: this.opts.userName,
          userPreferences: this.opts.systemPrompt.includes('User Preferences:')
            ? this.opts.systemPrompt.substring(this.opts.systemPrompt.indexOf('User Preferences:'))
            : 'None',
        },
      });
      console.log(` Opik: Started ${this.opts.traceName} trace for session ${this.opts.sessionId}`);
    } catch (err) {
      console.error(' Failed to initialize Opik trace:', err);
    }
  }

  private async handleMessage(message: any) {
    try {
      // --- Model turn: audio + text transcript chunks ---
      if (message.serverContent?.modelTurn?.parts) {
        for (const part of message.serverContent.modelTurn.parts) {
          if (part.inlineData?.mimeType?.startsWith('audio/')) {
            const audioBuffer = Buffer.from(part.inlineData.data, 'base64');
            this.opts.handlers.onAudio?.(audioBuffer);
          }
          if (part.text) {
            this.currentAgentResponse += part.text;
            this.opts.handlers.onTextChunk?.(part.text);
          }
        }
      }

      // --- Turn complete: flush the accumulated agent response ---
      if (message.serverContent?.turnComplete) {
        if (this.currentAgentResponse) {
          console.log(` Full agent response: "${this.currentAgentResponse}"`);
          await memoryManager.onAgentResponse(this.opts.sessionId, this.currentAgentResponse);
          if (this.trace) {
            try {
              const span = this.trace.span({ name: 'agent_response', type: 'llm', input: { context: 'voice turn response' } });
              span.update({ output: { text: this.currentAgentResponse } });
              span.end();
            } catch (opikErr) {
              console.error(' Opik span logging failed:', opikErr);
            }
          }
          this.opts.handlers.onTurnComplete?.(this.currentAgentResponse);
          this.currentAgentResponse = '';
        }
      }

      // --- User transcript (client content) ---
      if (message.serverContent?.clientContent?.parts) {
        for (const part of message.serverContent.clientContent.parts) {
          if (part.text) {
            console.log(` User transcript: "${part.text}"`);
            await memoryManager.onUserMessage(this.opts.sessionId, part.text, this.opts.userId);
            if (this.trace) {
              try {
                const span = this.trace.span({ name: 'user_speech', type: 'general', input: { text: part.text } });
                span.end();
              } catch (opikErr) {
                console.error(' Opik span logging failed:', opikErr);
              }
            }
          }
        }
      }

      // --- Tool calls: dispatch through the shared registry ---
      if (message.toolCall) {
        for (const call of message.toolCall.functionCalls) {
          console.log(` Tool call: ${call.name}(${JSON.stringify(call.args)})`);
          let toolSpan: any = null;
          if (this.trace) {
            try {
              toolSpan = this.trace.span({ name: `tool:${call.name}`, type: 'tool', input: call.args });
            } catch (opikErr) {
              console.error(' Opik span logging failed:', opikErr);
            }
          }

          const resultString = await executeToolCall(call.name, call.args, {
            sessionId: this.opts.sessionId,
            userId: this.opts.userId,
            phone: this.opts.phone,
          });

          if (toolSpan) {
            try {
              toolSpan.update({ output: { result: resultString } });
              toolSpan.end();
            } catch (opikErr) {
              console.error(' Opik span update failed:', opikErr);
            }
          }

          this.session.sendToolResponse({
            functionResponses: [{ name: call.name, response: { output: resultString }, id: call.id }],
          });
        }
      }
    } catch (err: any) {
      console.error(' Error processing session message:', err);
    }
  }

  /**
   * Connect to Gemini Live. Returns once the session is established.
   */
  async connect(): Promise<void> {
    this.initOpikTrace();

    this.session = await this.ai.live.connect({
      model: env.GEMINI_LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: this.opts.voiceName || env.GEMINI_LIVE_VOICE,
            },
          },
        },
        systemInstruction: {
          parts: [{ text: this.opts.systemPrompt }],
        },
        tools: [
          {
            functionDeclarations,
          },
        ],
      },
      callbacks: {
        onopen: () => {
          console.log(' Connected to Gemini Live API');
          this.opts.handlers.onOpen?.();
        },
        onmessage: (message: any) => this.handleMessage(message),
        onerror: (err: any) => {
          console.error(' Gemini Live API error:', err?.message || err);
          this.opts.handlers.onError?.(err?.message || 'Gemini Live error');
        },
        onclose: (e: any) => {
          console.log(' Gemini Live session closed:', e?.reason || 'unknown');
          this.opts.handlers.onClose?.(e?.reason || 'unknown');
        },
      },
    });
  }

  /** Forward an audio chunk (16kHz PCM base64) to Gemini Live. */
  sendAudioInput(base64Audio: string): void {
    if (!this.session || this.closed) return;
    this.session.sendRealtimeInput({
      audio: {
        data: base64Audio,
        mimeType: 'audio/pcm;rate=16000',
      },
    });
  }

  /** Close the Gemini Live session, end the trace and flush Opik. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.session) this.session.close();
    } catch {}
    if (this.trace) {
      try {
        this.trace.end();
        const opik = new Opik();
        await opik.flush();
        console.log(` Opik: Flushed ${this.opts.traceName} trace for session ${this.opts.sessionId}`);
      } catch (opikErr) {
        console.error(' Opik trace flush failed:', opikErr);
      }
    }
  }
}

export default VoiceSession;