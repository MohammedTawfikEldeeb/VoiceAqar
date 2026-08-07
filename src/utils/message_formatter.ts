import { BaseMessage, AIMessage } from '@langchain/core/messages';


export function formatLangChainMessagesToOpenAI(messages: BaseMessage[]): any[] {
  return messages.map(msg => {
    const role = msg._getType();
    const formatted: any = {
      content: msg.content,
    };

    if (role === 'system') {
      formatted.role = 'system';
    } else if (role === 'human') {
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

    return formatted;
  });
}
