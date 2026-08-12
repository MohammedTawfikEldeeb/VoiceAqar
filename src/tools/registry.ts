import { propertyRetrievalTool } from './property_retrieval_tool.js';
import { saveUserProfileTool } from './user_profile_tool.js';
import { saveUserPreferencesTool } from './user_preferences_tool.js';
import { checkSlotsTool, bookAppointmentTool } from './appointment_booking_tool.js';
import { memoryManager } from '../infrastructure/memory/index.js';

/**
 * Single source of truth for all agent tools.
 *
 * - LangGraph agent consumes `agentTools`.
 * - Voice gateways auto-generate Gemini function declarations from the same
 *   zod schemas via `getFunctionDeclarations()` (no hand-written duplication).
 * - Tool execution for voice is centralized in `executeToolCall()`.
 */
export const agentTools: any[] = [
  propertyRetrievalTool,
  saveUserProfileTool,
  saveUserPreferencesTool,
  checkSlotsTool,
  bookAppointmentTool,
];

/* ------------------------------------------------------------------ */
/* Zod v4 -> Gemini functionDeclaration schema converter               */
/* zod-to-json-schema is broken with zod v4, so we introspect directly.*/
/* ------------------------------------------------------------------ */

function zodToGeminiType(inner: any): string {
  switch (inner?._def?.type) {
    case 'string':
      return 'STRING';
    case 'number':
      return 'NUMBER';
    case 'boolean':
      return 'BOOLEAN';
    case 'array':
      return 'ARRAY';
    case 'object':
      return 'OBJECT';
    default:
      return 'STRING';
  }
}

function unwrapOptional(f: any): any {
  let cur = f;
  while (cur?._def?.type === 'optional' || cur?._def?.type === 'default') {
    cur = cur._def.innerType;
  }
  return cur ?? { _def: { type: 'string' } };
}

function convertSchema(schema: any): any {
  const shape = schema?.shape || {};
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(shape)) {
    const inner = unwrapOptional(field as any);
    const isOptional = (field as any)?._def?.type === 'optional';
    const hasDefault = (field as any)?._def?.type === 'default';

    const prop: any = {
      type: zodToGeminiType(inner),
    };
    if (inner.description) prop.description = inner.description;

    if (inner._def?.type === 'array') {
      const itemInner = unwrapOptional(inner._def.innerType);
      prop.items = { type: zodToGeminiType(itemInner) };
    }
    if (inner._def?.type === 'enum') {
      prop.enum = inner._def.values || inner._def.options;
    }

    properties[key] = prop;
    if (!isOptional && !hasDefault) required.push(key);
  }

  return { type: 'OBJECT', properties, required };
}

/**
 * Build Gemini Live functionDeclarations from the registered tools.
 * Generated once at module load; no per-gateway duplication.
 */
export const functionDeclarations = agentTools.map((tool) => ({
  name: tool.name,
  description: tool.description || '',
  parameters: convertSchema((tool as any).schema),
}));

/* ------------------------------------------------------------------ */
/* Centralized tool dispatcher for voice sessions                      */
/* ------------------------------------------------------------------ */

export interface ToolCallContext {
  sessionId: string;
  userId: string;
  phone: string;
}

function buildArgs(toolName: string, args: any, ctx: ToolCallContext): any {
  switch (toolName) {
    case 'save_user_profile':
      return {
        name: args.name,
        phoneNumber: args.phoneNumber || ctx.phone,
        userId: ctx.userId,
      };
    case 'save_user_preferences':
      return {
        userId: ctx.userId,
        preferredPropertyTypes: args.preferredPropertyTypes,
        minPrice: args.minPrice,
        maxPrice: args.maxPrice,
        currency: args.currency,
      };
    case 'book_appointment':
      return {
        date: args.date,
        time: args.time,
        userName: args.userName,
        userPhone: args.userPhone || ctx.phone,
        propertyDetails: args.propertyDetails,
      };
    default:
      return args;
  }
}

/**
 * Execute a tool by name, injecting session context where needed and
 * recording the result in memory. Returns a string safe for Gemini.
 */
export async function executeToolCall(toolName: string, args: any, ctx: ToolCallContext): Promise<string> {
  const tool = agentTools.find((t) => t.name === toolName);
  if (!tool) {
    return `Unknown tool: ${toolName}`;
  }
  try {
    const finalArgs = buildArgs(toolName, args, ctx);
    const res: any = await tool.invoke(finalArgs);
    const resultString = typeof res === 'string' ? res : (res.content as string || JSON.stringify(res));
    await memoryManager.onToolResult(ctx.sessionId, toolName, resultString);
    return resultString;
  } catch (e: any) {
    console.error(` Tool "${toolName}" failed:`, e);
    return `Error in ${toolName}: ${e.message}`;
  }
}

export default agentTools;