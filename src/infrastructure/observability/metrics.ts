import { GoogleGenAI } from '@google/genai';
import { env } from '../../config/env.js';
import { db } from '../../config/db.js';

/**
 * Per-call instrumentation data captured live by the voice session.
 * These are the objectively measurable metrics (no LLM judgement needed).
 */
export interface SessionTelemetry {
  /** When the call/session started (ms epoch). */
  sessionStartMs: number;
  /** When the first user audio chunk was forwarded to Gemini (ms epoch). */
  firstClientAudioAtMs?: number;
  /** When the first agent audio chunk was received from Gemini (ms epoch). */
  firstAgentAudioAtMs?: number;
  /** When the last user audio chunk was forwarded before a model response (ms epoch). */
  lastClientAudioAtMs?: number;
  /** True if any session/connection error occurred. */
  hadError: boolean;
  /** Per-tool outcome. */
  toolCalls: Array<{ name: string; ok: boolean }>;
  /** Transcript of the conversation, used by the LLM judge. */
  transcript: Array<{ role: 'user' | 'agent'; text: string }>;
  /** Cumulated token usage from Gemini Live usageMetadata. */
  inputTokens: number;
  outputTokens: number;
  /** Turn-level end-to-end latencies (ms). */
  turnEndToEndLatenciesMs?: number[];
  /** Turn-level time-to-first-audio latencies (ms). */
  turnTtfasMs?: number[];
}

export interface FeedbackScore {
  name: string;
  value: number;
  rationale?: string;
}

export const UNKNOWN = -1;

/* ------------------------------------------------------------------ */
/* Objective metrics (no LLM)                                          */
/* ------------------------------------------------------------------ */

/** Time from the user's first audio chunk to the first agent audio chunk. */
export function computeTtfaMs(t: SessionTelemetry): number {
  if (!t.firstClientAudioAtMs || !t.firstAgentAudioAtMs) return UNKNOWN;
  return Math.max(0, t.firstAgentAudioAtMs - t.firstClientAudioAtMs);
}

/** Approximate E2E latency: last user audio before the response -> first agent audio. */
export function computeEndToEndMs(t: SessionTelemetry): number {
  if (t.turnEndToEndLatenciesMs && t.turnEndToEndLatenciesMs.length > 0) {
    const sum = t.turnEndToEndLatenciesMs.reduce((a, b) => a + b, 0);
    return Math.round(sum / t.turnEndToEndLatenciesMs.length);
  }
  if (!t.lastClientAudioAtMs || !t.firstAgentAudioAtMs) return UNKNOWN;
  return Math.max(0, t.firstAgentAudioAtMs - t.lastClientAudioAtMs);
}

export function computeErrorRate(t: SessionTelemetry): number {
  return t.hadError ? 1 : 0;
}

export function computeToolSuccessRate(t: SessionTelemetry): number {
  if (t.toolCalls.length === 0) return UNKNOWN;
  const ok = t.toolCalls.filter((c) => c.ok).length;
  return ok / t.toolCalls.length;
}

/** Returns null when the survey has no usable pricing configured. */
export function computeCostUsd(t: SessionTelemetry): number | null {
  const inPrice = env.GEMINI_LIVE_INPUT_PRICE_PER_MILLION;
  const outPrice = env.GEMINI_LIVE_OUTPUT_PRICE_PER_MILLION;
  if (!inPrice && !outPrice) return null;
  return (t.inputTokens / 1_000_000) * inPrice + (t.outputTokens / 1_000_000) * outPrice;
}

/**
 * Assemble the objective feedback scores.
 */
export function objectiveScores(t: SessionTelemetry): FeedbackScore[] {
  const scores: FeedbackScore[] = [
    { name: 'ttfa_ms', value: computeTtfaMs(t) },
    { name: 'e2e_latency_ms', value: computeEndToEndMs(t) },
    { name: 'error_rate', value: computeErrorRate(t) },
    { name: 'tool_success_rate', value: computeToolSuccessRate(t) },
    { name: 'tokens_input', value: t.inputTokens },
    { name: 'tokens_output', value: t.outputTokens },
  ];
  const p50 = computePercentile(t.turnEndToEndLatenciesMs || [], 50);
  const p90 = computePercentile(t.turnEndToEndLatenciesMs || [], 90);
  if (p50 !== UNKNOWN) scores.push({ name: 'p50_latency_ms', value: p50 });
  if (p90 !== UNKNOWN) scores.push({ name: 'p90_latency_ms', value: p90 });

  const cost = computeCostUsd(t);
  if (cost !== null) scores.push({ name: 'cost_usd', value: cost });
  return scores;
}

/* ------------------------------------------------------------------ */
/* LLM-judge metrics (qualitative)                                     */
/* ------------------------------------------------------------------ */

export interface QualitativeScores {
  task_success: number;
  intent_accuracy: number;
  response_relevance: number;
  tool_call_accuracy: number;
  rationale: string;
}

/**
 * Judge the conversation quality with Gemini.
 * Returns null when evaluation fails (never throws) so a judge error
 * can never break the call teardown.
 */
export async function judgeConversation(t: SessionTelemetry): Promise<QualitativeScores | null> {
  if (!t.transcript.length) return null;
  try {
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

    const convo = t.transcript
      .map((m) => `${m.role === 'user' ? 'USER' : 'AGENT'}: ${m.text}`)
      .join('\n');

    const prompt = `You are evaluating an Egyptian Arabic real-estate voice assistant conversation.
Rate the conversation on a 0-1 scale for each criterion:

1. task_success: Did the assistant actually complete the user's goal (e.g. showed matching properties, saved profile/preferences, or booked the requested appointment)?
2. intent_accuracy: Did the assistant correctly understand what the user wanted?
3. response_relevance: Was each response appropriate and on-topic for the request?
4. tool_call_accuracy: Were the right tools called with correct arguments (property_retrieval for searches, save_user_profile / save_user_preferences when the user gave personal details, check_calendar_slots / book_appointment for appointments)?

Tool calls made in this session:
${
  t.toolCalls.length
    ? t.toolCalls.map((c) => `- ${c.name}: ${c.ok ? 'succeeded' : 'failed/errored'}`).join('\n')
    : 'none'
}

Conversation:
${convo}

Return STRICT JSON only: {"task_success":0.0,"intent_accuracy":0.0,"response_relevance":0.0,"tool_call_accuracy":0.0,"rationale":"short reason"}`;

    const raw = await judgeRaw(prompt);
    if (!raw) return null;
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    const parsed = JSON.parse(json);
    return {
      task_success: clamp01(parsed.task_success),
      intent_accuracy: clamp01(parsed.intent_accuracy),
      response_relevance: clamp01(parsed.response_relevance),
      tool_call_accuracy: clamp01(parsed.tool_call_accuracy),
      rationale: String(parsed.rationale || ''),
    };
  } catch (err: any) {
    console.warn('⚠️ Conversational judge failed (skipping qualitative scores):', err?.message || err);
    return null;
  }
}

/**
 * Call the eval model via the configured LLM_PROVIDER.
 * Uses OpenRouter/Groq when configured, otherwise Gemini (default).
 */
async function judgeRaw(prompt: string): Promise<string | null> {
  let provider = env.LLM_PROVIDER;
  if (env.GEMINI_EVAL_MODEL.includes('gemini') && provider === 'groq') {
    provider = 'gemini';
  }

  if (provider === 'openrouter') {
    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY required for LLM_PROVIDER=openrouter');
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.GEMINI_EVAL_MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 1024 }),
    });
    if (!res.ok) throw new Error(`OpenRouter judge failed (${res.status})`);
    const data: any = await res.json();
    return data.choices?.[0]?.message?.content || null;
  }

  if (provider === 'groq') {
    const apiKey = env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY required for LLM_PROVIDER=groq');
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.GEMINI_EVAL_MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 1024 }),
    });
    if (!res.ok) throw new Error(`Groq judge failed (${res.status})`);
    const data: any = await res.json();
    return data.choices?.[0]?.message?.content || null;
  }

  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const res = await ai.models.generateContent({
    model: env.GEMINI_EVAL_MODEL,
    contents: prompt,
    config: { responseMimeType: 'text/plain', temperature: 0.2 },
  });
  return res.text || null;
}

export function qualitativeScores(q: QualitativeScores): FeedbackScore[] {
  return [
    { name: 'task_success', value: q.task_success, rationale: q.rationale },
    { name: 'intent_accuracy', value: q.intent_accuracy, rationale: q.rationale },
    { name: 'response_relevance', value: q.response_relevance, rationale: q.rationale },
    { name: 'tool_call_accuracy', value: q.tool_call_accuracy, rationale: q.rationale },
  ];
}

function clamp01(v: any): number {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/* ------------------------------------------------------------------ */
/* Opik integration                                                    */
/* ------------------------------------------------------------------ */

/**
 * Push feedback scores onto an existing Opik trace. Best-effort: never throws.
 */
export function pushScores(trace: any, scores: FeedbackScore[]): void {
  for (const s of scores) {
    if (s.value === UNKNOWN) continue;
    try {
      trace.score({ name: s.name, value: s.value, reason: s.rationale || '' });
    } catch (err) {
      console.warn(`⚠️ Failed to push score "${s.name}":`, err);
    }
  }
}

/**
 * Calculate the percentile of an array of numbers.
 */
export function computePercentile(values: number[], p: number): number {
  if (!values || values.length === 0) return UNKNOWN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[index];
}
