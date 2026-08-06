import readline from 'node:readline';
import { agent, initializeAgent, getAgentCallbacks } from '../src/agent/voiceaqar_agent.js';
import { memoryManager } from '../src/infrastructure/memory/index.js';
import { redis } from '../src/config/redis.js';

async function startTextChat() {
  console.log('🤖 VoiceAqar Text-Only Agent Chat Tester');
  console.log('═'.repeat(50));
  console.log('Starting infrastructure & schemas initialization...');
  
  try {
    await initializeAgent();
    console.log('✅ Initialization complete!');
  } catch (err) {
    console.error('❌ Failed to initialize infrastructure:', err);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const sessionId = `text_test_${Date.now()}`;
  const userId = `user_text_${Date.now()}`;
  
  console.log(`\n💬 Started new session: ${sessionId}`);
  console.log(`👤 User ID: ${userId}`);
  console.log('Type "exit" to quit the chat.\n');

  // 1. Simulate Call/Session Start
  await memoryManager.onCallStart(sessionId, userId);
  console.log('🤖 VoiceAqar: أهلاً بك في صوت عقار يا فندم! قولي، بتدور على شقة ولا ڤيلا؟ وممكن نتعرف باسم حضرتك الكريم؟\n');

  const askQuestion = () => {
    rl.question('👤 You: ', async (input) => {
      const trimmedInput = input.trim();
      
      if (trimmedInput.toLowerCase() === 'exit') {
        console.log('\nClosing chat session...');
        await memoryManager.onCallEnd(sessionId, userId);
        rl.close();
        
        // Disconnect redis for clean exit
        setTimeout(() => {
          redis.disconnect();
          process.exit(0);
        }, 200);
        return;
      }

      if (trimmedInput.length === 0) {
        askQuestion();
        return;
      }

      try {
        console.log('⏳ Thinking...');

        // 2. Memory Hook: User Message
        await memoryManager.onUserMessage(sessionId, trimmedInput, userId);

        // Fetch current contextual system prompt
        const agentContext = await memoryManager.getAgentContext(sessionId, userId);

        // 3. Invoke LangGraph Agent with Opik Tracing Callbacks
        const result = await agent.invoke(
          {
            messages: [{ role: 'user', content: trimmedInput }]
          },
          {
            configurable: { thread_id: sessionId },
            callbacks: getAgentCallbacks()
          }
        );

        const lastMessage = result.messages[result.messages.length - 1];
        const reply = typeof lastMessage.content === 'string'
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
        console.log(`\n🤖 VoiceAqar: ${reply}\n`);

        // 4. Memory Hook: Agent Response
        await memoryManager.onAgentResponse(sessionId, reply);

      } catch (err) {
        console.error('❌ Error processing input:', err);
      }

      askQuestion();
    });
  };

  askQuestion();
}

startTextChat();
