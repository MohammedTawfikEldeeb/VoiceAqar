import type { WebSocket } from 'ws';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import { Opik } from 'opik';
import { getSystemPrompt } from '../agent/prompt.js';
import { propertyRetrievalTool } from '../tools/property_retrieval_tool.js';
import { saveUserProfileTool } from '../tools/user_profile_tool.js';
import { saveUserPreferencesTool } from '../tools/user_preferences_tool.js';
import { memoryManager } from '../infrastructure/memory/index.js';
import { getOrCreateUser } from '../utils/user_helper.js';
import { env } from '../config/env.js';

export class GeminiLiveGateway {
  async handleConnection(ws: WebSocket, url: URL) {
    try {
      const phone = url.searchParams.get('phone');
      if (!phone) {
        ws.send(JSON.stringify({ type: 'error', message: 'Phone number is required' }));
        ws.close();
        return;
      }

      // --- User lookup/registration via centralized helper ---
      const { userId, userName } = await getOrCreateUser(phone);
      console.log(`👤 Gemini Live: Recognized user "${userName}" (${userId})`);

      // --- Session + Memory ---
      const sessionId = `live_${Date.now()}`;
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
          name: 'Gemini Live Session',
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
        console.log(`📝 Opik: Started trace tracking for Gemini Live session ${sessionId}`);
      } catch (err) {
        console.error('⚠️ Failed to initialize manual Opik trace:', err);
      }
    }

    // --- Gemini Live API connection ---
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

    let session: any;
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
            console.log('⚡ Connected to Gemini Live API');
            ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
          },
          onmessage: async (message: any) => {
            try {
              // --- Handle audio response chunks from Gemini ---
              if (message.serverContent?.modelTurn?.parts) {
                for (const part of message.serverContent.modelTurn.parts) {
                  // Audio chunk
                  if (part.inlineData?.mimeType?.startsWith('audio/')) {
                    const audioBuffer = Buffer.from(part.inlineData.data, 'base64');
                    if (ws.readyState === 1) { // WebSocket.OPEN
                      ws.send(audioBuffer);
                    }
                  }
                  // Text part (agent response transcript chunk)
                  if (part.text) {
                    console.log(`🤖 Gemini Live response chunk: "${part.text}"`);
                    currentAgentResponse += part.text;
                  }
                }
              }

              // --- Handle turn completion (detect user transcript) ---
              if (message.serverContent?.turnComplete) {
                console.log('✅ Turn complete');
                if (currentAgentResponse) {
                  console.log(`🤖 Full Gemini response: "${currentAgentResponse}"`);
                  await memoryManager.onAgentResponse(sessionId, currentAgentResponse);

                  // Track full agent response span in Opik
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

              // --- Handle user transcripts (client content) ---
              if (message.serverContent?.clientContent?.parts) {
                for (const part of message.serverContent.clientContent.parts) {
                  if (part.text) {
                    console.log(`👤 User transcript detected: "${part.text}"`);
                    await memoryManager.onUserMessage(sessionId, part.text, userId);

                    // Track user speech span in Opik
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
                  console.log(`🔧 Tool call: ${call.name}(${JSON.stringify(call.args)})`);

                  // Start tool span in Opik
                  let toolSpan: any = null;
                  if (trace) {
                    try {
                      toolSpan = trace.span({
                        name: `tool:${call.name}`,
                        type: 'tool',
                        input: call.args,
                      });
                    } catch (opikErr) {
                      console.error('⚠️ Opik span logging failed:', opikErr);
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

                  // Update tool span output in Opik
                  if (toolSpan) {
                    try {
                      toolSpan.update({
                        output: { result: resultString },
                      });
                      toolSpan.end();
                    } catch (opikErr) {
                      console.error('⚠️ Opik span update failed:', opikErr);
                    }
                  }

                  // Send tool response back to Gemini
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
              console.error('❌ Error processing Gemini message:', err);
            }
          },
          onerror: (err: any) => {
            console.error('❌ Gemini Live API error:', err?.message || err);
            try {
              ws.send(JSON.stringify({ type: 'error', message: 'Gemini Live error' }));
            } catch {}
          },
          onclose: (e: any) => {
            console.log('🔴 Gemini Live session closed:', e?.reason || 'unknown');
          },
        },
      });
    } catch (err: any) {
      console.error('❌ Failed to connect to Gemini Live:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
      ws.close();
      return;
    }

    // --- Forward browser PCM audio to Gemini ---
    ws.on('message', (data: Buffer) => {
      if (!session) return;
      try {
        const base64Audio = Buffer.from(data).toString('base64');
        session.sendRealtimeInput({
          audio: {
            data: base64Audio,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      } catch (err) {
        console.error('❌ Error forwarding audio to Gemini:', err);
      }
    });

    // --- Cleanup on disconnect ---
    ws.on('close', async () => {
      console.log('🔴 Gemini Live client disconnected');
      try {
        if (session) session.close();
      } catch {}
      try {
        await memoryManager.onCallEnd(sessionId, userId);
      } catch (err) {
        console.error('Error ending call:', err);
      }

      // End manual trace in Opik and flush to API
      if (trace) {
        try {
          trace.end();
          const opik = new Opik();
          await opik.flush();
          console.log(`✅ Opik: Flushed manual trace for Gemini Live session ${sessionId}`);
        } catch (opikErr) {
          console.error('⚠️ Opik trace flush failed:', opikErr);
        }
      }
    });

    ws.on('error', (err) => {
      console.error('❌ WebSocket error:', err);
    });
    } catch (err: any) {
      console.error('❌ Gemini Live Gateway: Connection handler error:', err);
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
