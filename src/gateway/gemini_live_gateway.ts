import type { WebSocket } from 'ws';
import crypto from 'node:crypto';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import { db } from '../config/db.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getSystemPrompt } from '../agent/prompt.js';
import { embeddingService } from '../infrastructure/embeddings/index.js';
import { vectorDbService } from '../infrastructure/vectordb/index.js';
import { memoryManager } from '../infrastructure/memory/index.js';
import { graphMemory } from '../infrastructure/memory/graph/index.js';
import { env } from '../config/env.js';

export class GeminiLiveGateway {
  async handleConnection(ws: WebSocket, url: URL) {
    const phone = url.searchParams.get('phone');
    if (!phone) {
      ws.send(JSON.stringify({ type: 'error', message: 'Phone number is required' }));
      ws.close();
      return;
    }

    // --- User lookup/registration ---
    let userId: string;
    let userName = 'anonymous';
    try {
      const existing = await db.select().from(users).where(eq(users.phoneNumber, phone)).limit(1);
      if (existing.length > 0) {
        userId = existing[0].userId;
        userName = existing[0].name || 'anonymous';
        console.log(`👤 Gemini Live: Recognized user "${userName}" (${userId})`);
      } else {
        userId = `usr_${crypto.randomUUID()}`;
        await db.insert(users).values({ userId, phoneNumber: phone });
        console.log(`👤 Gemini Live: Registered new user (${userId})`);
      }
    } catch (err: any) {
      console.error('❌ Database error during user lookup:', err);
      ws.send(JSON.stringify({ type: 'error', message: 'Database error' }));
      ws.close();
      return;
    }

    // --- Session + Memory ---
    const sessionId = `live_${Date.now()}`;
    await memoryManager.onCallStart(sessionId, userId);

    // --- Gemini Live API connection ---
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

    let session: any;
    try {
      session = await ai.live.connect({
        model: env.GEMINI_LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: env.GEMINI_LIVE_VOICE,
              },
            },
          },
          systemInstruction: {
            parts: [{ text: getSystemPrompt() }],
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
                  // Text part (agent response transcript)
                  if (part.text) {
                    console.log(`🤖 Gemini Live response: "${part.text.substring(0, 100)}..."`);
                    await memoryManager.onAgentResponse(sessionId, part.text);
                  }
                }
              }

              // --- Handle turn completion (detect user transcript) ---
              if (message.serverContent?.turnComplete) {
                console.log('✅ Turn complete');
              }

              // --- Handle tool calls ---
              if (message.toolCall) {
                for (const call of message.toolCall.functionCalls) {
                  console.log(`🔧 Tool call: ${call.name}(${JSON.stringify(call.args)})`);

                  let resultString = '';

                  if (call.name === 'searchProperties') {
                    resultString = await this.executePropertySearch(call.args);
                    await memoryManager.onToolResult(sessionId, 'searchProperties', resultString);
                  } else if (call.name === 'saveUserProfile') {
                    resultString = await this.executeSaveProfile(call.args, userId, phone);
                    await memoryManager.onToolResult(sessionId, 'saveUserProfile', resultString);
                  }

                  // Send tool response back to Gemini
                  session.send({
                    toolResponse: {
                      functionResponses: [
                        {
                          response: { output: resultString },
                          id: call.id,
                        },
                      ],
                    },
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
        session.send({
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: 'audio/pcm;rate=16000',
                data: base64Audio,
              },
            ],
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
    });

    ws.on('error', (err) => {
      console.error('❌ WebSocket error:', err);
    });
  }

  /**
   * Execute property search against Qdrant vector DB.
   * Same logic as propertyRetrievalTool but callable outside LangChain.
   */
  private async executePropertySearch(args: any): Promise<string> {
    try {
      const { query, bedrooms, bathrooms, minPrice, maxPrice, minArea, maxArea, furnished } = args;

      const queryVector = await embeddingService.generateEmbedding(query, true);

      // Build Qdrant filter (numeric/boolean only)
      const mustConditions: any[] = [];
      if (bedrooms !== undefined && bedrooms !== null) {
        mustConditions.push({ key: 'bedrooms', match: { value: bedrooms } });
      }
      if (bathrooms !== undefined && bathrooms !== null) {
        mustConditions.push({ key: 'bathrooms', match: { value: bathrooms } });
      }
      if (furnished !== undefined && furnished !== null) {
        mustConditions.push({ key: 'furnished', match: { value: furnished } });
      }
      if (minPrice !== undefined || maxPrice !== undefined) {
        const range: any = {};
        if (minPrice !== undefined) range.gte = minPrice;
        if (maxPrice !== undefined) range.lte = maxPrice;
        if (Object.keys(range).length > 0) mustConditions.push({ key: 'price', range });
      }
      if (minArea !== undefined || maxArea !== undefined) {
        const range: any = {};
        if (minArea !== undefined) range.gte = minArea;
        if (maxArea !== undefined) range.lte = maxArea;
        if (Object.keys(range).length > 0) mustConditions.push({ key: 'areaSqm', range });
      }

      const filter = mustConditions.length > 0 ? { must: mustConditions } : undefined;

      const hits = await vectorDbService.search('properties', {
        vector: queryVector,
        limit: 5,
        filter,
        withPayload: true,
      });

      if (hits.length === 0) return 'No properties found matching the search criteria.';

      return hits
        .map((hit, i) => {
          const p = hit.payload || {};
          return `[Property ${i + 1}] Score: ${(hit.score * 100).toFixed(1)}% | Title: ${p.titleAr || 'N/A'} | City: ${p.cityAr || 'N/A'} | District: ${p.districtAr || 'N/A'} | Compound: ${p.compoundName || 'N/A'} | Type: ${p.propertyType || 'N/A'} | Offering: ${p.offeringType || 'N/A'} | Price: ${p.price || 'N/A'} EGP | Bedrooms: ${p.bedrooms || 'N/A'} | Bathrooms: ${p.bathrooms || 'N/A'} | Area: ${p.areaSqm || 'N/A'} sqm | Furnished: ${p.furnished ? 'Yes' : 'No'}`;
        })
        .join('\n');
    } catch (err: any) {
      console.error('❌ Property search error:', err);
      return `Error searching properties: ${err.message}`;
    }
  }

  /**
   * Save/update user profile in PostgreSQL and Neo4j graph.
   */
  private async executeSaveProfile(args: any, userId: string, phone: string): Promise<string> {
    try {
      const { name, phoneNumber } = args;
      await db.update(users).set({
        name,
        phoneNumber: phoneNumber || phone,
      }).where(eq(users.userId, userId));
      await graphMemory.upsertUser(userId, { name });
      return `Successfully saved profile for "${name}" (ID: ${userId})`;
    } catch (err: any) {
      console.error('❌ Save profile error:', err);
      return `Error saving profile: ${err.message}`;
    }
  }
}

export const geminiLiveGateway = new GeminiLiveGateway();
export default GeminiLiveGateway;
