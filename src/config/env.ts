import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string(),
  QDRANT_URL: z.string().default('http://localhost:6333'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  NEO4J_URI: z.string().default('bolt://localhost:7687'),
  NEO4J_USER: z.string().default('neo4j'),
  NEO4J_PASSWORD: z.string(),
  GEMINI_API_KEY: z.string(),
  ELEVENLABS_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  EMBEDDING_PROVIDER: z.enum(['local', 'gemini']).default('local'),
  VECTOR_DB_PROVIDER: z.enum(['qdrant']).default('qdrant'),
  TTS_PROVIDER: z.enum(['gemini', 'elevenlabs']).default('gemini'),
  STT_PROVIDER: z.enum(['gemini', 'elevenlabs', 'openrouter']).default('gemini'),
  LLM_PROVIDER: z.enum(['gemini', 'openrouter', 'groq']).default('gemini'),
  OPIK_API_KEY: z.string().optional(),
  OPIK_WORKSPACE: z.string().optional(),
  OPIK_PROJECT_NAME: z.string().default('voiceaqar'),
  VOICE_MODE: z.enum(['live', 'pipeline', 'both']).default('both'),
  GEMINI_LIVE_MODEL: z.string().default('gemini-2.5-flash-native-audio-dialog'),
  GEMINI_LIVE_VOICE: z.string().default('Puck'),
});

export const env = envSchema.parse(process.env);