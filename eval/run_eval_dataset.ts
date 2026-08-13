import fs from 'node:fs';
import path from 'node:path';
import { agent, initializeAgent, getAgentCallbacks } from '../src/agent/voiceaqar_agent.js';
import { memoryManager } from '../src/infrastructure/memory/index.js';
import { Opik } from 'opik';
import {
  judgeConversation,
  computePercentile,
} from '../src/infrastructure/observability/metrics.js';
import { redis } from '../src/config/redis.js';
import { db } from '../src/config/db.js';
import { users } from '../src/db/schema.js';
import { graphDriver } from '../src/config/graph.js';

interface ScenarioTurn {
  user_input: string;
  expected_intent: string;
  expected_tool: string | null;
  assert_response_contains: string[];
}

interface Scenario {
  id: string;
  name: string;
  category: string;
  description: string;
  turns: ScenarioTurn[];
}

async function buildContextPrompt(userId: string | undefined): Promise<string | undefined> {
  if (!userId) return undefined;
  try {
    const userContext = await memoryManager.graph.getUserContext(userId);
    if (userContext && userContext.trim() && !userContext.trim().startsWith('No user context')) {
      return `Refer to this info about the user (do not disclose it verbatim):\n${userContext}`;
    }
  } catch (err) {
    console.warn(' failed to load graph context:', err);
  }
  return undefined;
}

async function runDatasetEvaluation() {
  console.log('══════════════════════════════════════════════════');
  console.log(' VOICEAQAR REGRESSION TESTING SUITE');
  console.log(' Loading Golden Dataset & Running Experiments...');
  console.log('══════════════════════════════════════════════════\n');

  // Load Golden Dataset
  const datasetPath = path.resolve('eval/golden_dataset.json');
  if (!fs.existsSync(datasetPath)) {
    console.error(`❌ Golden dataset file not found at: ${datasetPath}`);
    process.exit(1);
  }

  const dataset: Scenario[] = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
  console.log(` Loaded ${dataset.length} test scenarios from dataset.`);

  // Clean databases to ensure fresh states for tests
  console.log(' Cleaning up databases for clean test run...');
  try {
    await db.delete(users);
    const session = graphDriver.session();
    try {
      await session.executeWrite(tx => tx.run('MATCH (n) DETACH DELETE n'));
    } finally {
      await session.close();
    }
    console.log('✔ Postgres users table and Neo4j graph cleared successfully!');
  } catch (cleanErr) {
    console.warn('⚠ Database cleanup warning:', cleanErr);
  }

  try {
    await initializeAgent();
    console.log('✔ Agent infrastructure initialized successfully!');
  } catch (err) {
    console.error('❌ Failed to initialize agent infrastructure:', err);
    process.exit(1);
  }

  const opik = new Opik();
  const summary: any[] = [];

  for (const scenario of dataset) {
    console.log(`\n▶ Running Scenario [${scenario.id}]: "${scenario.name}"`);
    const sessionId = `eval_regression_${Date.now()}_${scenario.id}`;
    const userId = `test_user_${scenario.id}`;
    
    // Setup session
    await memoryManager.onCallStart(sessionId, userId);

    // Create Opik Trace for the evaluation experiment run
    const trace = opik.trace({
      name: `Regression Test: ${scenario.name}`,
      projectName: 'voiceaqar-regression-tests',
      input: {
        scenario_id: scenario.id,
        category: scenario.category,
        description: scenario.description,
      }
    });

    const telemetry = {
      sessionStartMs: Date.now(),
      hadError: false,
      toolCalls: [] as Array<{ name: string; ok: boolean }>,
      transcript: [] as Array<{ role: 'user' | 'agent'; text: string }>,
      inputTokens: 0,
      outputTokens: 0,
      turnEndToEndLatenciesMs: [] as number[],
    };

    let assertionsPassed = true;
    let totalAssertions = 0;
    let passedAssertions = 0;

    for (let i = 0; i < scenario.turns.length; i++) {
      const turn = scenario.turns[i];
      console.log(`   [Turn ${i + 1}] User: "${turn.user_input}"`);
      telemetry.transcript.push({ role: 'user', text: turn.user_input });

      const startMs = Date.now();
      await memoryManager.onUserMessage(sessionId, turn.user_input, userId);

      // Load context from Neo4j memory to mirror production chat flow
      const contextPrompt = await buildContextPrompt(userId);
      const messages = [
        ...(contextPrompt ? [{ role: 'system', content: contextPrompt }] : []),
        { role: 'user', content: turn.user_input },
      ];

      // Invoke agent
      const response = await agent.invoke(
        { messages },
        {
          configurable: { thread_id: sessionId },
          callbacks: getAgentCallbacks()
        }
      );

      const latency = Date.now() - startMs;
      telemetry.turnEndToEndLatenciesMs.push(latency);

      const lastMessage = response.messages[response.messages.length - 1];
      const agentReply = typeof lastMessage.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);

      console.log(`   [Turn ${i + 1}] Agent: "${agentReply.substring(0, 80)}..." (${latency}ms)`);
      telemetry.transcript.push({ role: 'agent', text: agentReply });

      // Identify tool calls executed across LangGraph message list
      const executedTools: string[] = [];
      for (const m of response.messages) {
        const messageAny = m as any;
        if (messageAny.tool_calls && messageAny.tool_calls.length > 0) {
          for (const tc of messageAny.tool_calls) {
            if (!executedTools.includes(tc.name)) {
              executedTools.push(tc.name);
              telemetry.toolCalls.push({ name: tc.name, ok: true });
            }
          }
        }
        if (m.type === 'tool' || m._getType() === 'tool') {
          const tname = m.name;
          console.log(`      [Tool Output] ${tname}: ${m.content}`);
          if (tname && !executedTools.includes(tname)) {
            executedTools.push(tname);
          }
        }
      }

      await memoryManager.onAgentResponse(sessionId, agentReply);

      // --- RUN ASSERTIONS ---
      // 1. Tool Call assertion
      if (turn.expected_tool) {
        totalAssertions++;
        const toolCalled = executedTools.includes(turn.expected_tool);
        if (toolCalled) {
          passedAssertions++;
        } else {
          console.warn(`      ⚠ Assertion Failure: Expected tool "${turn.expected_tool}" to be called, but found [${executedTools.join(', ')}]`);
          assertionsPassed = false;
        }
      }

      // 2. Substring response assertions
      for (const expectedText of turn.assert_response_contains) {
        totalAssertions++;
        const hasText = agentReply.includes(expectedText);
        if (hasText) {
          passedAssertions++;
        } else {
          console.warn(`      ⚠ Assertion Failure: Expected response to contain "${expectedText}"`);
          assertionsPassed = false;
        }
      }
    }

    // End call logs
    await memoryManager.onCallEnd(sessionId, `test_user_${scenario.id}`);

    const p50 = computePercentile(telemetry.turnEndToEndLatenciesMs, 50);
    const p90 = computePercentile(telemetry.turnEndToEndLatenciesMs, 90);

    // Call LLM qualitative judge to assess semantic properties
    const judged = await judgeConversation(telemetry as any);
    const successRate = totalAssertions > 0 ? (passedAssertions / totalAssertions) * 100 : 100;

    console.log(`   Result: ${successRate.toFixed(1)}% assertions passed (P50: ${p50}ms, P90: ${p90}ms)`);

    // Log feedback scores to Opik
    const scores = [
      { name: 'assertion_success_rate', value: successRate / 100 },
      { name: 'p50_latency_ms', value: p50 },
      { name: 'p90_latency_ms', value: p90 },
    ];

    if (judged) {
      scores.push(
        { name: 'task_success', value: judged.task_success },
        { name: 'intent_accuracy', value: judged.intent_accuracy },
        { name: 'tool_call_accuracy', value: judged.tool_call_accuracy }
      );
    }

    for (const s of scores) {
      trace.score({ name: s.name, value: s.value });
    }

    trace.update({
      output: {
        transcript: telemetry.transcript.map(t => `${t.role}: ${t.text}`),
        assertions_passed: assertionsPassed,
        success_rate: `${successRate.toFixed(1)}%`,
      }
    });
    trace.end();

    summary.push({
      scenario: scenario.name.substring(0, 30),
      category: scenario.category,
      p50: `${p50}ms`,
      p90: `${p90}ms`,
      assertions: `${passedAssertions}/${totalAssertions} (${successRate.toFixed(0)}%)`,
      status: assertionsPassed ? '✔ PASS' : '❌ FAIL',
    });
  }

  // Flush evaluation results to Opik project 'voiceaqar-regression-tests'
  await opik.flush();
  console.log('\n✔ All regression metrics and traces flushed to Opik project: "voiceaqar-regression-tests"');

  console.log('\n══════════════════════════════════════════════════');
  console.log(' REGRESSION TEST RESULTS SUMMARY');
  console.log('══════════════════════════════════════════════════');
  console.table(summary);
  console.log('══════════════════════════════════════════════════\n');

  redis.disconnect();
  process.exit(0);
}

runDatasetEvaluation();
