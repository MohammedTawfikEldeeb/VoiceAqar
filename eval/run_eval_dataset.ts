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
import { eq } from 'drizzle-orm';

interface ScenarioTurn {
  user_input: string;
  expected_tool: string | null;
  expected_tool_args?: Record<string, any>;
  expected_property_ids?: string[];
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
    const pgUsers = await db.select().from(users).where(eq(users.userId, userId)).limit(1);
    
    let fullContext = '';
    if (pgUsers.length > 0) {
      fullContext += `User Profile details (from PostgreSQL):\n- Name: ${pgUsers[0].name}\n- Phone: ${pgUsers[0].phoneNumber}\n\n`;
    }
    if (userContext && userContext.trim() && !userContext.trim().startsWith('No user context')) {
      fullContext += `User Preferences (from Neo4j):\n${userContext}`;
    }
    
    return fullContext.trim() || undefined;
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
    console.error(`Golden dataset file not found at: ${datasetPath}`);
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
    console.log(' Postgres users table and Neo4j graph cleared successfully!');
  } catch (cleanErr) {
    console.warn(' Database cleanup warning:', cleanErr);
  }

  try {
    await initializeAgent();
    console.log(' Agent infrastructure initialized successfully!');
  } catch (err) {
    console.error(' Failed to initialize agent infrastructure:', err);
    process.exit(1);
  }

  const opik = new Opik();
  const summary: any[] = [];

  for (const scenario of dataset) {
    console.log(`\n Running Scenario [${scenario.id}]: "${scenario.name}"`);
    const sessionId = `eval_regression_${Date.now()}_${scenario.id}`;
    const userId = `test_user_${scenario.id}`;
    
    // Setup session
    await memoryManager.onCallStart(sessionId, userId);

    // Pre-seed user state for specific scenarios to bypass conversational onboarding loops during search/appointment tests
    if (scenario.id === 'scenario_02_property_search_semantic' ||
        scenario.id === 'scenario_03_property_search_structured' ||
        scenario.id === 'scenario_05_check_calendar_slots' ||
        scenario.id === 'scenario_06_book_appointment' ||
        scenario.id === 'scenario_09_multi_turn_history') {
      try {
        // 1. Seed user in Postgres
        await db.insert(users).values({
          userId,
          name: 'يوسف كامل',
          phoneNumber: '01022334455',
        }).onConflictDoNothing();

        // 2. Seed user in Neo4j
        await memoryManager.graph.upsertUser(userId, { name: 'يوسف كامل' });

        // 3. Pre-seed budget for these scenarios to prevent budget questions and allow immediate execution
        if (scenario.id === 'scenario_02_property_search_semantic' ||
            scenario.id === 'scenario_05_check_calendar_slots' ||
            scenario.id === 'scenario_06_book_appointment' ||
            scenario.id === 'scenario_09_multi_turn_history') {
          await memoryManager.graph.setBudget(userId, 3000000, 10000000, 'EGP');
        }
        if (scenario.id === 'scenario_03_property_search_structured') {
          await memoryManager.graph.setBudget(userId, 3000000, 6000000, 'EGP');
        }
      } catch (seedErr) {
        console.warn(`⚠ Failed to pre-seed database state for scenario ${scenario.id}:`, seedErr);
      }
    }

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

    // Generate a valid future date (e.g. 2 days from now) to prevent booking past-date failures
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 2);
    const futureDateStr = futureDate.toISOString().slice(0, 10);

    for (let i = 0; i < scenario.turns.length; i++) {
      const turn = scenario.turns[i];
      
      // Resolve dynamic date placeholders in user input
      let userInput = turn.user_input;
      if (userInput.includes('{FUTURE_DATE}')) {
        userInput = userInput.replace(/{FUTURE_DATE}/g, futureDateStr);
      }

      console.log(`   [Turn ${i + 1}] User: "${userInput}"`);
      telemetry.transcript.push({ role: 'user', text: userInput });

      const startMs = Date.now();
      await memoryManager.onUserMessage(sessionId, userInput, userId);

      // Load context from Neo4j memory to mirror production chat flow
      const contextPrompt = await buildContextPrompt(userId);
      const sessionInfo = `Active Session Information:\n- User ID: ${userId}`;
      const messages = [
        { role: 'system', content: sessionInfo },
        ...(contextPrompt ? [{ role: 'system', content: `Refer to this info about the user (do not disclose it verbatim):\n${contextPrompt}` }] : []),
        { role: 'user', content: userInput },
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
      const executedTools: Array<{ name: string; args: any }> = [];
      const toolOutputs: Array<{ name: string; content: string }> = [];
      for (const m of response.messages) {
        const messageAny = m as any;
        if (messageAny.tool_calls && messageAny.tool_calls.length > 0) {
          for (const tc of messageAny.tool_calls) {
            if (!executedTools.some(t => t.name === tc.name)) {
              executedTools.push({ name: tc.name, args: tc.args });
              telemetry.toolCalls.push({ name: tc.name, ok: true });
            }
          }
        }
        if (m.type === 'tool' || m._getType() === 'tool') {
          const tname = m.name || '';
          const content = typeof m.content === 'string'
            ? m.content
            : JSON.stringify(m.content || '');
          console.log(`      [Tool Output] ${tname}: ${content}`);
          toolOutputs.push({ name: tname, content });
        }
      }

      await memoryManager.onAgentResponse(sessionId, agentReply);

      // --- RUN ASSERTIONS ---
      // 1. Tool Call assertion
      if (turn.expected_tool) {
        totalAssertions++;
        const toolCall = executedTools.find(t => t.name === turn.expected_tool);
        if (toolCall) {
          passedAssertions++;

          // 2. Tool Arguments assertion (if expected_tool_args is defined)
          if (turn.expected_tool_args) {
            // Resolve FUTURE_DATE placeholder in expected values dynamically
            const resolvedArgs = JSON.parse(
              JSON.stringify(turn.expected_tool_args).replace(/{FUTURE_DATE}/g, futureDateStr)
            );
            for (const [key, expectedValue] of Object.entries(resolvedArgs)) {
              totalAssertions++;
              const actualValue = toolCall.args[key];
              
              if (key === 'query' && typeof expectedValue === 'string' && typeof actualValue === 'string') {
                // Check if search query contains the expected location/compound keyword
                const match = actualValue.toLowerCase().includes(expectedValue.toLowerCase()) || 
                              expectedValue.toLowerCase().includes(actualValue.toLowerCase());
                if (match) {
                  passedAssertions++;
                } else {
                  console.warn(`      ⚠ Argument Failure: Expected query to contain keyword "${expectedValue}", but got "${actualValue}"`);
                  assertionsPassed = false;
                }
              } else {
                // Direct exact match for parameters (bedrooms, price, user ID, etc.)
                if (actualValue === expectedValue) {
                  passedAssertions++;
                } else {
                  console.warn(`      ⚠ Argument Failure: Expected parameter "${key}" to be ${JSON.stringify(expectedValue)}, but got ${JSON.stringify(actualValue)}`);
                  assertionsPassed = false;
                }
              }
            }
          }
        } else {
          console.warn(`      ⚠ Assertion Failure: Expected tool "${turn.expected_tool}" to be called, but found [${executedTools.map(t => t.name).join(', ')}]`);
          assertionsPassed = false;
        }
      }

      // 2. Expected Property IDs checking (Retrieval Output verification)
      if (turn.expected_property_ids && turn.expected_property_ids.length > 0) {
        // Find the outputs from the property_retrieval tool
        const retrievalOutput = toolOutputs.find(o => o.name === 'property_retrieval');
        if (retrievalOutput) {
          for (const expectedId of turn.expected_property_ids) {
            totalAssertions++;
            const match = retrievalOutput.content.toLowerCase().includes(expectedId.toLowerCase());
            if (match) {
              passedAssertions++;
            } else {
              console.warn(`      ⚠ Retrieval Failure: Expected retrieved property payload to contain "${expectedId}"`);
              assertionsPassed = false;
            }
          }
        } else {
          totalAssertions += turn.expected_property_ids.length;
          console.warn(`      ⚠ Retrieval Failure: Expected property retrieval outputs containing ${JSON.stringify(turn.expected_property_ids)}, but tool "property_retrieval" was not run`);
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
