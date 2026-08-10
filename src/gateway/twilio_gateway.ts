import type { WebSocket } from 'ws';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import { Opik } from 'opik';
import { getSystemPrompt } from '../agent/prompt.js';
import { propertyRetrievalTool } from '../tools/property_retrieval_tool.js';
import { saveUserProfileTool } from '../tools/user_profile_tool.js';
import { saveUserPreferencesTool } from '../tools/user_preferences_tool.js';
import { memoryManager } from '../infrastructure/memory/index.js';
import { getOrCreateUser } from '../utils/user_helper.js';
import { decodeMuLaw, encodeMuLaw, resample8To16, resample24To8 } from '../utils/audio_helper.js';
import { env } from '../config/env.js';

export class TwilioGateway {
  async handleConnection(ws: WebSocket, url: URL) {
    try {
    const phone = url.searchParams.get('phone') || 'unknown_twilio';
    console.log(`📞 Twilio Gateway: New call stream connection for phone ${phone}`);

    // --- User lookup/registration via centralized helper ---
    const { userId, userName } = await getOrCreateUser(phone);
    console.log(`👤 Twilio: Recognized user "${userName}" (${userId})`);

    const sessionId = `twilio_${Date.now()}`;
    await memoryManager.onCallStart(sessionId, userId);
    const { systemPrompt } = await memoryManager.getAgentContext(sessionId, userId);

    // --- Manual Opik Session Tracing ---
    let trace: any = null;
    if (env.OPIK_API_KEY) {
      try {
        process.env.OPIK_API_KEY = env.OPIK_API_KEY;
        if (env.OPIK_WORKSPACE) {
          process.env.OPIK_WORKSPACE = env.OPIK_WORKSPACE;
        }
        process.env.OPIK_PROJECT_NAME = env.OPIK_PROJECT_NAME;

        const opik = new Opik();
        trace = opik.trace({
          name: 'Twilio Live Session',
          input: {
            phone,
            sessionId,
            userId,
            userName,
            userPreferences: systemPrompt.includes('User Preferences:')
              ? systemPrompt.substring(systemPrompt.indexOf('User Preferences:'))
              : 'None',
          },
        });
        console.log(` Opik: Started trace tracking for Twilio Live session ${sessionId}`);
      } catch (err) {
        console.error(' Failed to initialize manual Opik trace:', err);
      }
    }

    // --- Gemini Live API connection ---
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    let session: any;
    let streamSid = '';
    let currentAgentResponse = '';

    try {
      session = await ai.live.connect({
        model: env.GEMINI_LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO, Modality.TEXT],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: env.GEMINI_LIVE_VOICE,
              },
            },
          },
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'searchProperties',
                  description: 'Search for real estate properties. Put location/compound/type text in query. Use numeric parameters for exact filters.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      query: { type: Type.STRING, description: 'Natural language search query in Arabic (location, compound, property type)' },
                      bedrooms: { type: Type.INTEGER, description: 'Exact number of bedrooms' },
                      bathrooms: { type: Type.INTEGER, description: 'Exact number of bathrooms' },
                      minPrice: { type: Type.NUMBER, description: 'Minimum price in EGP' },
                      maxPrice: { type: Type.NUMBER, description: 'Maximum price in EGP' },
                      minArea: { type: Type.NUMBER, description: 'Minimum area in sqm' },
                      maxArea: { type: Type.NUMBER, description: 'Maximum area in sqm' },
                      furnished: { type: Type.BOOLEAN, description: 'Whether property must be furnished' },
                    },
                    required: ['query'],
                  },
                },
                {
                  name: 'saveUserProfile',
                  description: 'Save or update the user name and phone number',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING, description: 'User name in Arabic' },
                      phoneNumber: { type: Type.STRING, description: 'Phone number if provided' },
                    },
                    required: ['name'],
                  },
                },
                {
                  name: 'saveUserPreferences',
                  description: 'Save or update user search preferences (specifically preferred property types and budget range) in the Neo4j knowledge graph. Use this tool immediately when the user specifies their budget or the type of property they are interested in.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      preferredPropertyTypes: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: "Array of preferred property types in Arabic (e.g., ['فيلا', 'شقة'])"
                      },
                      minPrice: { type: Type.NUMBER, description: 'Minimum budget in EGP' },
                      maxPrice: { type: Type.NUMBER, description: 'Maximum budget in EGP' },
                      currency: { type: Type.STRING, description: 'Currency (default: EGP)' },
                    }
                  },
                },
              ],
            },
          ],
        },
        callbacks: {
          onopen: () => {
            console.log('Connected to Gemini Live API for Twilio Stream');
          },
          onmessage: async (message: any) => {
            try {
              // --- Handle audio response from Gemini ---
              if (message.serverContent?.modelTurn?.parts) {
                for (const part of message.serverContent.modelTurn.parts) {
                  // Audio chunk
                  if (part.inlineData?.mimeType?.startsWith('audio/')) {
                    const audioBuffer24k = Buffer.from(part.inlineData.data, 'base64');
                    
                    // Resample: 24kHz PCM -> 8kHz PCM (Central helper)
                    const audioBuffer8k = resample24To8(audioBuffer24k);
                    // Encode: 8kHz PCM -> 8kHz Mulaw (Central helper)
                    const mulawBuffer = encodeMuLaw(audioBuffer8k);
                    
                    // Send to Twilio via WebSocket
                    if (ws.readyState === 1 && streamSid) {
                      ws.send(JSON.stringify({
                        event: 'media',
                        streamSid: streamSid,
                        media: {
                          payload: mulawBuffer.toString('base64'),
                        },
                      }));
                    }
                  }
                  // Text part
                  if (part.text) {
                    console.log(`🤖 Twilio Gemini Response chunk: "${part.text}"`);
                    currentAgentResponse += part.text;
                  }
                }
              }

              // --- Handle turn completion ---
              if (message.serverContent?.turnComplete) {
                console.log('✅ Twilio Turn complete');
                if (currentAgentResponse) {
                  console.log(`🤖 Full Twilio Gemini response: "${currentAgentResponse}"`);
                  await memoryManager.onAgentResponse(sessionId, currentAgentResponse);

                  // Log full agent response span in Opik
                  if (trace) {
                    try {
                      const agentSpan = trace.span({
                        name: 'agent_response',
                        type: 'llm',
                        input: { context: 'Live voice turn response' },
                      });
                      agentSpan.update({
                        output: { text: currentAgentResponse },
                      });
                      agentSpan.end();
                    } catch (opikErr) {
                      console.error('⚠️ Opik span logging failed:', opikErr);
                    }
                  }
                  currentAgentResponse = '';
                }
              }

              // --- Handle user transcripts ---
              if (message.serverContent?.clientContent?.parts) {
                for (const part of message.serverContent.clientContent.parts) {
                  if (part.text) {
                    console.log(`👤 Twilio User transcript: "${part.text}"`);
                    await memoryManager.onUserMessage(sessionId, part.text, userId);

                    if (trace) {
                      try {
                        const userSpan = trace.span({
                          name: 'user_speech',
                          type: 'general',
                          input: { text: part.text },
                        });
                        userSpan.end();
                      } catch (opikErr) {
                        console.error('⚠️ Opik span logging failed:', opikErr);
                      }
                    }
                  }
                }
              }

              // --- Handle tool calls ---
              if (message.toolCall) {
                for (const call of message.toolCall.functionCalls) {
                  console.log(`Twilio Tool call: ${call.name}(${JSON.stringify(call.args)})`);

                  let toolSpan: any = null;
                  if (trace) {
                    try {
                      toolSpan = trace.span({
                        name: `tool:${call.name}`,
                        type: 'tool',
                        input: call.args,
                      });
                    } catch (opikErr) {
                      console.error('Opik span logging failed:', opikErr);
                    }
                  }

                  let resultString = '';

                  // Execute tools dynamically by reusing our LangChain StructuredTool instances!
                  if (call.name === 'searchProperties') {
                    try {
                      const res = await propertyRetrievalTool.invoke(call.args) as any;
                      resultString = typeof res === 'string' ? res : (res.content as string || JSON.stringify(res));
                      await memoryManager.onToolResult(sessionId, 'searchProperties', resultString);
                    } catch (e: any) {
                      resultString = `Error searching properties: ${e.message}`;
                    }
                  } else if (call.name === 'saveUserProfile') {
                    try {
                      const res = await saveUserProfileTool.invoke({
                        name: call.args.name,
                        phoneNumber: call.args.phoneNumber || phone,
                        userId: userId,
                      }) as any;
                      resultString = typeof res === 'string' ? res : (res.content as string || JSON.stringify(res));
                      await memoryManager.onToolResult(sessionId, 'saveUserProfile', resultString);
                    } catch (e: any) {
                      resultString = `Error saving profile: ${e.message}`;
                    }
                  } else if (call.name === 'saveUserPreferences') {
                    try {
                      const res = await saveUserPreferencesTool.invoke({
                        userId: userId,
                        preferredPropertyTypes: call.args.preferredPropertyTypes,
                        minPrice: call.args.minPrice,
                        maxPrice: call.args.maxPrice,
                        currency: call.args.currency,
                      }) as any;
                      resultString = typeof res === 'string' ? res : (res.content as string || JSON.stringify(res));
                      await memoryManager.onToolResult(sessionId, 'saveUserPreferences', resultString);
                    } catch (e: any) {
                      resultString = `Error saving preferences: ${e.message}`;
                    }
                  }

                  if (toolSpan) {
                    try {
                      toolSpan.update({
                        output: { result: resultString },
                      });
                      toolSpan.end();
                    } catch (opikErr) {
                      console.error('Opik span update failed:', opikErr);
                    }
                  }

                  session.sendToolResponse({
                    functionResponses: [
                      {
                        name: call.name,
                        response: { output: resultString },
                        id: call.id,
                      },
                    ],
                  });
                }
              }
            } catch (err: any) {
              console.error('Twilio Gateway: Error processing Gemini message:', err);
            }
          },
          onerror: (err: any) => {
            console.error(' Twilio Gateway: Gemini Live error:', err?.message || err);
          },
          onclose: (e: any) => {
            console.log(' Twilio Gateway: Gemini Live session closed:', e?.reason || 'unknown');
          },
        },
      });
    } catch (err: any) {
      console.error(' Twilio Gateway: Failed to connect to Gemini Live:', err);
      ws.close();
      return;
    }

    // --- Process incoming Twilio WebSocket messages ---
    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message);

        if (data.event === 'start') {
          streamSid = data.streamSid;
          console.log(`🎬 Twilio: Audio stream started with streamSid: ${streamSid}`);
        } else if (data.event === 'media') {
          if (!session) return;
          const mulawBuffer = Buffer.from(data.media.payload, 'base64');
          
          // Decode: 8kHz Mulaw -> 8kHz PCM (Central helper)
          const pcmBuffer8k = decodeMuLaw(mulawBuffer);
          // Resample: 8kHz PCM -> 16kHz PCM (Central helper)
          const pcmBuffer16k = resample8To16(pcmBuffer8k);

          // Forward 16kHz PCM to Gemini Live
          session.sendRealtimeInput({
            audio: {
              data: pcmBuffer16k.toString('base64'),
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } else if (data.event === 'stop') {
          console.log('Twilio: Audio stream stopped');
        }
      } catch (err) {
        console.error(' Twilio Gateway: Error processing Twilio message:', err);
      }
    });

    // --- Cleanup on disconnect ---
    ws.on('close', async () => {
      console.log(' Twilio client disconnected');
      try {
        if (session) session.close();
      } catch {}
      try {
        await memoryManager.onCallEnd(sessionId, userId);
      } catch (err) {
        console.error('Error ending call:', err);
      }

      if (trace) {
        try {
          trace.end();
          const opik = new Opik();
          await opik.flush();
          console.log(`Opik: Flushed manual trace for Twilio Live session ${sessionId}`);
        } catch (opikErr) {
          console.error('Opik trace flush failed:', opikErr);
        }
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
