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
  // --- Optional LLM providers (text chat agent + LLM judge) ---
  LLM_PROVIDER: z.enum(['gemini', 'openrouter', 'groq']).default('gemini'),
  OPENROUTER_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  EMBEDDING_PROVIDER: z.enum(['local', 'gemini']).default('local'),
  VECTOR_DB_PROVIDER: z.enum(['qdrant']).default('qdrant'),
  OPIK_API_KEY: z.string().optional(),
  OPIK_WORKSPACE: z.string().optional(),
  OPIK_PROJECT_NAME: z.string().default('voiceaqar'),
  GEMINI_LIVE_MODEL: z.string().default('gemini-3.1-flash-live-preview'),
  GEMINI_LIVE_VOICE: z.string().default('Puck'),
  // Model used by the LLM judge to score conversation quality metrics.
  // When LLM_PROVIDER is 'openrouter', use an OpenRouter model ID (e.g. google/gemini-2.5-flash).
  GEMINI_EVAL_MODEL: z.string().default('gemini-3.1-flash-preview'),
  // Optional per-million-token pricing for Gemini Live to compute cost/call.
  // If unset, the cost_usd score is skipped (token counts still reported).
  GEMINI_LIVE_INPUT_PRICE_PER_MILLION: z.coerce.number().default(0),
  GEMINI_LIVE_OUTPUT_PRICE_PER_MILLION: z.coerce.number().default(0),
  // --- Voice Provider Selection ---
  VOICE_PROVIDER: z.enum(['gemini']).default('gemini'),
  // --- Google Calendar (appointment booking) ---
  GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_CALENDAR_PRIVATE_KEY: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),
  CALENDAR_TIMEZONE: z.string().default('Africa/Cairo'),
  CALENDAR_WORK_START: z.string().default('10:00'),
  CALENDAR_WORK_END: z.string().default('17:00'),
  CALENDAR_APPOINTMENT_DURATION_MIN: z.coerce.number().default(30),
  CALENDAR_SLOTS_PER_OFFER: z.coerce.number().default(3),
  // --- Authentication & security ---
  // If set, the /api/chat, /api/chat/end and related HTTP routes require
  // this shared token in the `x-api-token` header. Leave empty in dev.
  API_AUTH_TOKEN: z.string().optional(),
  // If set, WebSocket routes require `?access_token=<value>` in the URL.
  WSS_ACCESS_TOKEN: z.string().optional(),
  // Twilio Auth Token used to verify incoming call webhook signatures.
  TWILIO_AUTH_TOKEN: z.string().optional(),
  // Session retention (hours) before idle chat/voice sessions are cleaned up.
  SESSION_TTL_HOURS: z.coerce.number().default(6),
});

export const env = envSchema.parse(process.env);