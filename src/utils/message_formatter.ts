import { BaseMessage, AIMessage } from '@langchain/core/messages';


export function formatLangChainMessagesToOpenAI(messages: BaseMessage[]): any[] {
  const result: any[] = [];
  const systemContents: string[] = [];

  for (const msg of messages) {
    const role = msg._getType();
    if (role === 'system') {
      if (typeof msg.content === 'string') {
        systemContents.push(msg.content);
      }
    } else {
      const formatted: any = {
        content: msg.content,
      };
      if (role === 'human') {
        formatted.role = 'user';
      } else if (role === 'ai') {
        formatted.role = 'assistant';
        const aiMsg = msg as AIMessage;
        if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
          formatted.tool_calls = aiMsg.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args)
            }
          }));
        }
      } else if (role === 'tool') {
        formatted.role = 'tool';
        const toolMsg = msg as any;
        formatted.tool_call_id = toolMsg.tool_call_id;
      }
      result.push(formatted);
    }
  }

  // Prepend single merged system message if there are any
  if (systemContents.length > 0) {
    result.unshift({
      role: 'system',
      content: systemContents.join('\n\n---\n\n')
    });
  }

  return result;
}
