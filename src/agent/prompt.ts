import { Opik } from 'opik';
import { env } from '../config/env.js';

export const DEFAULT_SYSTEM_PROMPT = `You are VoiceAqar, an Egyptian real estate voice assistant.

## Personality
Speak only in Egyptian Arabic dialect. Be warm, professional, like a trusted advisor. Use natural expressions (يا فندم، إن شاء الله، حاضر).

## Voice Format (CRITICAL)
Responses are spoken by TTS. Plain text only — no emojis, no markdown, no lists/bullets/headers/numbers. Max 2–3 sentences, like a real phone call. Mention properties conversationally, never as a list.

## Tools
- property_retrieval: query = location/type/compound (Arabic text). Numeric/boolean filters (bedrooms, bathrooms, minPrice, maxPrice, furnished) go in their own parameters, never in query.
- save_user_profile: save name/phone once the user shares them.

Examples:
- "عايز فيلا في مفيدا بحمامين" → query: "فيلا في مفيدا", bathrooms: 2
- "شقة في التجمع بـ 3 غرف اقل من 5 مليون" → query: "شقة في التجمع", bedrooms: 3, maxPrice: 5000000
- "شقة مفروشة للايجار في الشيخ زايد" → query: "شقة للايجار في الشيخ زايد", furnished: true

## Accuracy Rules (CRITICAL)
- Only show properties matching the requested compound/location exactly, per the retrieved data. If none match, say so and offer alternatives explicitly.
- Never guess or misstate City/District/Compound — use the data as given (e.g. don't say Mivida is in Zayed if it's in New Cairo).
- Match property type strictly (don't show apartments for a villa request); don't mix in unrelated compounds unless asked.

## General
- Always call property_retrieval for property questions.
- Don't know the user's name → ask, then save it immediately.`;

let activeSystemPrompt = DEFAULT_SYSTEM_PROMPT;

/**
 * Returns the currently active system prompt.
 */
export function getSystemPrompt(): string {
  return activeSystemPrompt;
}

/**
 * Attempts to fetch the latest prompt version from Opik Prompt Library.
 * If the prompt does not exist in Opik, or if the local DEFAULT_SYSTEM_PROMPT differs
 * from the latest dashboard version, it automatically uploads/versions it to track changes.
 */
export async function syncPromptWithOpik(): Promise<void> {
  if (!env.OPIK_API_KEY) {
    console.log('📝 Opik API key not configured. Using local default system prompt.');
    activeSystemPrompt = DEFAULT_SYSTEM_PROMPT;
    return;
  }

  try {
    console.log('🔄 Syncing system prompt with Opik Prompt Library...');
    
    // Set environment keys for the Opik Client instance
    process.env.OPIK_API_KEY = env.OPIK_API_KEY;
    if (env.OPIK_WORKSPACE) {
      process.env.OPIK_WORKSPACE = env.OPIK_WORKSPACE;
    }
    process.env.OPIK_PROJECT_NAME = env.OPIK_PROJECT_NAME;

    const opik = new Opik();
    
    let existingPrompt: any = null;
    try {
      existingPrompt = await opik.getPrompt({
        name: 'voiceaqar-system-prompt',
      });
    } catch (e) {
      // Prompt doesn't exist yet, we will create it
    }

    if (!existingPrompt) {
      console.log('Prompt not found in Opik. Registering local default system prompt...');
      const newPrompt = await opik.createPrompt({
        name: 'voiceaqar-system-prompt',
        prompt: DEFAULT_SYSTEM_PROMPT,
      });
      console.log(`Registered default prompt in Opik (Version: ${newPrompt.versionId})`);
      activeSystemPrompt = DEFAULT_SYSTEM_PROMPT;
    } else {
      // If local prompt differs from Opik prompt, push a new version to track changes
      if (existingPrompt.template !== DEFAULT_SYSTEM_PROMPT) {
        console.log('Local prompt has changed! Pushing new version to Opik Prompt Library...');
        const updatedPrompt = await opik.createPrompt({
          name: 'voiceaqar-system-prompt',
          prompt: DEFAULT_SYSTEM_PROMPT,
        });
        console.log(`Successfully pushed new version to Opik (Version: ${updatedPrompt.versionId})`);
        activeSystemPrompt = DEFAULT_SYSTEM_PROMPT;
      } else {
        console.log('Opik Prompt Library is in sync with local file.');
        activeSystemPrompt = existingPrompt.template;
      }
    }
  } catch (err: any) {
    console.log(`Opik Prompt sync failed: ${err.message || String(err)}. Using local default system prompt.`);
    activeSystemPrompt = DEFAULT_SYSTEM_PROMPT;
  }
}
