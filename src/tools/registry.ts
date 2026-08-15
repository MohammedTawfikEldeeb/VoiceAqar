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

function coerceArgs(schema: any, args: any): any {
  if (!schema || !schema.shape || !args) return args;

  const coerced: Record<string, any> = { ...args };

  for (const [key, field] of Object.entries(schema.shape)) {
    const val = args[key];
    if (val === undefined) continue;

    // unwrap optional, default, nullable to find expected inner type
    let cur = field as any;
    let isNullable = false;
    let isOptional = false;

    while (
      cur?._def?.type === 'optional' ||
      cur?._def?.type === 'nullable' ||
      cur?._def?.type === 'default'
    ) {
      if (cur._def.type === 'nullable') isNullable = true;
      if (cur._def.type === 'optional') isOptional = true;
      cur = cur._def.innerType;
    }

    const typeName = cur?._def?.type || cur?._def?.typeName;

    // If the input is null
    if (val === null) {
      if (!isNullable && isOptional) {
        delete coerced[key];
      }
      continue;
    }

    // If the input is an empty string
    if (val === '') {
      if (typeName !== 'string' && typeName !== 'ZodString') {
        if (isNullable) {
          coerced[key] = null;
        } else if (isOptional) {
          delete coerced[key];
        } else {
          delete coerced[key];
        }
        continue;
      }
    }

    // Coerce numeric types
    if (typeName === 'number' || typeName === 'ZodNumber') {
      if (typeof val === 'string') {
        const num = Number(val);
        if (!isNaN(num)) {
          coerced[key] = num;
        } else {
          if (isNullable) {
            coerced[key] = null;
          } else if (isOptional) {
            delete coerced[key];
          }
        }
      }
    }
    // Coerce boolean types
    else if (typeName === 'boolean' || typeName === 'ZodBoolean') {
      if (typeof val === 'string') {
        if (val.toLowerCase() === 'true') {
          coerced[key] = true;
        } else if (val.toLowerCase() === 'false') {
          coerced[key] = false;
        } else {
          coerced[key] = Boolean(val);
        }
      }
    }
    // Coerce arrays
    else if (typeName === 'array' || typeName === 'ZodArray') {
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) {
            coerced[key] = parsed;
          } else {
            coerced[key] = [val];
          }
        } catch {
          if (val.includes(',')) {
            coerced[key] = val.split(',').map((s: string) => s.trim());
          } else {
            coerced[key] = [val];
          }
        }
      }
    }
  }

  return coerced;
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
    const coercedArgs = coerceArgs(tool.schema, finalArgs);
    const res: any = await tool.invoke(coercedArgs);
    const resultString = typeof res === 'string' ? res : (res.content as string || JSON.stringify(res));
    await memoryManager.onToolResult(ctx.sessionId, toolName, resultString);
    return resultString;
  } catch (e: any) {
    console.error(` Tool "${toolName}" failed:`, e);
    return `Error in ${toolName}: ${e.message}`;
  }
}

export default agentTools;