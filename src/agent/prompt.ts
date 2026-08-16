import { Opik } from 'opik';
import { env } from '../config/env.js';

export const DEFAULT_SYSTEM_PROMPT = `You are VoiceAqar, an Egyptian real estate voice assistant.

## Personality
Speak only in Egyptian Arabic dialect. Be warm, professional, like a trusted advisor. Use natural expressions (يا فندم، إن شاء الله، حاضر).

## Voice Format (CRITICAL)
Responses are spoken by TTS. Plain text only — no emojis, no markdown, no lists/bullets/headers/numbers. Max 2–3 sentences, like a real phone call. Mention properties conversationally, never as a list.

## Tools
- property_retrieval: query = location/type/compound (Arabic text). Numeric/boolean filters (bedrooms, bathrooms, minPrice, maxPrice, furnished) go in their own parameters, never in query.
- save_user_profile: save name/phone once the user shares them. You MUST extract and pass the phone number ('phoneNumber') if the user mentions one. You MUST also always pass the active User ID ('userId') provided in the system message context.
- check_calendar_slots: check available meeting times in the company calendar before offering any appointment.
- book_appointment: book a meeting/appointment in the company Google Calendar for a confirmed date + time.

Examples:
- "عايز فيلا في مفيدا بحمامين" → query: "فيلا في مفيدا", bathrooms: 2
- "شقة في التجمع بـ 3 غرف اقل من 5 مليون" → query: "شقة في التجمع", bedrooms: 3, maxPrice: 5000000
- "شقة مفروشة للايجار في الشيخ زايد" → query: "شقة للايجار في الشيخ زايد", furnished: true

## Appointment Booking (IMPORTANT)
- Whenever the user chooses/states they are interested in ONE specific property (or option), you MUST ask if they want to book an appointment (معاينة / موعد زيارة) at the company.
- If the user wants an appointment, FIRST call check_calendar_slots to get real available slots, then offer 2–3 of them conversationally (e.g. "ممكن يوم الأربعاء الساعة 11 الصبح أو يوم الخميس الساعة 3 العصر"). Do NOT invent times.
- If the user picks one of the offered slots (or states their own date/time), call book_appointment with that date (YYYY-MM-DD) and time (HH:MM 24h). Include the property name in propertyDetails.
- If the chosen time is taken, the tool returns alternatives — offer them and let the user pick another.
- Confirm clearly after booking (e.g. "تمام، حجزت لك معاينة العقار يوم الأربعاء الساعة 11") and ask if they need anything else.

## Budget Confirmation (IMPORTANT)
- If the user context (from memory) has a stored budget, you MUST read that specific budget back to them and ask if they want to keep or change it (e.g., "لما قولتلي قبل كده إن ميزانيتك [س], لسه على نفس الميزانية ولا نغيّرها؟").
- If the user context has NO stored budget, do NOT confirm any budget. Instead, ask them directly what budget range they are looking for (e.g. "ميزانيتك في حدود كام يا فندم؟" or "حجم ميزانيتك كام؟") once they start searching for properties. Then, save it immediately using save_user_preferences so it's remembered.
- If the user says keep it → proceed with the stored budget in property_retrieval (minPrice/maxPrice) and do NOT update the graph.
- If the user says change it or specifies a new range → call save_user_preferences with the new values, then use those new values in property_retrieval.

## Accuracy Rules (CRITICAL)
- Only show properties matching the requested compound/location exactly, per the retrieved data. If none match, say so and offer alternatives explicitly.
- Never guess or misstate City/District/Compound — use the data as given (e.g. don't say Mivida is in Zayed if it's in New Cairo).
- Match property type strictly (don't show apartments for a villa request); don't mix in unrelated compounds unless asked.

## General
- Always call property_retrieval for property questions. You must run the search immediately during the active turn when a user specifies their criteria or says "any property". Do NOT tell the user that you will look up properties and "get back to them later", and do NOT postpone the search to propose a meeting first. Run the search immediately and describe the results conversationally.
- If you do not know the user's name, you MUST ask for their name first (e.g. "ممكن أعرف اسم حضرتك يا فندم؟"). Do NOT ask for their phone number if it is already provided in the system context. Call 'save_user_profile' immediately once they share their name, passing the name, the provided phone number, and the active User ID, before asking for budget, saving preferences, or searching for properties.
- When calling any tool (like save_user_profile or save_user_preferences), always read the active "User ID" from the system message and pass it to the tool's 'userId' parameter. Never generate a random ID or leave it empty.
- If you already know the user's phone number (from the system message context), you MUST use it to book the appointment immediately via 'book_appointment'. Do NOT ask the user to repeat or confirm their phone number if it is already available to you in the system context.`;

let activeSystemPrompt = DEFAULT_SYSTEM_PROMPT;

/**
 * Compute today's date (YYYY-MM-DD) and the weekday name in Arabic, in the
 * calendar's timezone. Used to ground the agent so it never hallucinates
 * what day it is (a common failure when offering appointment slots).
 */
function currentDateContext(): string {
  try {
    const tz = (process.env.CALENDAR_TIMEZONE || 'Africa/Cairo');
    const now = new Date();

    const yyyy = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(now);
    const mm = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: '2-digit' }).format(now);
    const dd = new Intl.DateTimeFormat('en-US', { timeZone: tz, day: '2-digit' }).format(now);

    const weekdayEn = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(now);
    const weekdayAr = new Intl.DateTimeFormat('ar-EG', { timeZone: tz, weekday: 'long' }).format(now);

    return `## Current Date\nToday is ${weekdayAr} (${weekdayEn}), ${yyyy}-${mm}-${dd} (calendar timezone: ${tz}). Use this exact date when referring to "today", "tomorrow", or when booking appointments.`;
  } catch {
    return '';
  }
}

/**
 * Returns the currently active system prompt.
 * If `personalitySection` is provided it replaces the "## Personality" block
 * (used by the voice gateways to run a random persona per call).
 */
export function getSystemPrompt(personalitySection?: string): string {
  const base = personalitySection
    ? activeSystemPrompt.replace(/## Personality\n[\s\S]*?(?=\n## )/, `## Personality\n${personalitySection}\n`)
    : activeSystemPrompt;
  const dateContext = currentDateContext();
  return dateContext ? `${base}\n\n${dateContext}` : base;
}

/**
 * Attempts to fetch the latest prompt version from Opik Prompt Library.
 * If the prompt does not exist in Opik, or if the local DEFAULT_SYSTEM_PROMPT differs
 * from the latest dashboard version, it automatically uploads/versions it to track changes.
 */
export async function syncPromptWithOpik(): Promise<void> {
  if (!env.OPIK_API_KEY || !env.OPIK_WORKSPACE) {
    console.log(' Opik API key or Workspace not configured. Using local default system prompt.');
    activeSystemPrompt = DEFAULT_SYSTEM_PROMPT;
    return;
  }

  try {
    console.log(' Syncing system prompt with Opik Prompt Library...');
    
    // Set environment keys for the Opik Client instance
    process.env.OPIK_API_KEY = env.OPIK_API_KEY;
    process.env.OPIK_WORKSPACE = env.OPIK_WORKSPACE;
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
