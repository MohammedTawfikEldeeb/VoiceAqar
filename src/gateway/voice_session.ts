import { GoogleGenAI, Modality } from '@google/genai';
import { Opik } from 'opik';
import { env } from '../config/env.js';
import { memoryManager } from '../infrastructure/memory/index.js';
import { functionDeclarations, executeToolCall } from '../tools/registry.js';
import {
  SessionTelemetry,
  objectiveScores,
  judgeConversation,
  qualitativeScores,
  pushScores,
  computePercentile,
} from '../infrastructure/observability/metrics.js';

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
  private telemetry: SessionTelemetry;
  private turnFirstClientAudioAtMs?: number;
  private turnLastClientAudioAtMs?: number;
  private turnFirstAgentAudioAtMs?: number;
  private turnUserSpeechEndEstimateMs?: number;

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
    this.telemetry = {
      sessionStartMs: Date.now(),
      hadError: false,
      toolCalls: [],
      transcript: [],
      inputTokens: 0,
      outputTokens: 0,
      turnEndToEndLatenciesMs: [],
      turnTtfasMs: [],
    };
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
      // Usage metadata arrives on session messages (tokens consumed so far).
      if (message.usageMetadata) {
        if (message.usageMetadata.promptTokenCount) this.telemetry.inputTokens = message.usageMetadata.promptTokenCount;
        if (message.usageMetadata.candidatesTokenCount) this.telemetry.outputTokens = message.usageMetadata.candidatesTokenCount;
      }

      // --- Model turn: audio + text transcript chunks ---
      if (message.serverContent?.modelTurn?.parts) {
        for (const part of message.serverContent.modelTurn.parts) {
          if (part.inlineData?.mimeType?.startsWith('audio/')) {
            const now = Date.now();
            if (this.telemetry.firstAgentAudioAtMs === undefined) {
              this.telemetry.firstAgentAudioAtMs = now;
            }
             if (this.turnFirstAgentAudioAtMs === undefined) {
              this.turnFirstAgentAudioAtMs = now;
              if (this.turnUserSpeechEndEstimateMs !== undefined) {
                const turnE2E = Math.max(0, now - this.turnUserSpeechEndEstimateMs);
                this.telemetry.turnEndToEndLatenciesMs?.push(turnE2E);
                console.log(`[Latency Tracker] Turn E2E Latency: ${turnE2E} ms`);
              }
              if (this.turnFirstClientAudioAtMs !== undefined) {
                const turnTtfa = Math.max(0, now - this.turnFirstClientAudioAtMs);
                this.telemetry.turnTtfasMs?.push(turnTtfa);
                console.log(`[Latency Tracker] Turn TTFA: ${turnTtfa} ms`);
              }
            }
            const audioBuffer = Buffer.from(part.inlineData.data, 'base64');
            this.opts.handlers.onAudio?.(audioBuffer);
          }
          if (part.text) {
            this.currentAgentResponse += part.text;
            this.opts.handlers.onTextChunk?.(part.text);
          }
        }
      }

      // --- Agent output transcription (spoken text of the response) ---
      if (message.serverContent?.outputTranscription?.text) {
        this.currentAgentResponse += message.serverContent.outputTranscription.text;
        this.opts.handlers.onTextChunk?.(message.serverContent.outputTranscription.text);
      }

      // --- User input transcription (what the caller said) ---
      if (message.serverContent?.inputTranscription?.text) {
        const userText = message.serverContent.inputTranscription.text;
        console.log(` User transcript: "${userText}"`);
        this.turnUserSpeechEndEstimateMs = Date.now();
        await memoryManager.onUserMessage(this.opts.sessionId, userText, this.opts.userId);
        this.telemetry.transcript.push({ role: 'user', text: userText });
        if (this.trace) {
          try {
            const span = this.trace.span({ name: 'user_speech', type: 'general', input: { text: userText } });
            span.end();
          } catch (opikErr) {
            console.error(' Opik span logging failed:', opikErr);
          }
        }
      }

      // --- Turn complete: flush the accumulated agent response ---
      if (message.serverContent?.turnComplete) {
        // Reset turn-level latency tracking for the next turn
        this.turnFirstClientAudioAtMs = undefined;
        this.turnLastClientAudioAtMs = undefined;
        this.turnFirstAgentAudioAtMs = undefined;
        this.turnUserSpeechEndEstimateMs = undefined;

        if (this.currentAgentResponse) {
          console.log(` Full agent response: "${this.currentAgentResponse}"`);
          this.telemetry.transcript.push({ role: 'agent', text: this.currentAgentResponse });
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

          this.telemetry.toolCalls.push({
            name: call.name,
            ok: !/^Error in /.test(resultString),
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
        inputAudioTranscription: {
          languageCodes: ['ar-EG', 'en-US'],
        },
        outputAudioTranscription: {
          languageCodes: ['ar-EG', 'en-US'],
        },
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
          this.telemetry.hadError = true;
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
    const now = Date.now();
    
    // Session-level tracking (first turn only)
    if (this.telemetry.firstClientAudioAtMs === undefined) {
      this.telemetry.firstClientAudioAtMs = now;
    }
    if (this.telemetry.firstAgentAudioAtMs === undefined) {
      this.telemetry.lastClientAudioAtMs = now;
    }

    // Turn-level tracking (every turn)
    if (this.turnFirstClientAudioAtMs === undefined) {
      this.turnFirstClientAudioAtMs = now;
    }
    if (this.turnFirstAgentAudioAtMs === undefined) {
      this.turnLastClientAudioAtMs = now;
    }

    this.session.sendRealtimeInput({
      audio: {
        data: base64Audio,
        mimeType: 'audio/pcm;rate=16000',
      },
    });
  }

  /** Close the Gemini Live session, score the call on Opik and flush. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.session) this.session.close();
    } catch {}

    let judged: any = null;

    if (this.trace) {
      try {
        // 1. Log objective scores (latency, errors, tool success, tokens, cost)
        pushScores(this.trace, objectiveScores(this.telemetry));

        // 2. Attach the conversation + outcomes to the trace output for visibility (done before ending)
        if (this.telemetry.transcript.length) {
          try {
            this.trace.update({
              output: {
                transcript: this.telemetry.transcript.map((m: { role: string; text: string }) => `${m.role}: ${m.text}`),
                toolCalls: this.telemetry.toolCalls,
                tokens: { input: this.telemetry.inputTokens, output: this.telemetry.outputTokens },
              },
            });
          } catch (outErr) {
            console.error(' Opik trace output update failed:', outErr);
          }
        }

        // 3. End the trace and flush objective scores immediately
        this.trace.end();
        const opik = new Opik();
        await opik.flush();
        console.log(` Opik: Ended and flushed objective trace for session ${this.opts.sessionId}`);

        // 4. Qualitative scores via LLM judge (run as post-end update)
        try {
          judged = await judgeConversation(this.telemetry);
          if (judged) {
            pushScores(this.trace, qualitativeScores(judged));
            await opik.flush();
            console.log(` Opik: Flushed qualitative judge scores for session ${this.opts.sessionId}`);
          }
        } catch (judgeErr) {
          console.warn(' Opik qualitative judge failed to push:', judgeErr);
        }
      } catch (opikErr) {
        console.error(' Opik trace flush failed:', opikErr);
      }
    }

    // Run evaluation judge if transcript is populated but not yet judged (e.g. Opik is disabled)
    if (!judged && this.telemetry.transcript.length) {
      try {
        judged = await judgeConversation(this.telemetry);
      } catch {}
    }

    // Log metrics to console
    const p50 = computePercentile(this.telemetry.turnEndToEndLatenciesMs || [], 50);
    const p90 = computePercentile(this.telemetry.turnEndToEndLatenciesMs || [], 90);
    console.log(`[Latency Tracker] Session ${this.opts.sessionId} complete. P50: ${p50} ms, P90: ${p90} ms`);
    console.log(` Metrics for ${this.opts.sessionId}:`, JSON.stringify(this.telemetry));


  }
}

export default VoiceSession;