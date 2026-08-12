import assert from 'node:assert';
import { redis } from '../src/config/redis.js';
import { WorkingMemoryFactory } from '../src/infrastructure/memory/working/index.js';
import { RelationalMemoryFactory } from '../src/infrastructure/memory/relational/index.js';
import { GraphMemoryFactory } from '../src/infrastructure/memory/graph/index.js';
import { ContextWindowFactory } from '../src/infrastructure/memory/context/index.js';
import { MemoryManager } from '../src/infrastructure/memory/memory_manager.js';

const TEST_SESSION = `test_session_${Date.now()}`;
const TEST_USER = `test_user_${Date.now()}`;

async function testWorkingMemory() {
  console.log('\n Layer 1: Working & Session Memory (Redis)');
  console.log('─'.repeat(50));

  const wm = WorkingMemoryFactory.create();

  // 1. Create session
  console.log('   Creating session...');
  await wm.createSession(TEST_SESSION, { userId: TEST_USER, callType: 'inbound' });
  const session = await wm.getSession(TEST_SESSION);
  assert.ok(session, 'Session should exist after creation');
  assert.strictEqual(session.userId, TEST_USER, 'Session userId should match');
  console.log('   Session created and verified');

  // 2. Update session
  console.log('   Updating session...');
  await wm.updateSession(TEST_SESSION, { status: 'active' });
  const updated = await wm.getSession(TEST_SESSION);
  assert.strictEqual(updated?.status, 'active', 'Session status should be updated');
  console.log('   Session updated');

  // 3. Barge-in flags
  console.log('   Testing barge-in flags...');
  await wm.setBargeIn(TEST_SESSION, true);
  const bargeIn = await wm.getBargeIn(TEST_SESSION);
  assert.strictEqual(bargeIn, true, 'Barge-in should be true');
  await wm.setBargeIn(TEST_SESSION, false);
  const bargeInOff = await wm.getBargeIn(TEST_SESSION);
  assert.strictEqual(bargeInOff, false, 'Barge-in should be false');
  console.log('   Barge-in flags work correctly');

  // 4. Audio buffer flag
  console.log('   Testing audio buffer flag...');
  await wm.setAudioBufferFlag(TEST_SESSION, true);
  const audioFlag = await wm.getAudioBufferFlag(TEST_SESSION);
  assert.strictEqual(audioFlag, true, 'Audio buffer flag should be true');
  console.log('   Audio buffer flag works correctly');

  // 5. Conversation turns (sliding window)
  console.log('   Testing conversation turns...');
  await wm.pushTurn(TEST_SESSION, 'user', 'بندور على شقة في التجمع');
  await wm.pushTurn(TEST_SESSION, 'model', 'حاضر يا فندم، هادور لك على شقق في التجمع الخامس');
  await wm.pushTurn(TEST_SESSION, 'user', 'عايزها 3 غرف');
  const turns = await wm.getRecentTurns(TEST_SESSION);
  assert.strictEqual(turns.length, 3, 'Should have 3 turns');
  assert.strictEqual(turns[0].role, 'user', 'First turn should be user');
  assert.strictEqual(turns[1].role, 'model', 'Second turn should be model');
  console.log('   Sliding window works correctly');

  // 6. Delete session
  console.log('   Deleting session...');
  await wm.deleteSession(TEST_SESSION);
  const deleted = await wm.getSession(TEST_SESSION);
  assert.strictEqual(deleted, null, 'Session should be null after deletion');
  console.log('   Session deleted successfully');
}

async function testRelationalMemory() {
  console.log('\n Layer 2: Relational & Structured Memory (PostgreSQL)');
  console.log('─'.repeat(50));

  const rm = RelationalMemoryFactory.create();

  // 1. Get distinct values
  console.log('   Testing getDistinctValues...');
  const cities = await rm.getDistinctValues('cityAr');
  console.log(`   Found ${cities.length} distinct cities: ${cities.slice(0, 5).join(', ')}${cities.length > 5 ? '...' : ''}`);
  assert.ok(Array.isArray(cities), 'Cities should be an array');
  console.log('   getDistinctValues works');

  // 2. Query properties (broad query — no filters)
  console.log('   Testing queryProperties (no filters, limit 3)...');
  const allProps = await rm.queryProperties({}, 3);
  console.log(`   Found ${allProps.length} properties`);
  if (allProps.length > 0) {
    console.log(`   First property: ${allProps[0].titleAr} — ${allProps[0].price} EGP`);
  }
  console.log('   queryProperties works');

  // 3. Search properties by text
  console.log('   Testing searchProperties...');
  const searchResults = await rm.searchProperties('شقة', 3);
  console.log(`   Text search found ${searchResults.length} results`);
  console.log('   searchProperties works');

  // 4. Get property by ID (if any exist)
  if (allProps.length > 0) {
    console.log('   Testing getPropertyById...');
    const prop = await rm.getPropertyById(allProps[0].propertyId);
    assert.ok(prop, 'Property should exist');
    assert.strictEqual(prop.propertyId, allProps[0].propertyId, 'Property ID should match');
    console.log(`   getPropertyById works: ${prop.titleAr}`);
  }
}

async function testGraphMemory() {
  console.log('\n Layer 4: Preference & Relationship Memory (Neo4j)');
  console.log('─'.repeat(50));

  const gm = GraphMemoryFactory.create();

  // 1. Initialize (create constraints)
  console.log('   Initializing Neo4j constraints...');
  await gm.initialize();
  console.log('   Neo4j constraints created');

  // 2. Upsert user
  console.log('   Upserting test user...');
  await gm.upsertUser(TEST_USER, { name: 'Mohamed', phone: '+201234567890' });
  console.log('   User upserted');

  // 3. Add preferences
  console.log('   Adding preferences...');
  await gm.addPreference(TEST_USER, 'District', 'التجمع الخامس');
  await gm.addPreference(TEST_USER, 'District', 'الشيخ زايد');
  await gm.addPreference(TEST_USER, 'PropertyType', 'شقة');
  console.log('   Preferences added');

  // 4. Verify preferences
  console.log('   Retrieving preferences...');
  const prefs = await gm.getUserPreferences(TEST_USER);
  console.log(`   Found ${prefs.length} preferences`);
  assert.ok(prefs.length >= 3, 'Should have at least 3 preferences');
  console.log('   Preferences retrieved correctly');

  // 5. Set budget
  console.log('   Setting budget...');
  await gm.setBudget(TEST_USER, 3000000, 5000000, 'EGP');
  const budget = await gm.getUserBudget(TEST_USER);
  assert.ok(budget, 'Budget should exist');
  console.log(`   Budget: ${budget.min} - ${budget.max} ${budget.currency}`);
  console.log('   Budget set correctly');

  // 6. Add search history
  console.log('   Adding search history...');
  await gm.addSearchHistory(TEST_USER, 'شقة في التجمع الخامس');
  await gm.addSearchHistory(TEST_USER, 'فيلا بحديقة في الشيخ زايد');
  console.log('   Search history added');

  // 7. Add property interaction
  console.log('   Adding property interaction...');
  await gm.addPropertyInteraction(TEST_USER, 'prop_test_001', 'viewed');
  console.log('   Property interaction recorded');

  // 8. Get full user context
  console.log('   Getting user context summary...');
  const context = await gm.getUserContext(TEST_USER);
  console.log(`   Context:\n${context.split('\n').map(l => `     ${l}`).join('\n')}`);
  assert.ok(context.length > 0, 'User context should not be empty');
  console.log('   User context retrieved');

  // 9. Clear preferences
  console.log('   Clearing preferences...');
  await gm.clearUserPreferences(TEST_USER);
  const clearedPrefs = await gm.getUserPreferences(TEST_USER);
  assert.strictEqual(clearedPrefs.length, 0, 'Preferences should be cleared');
  console.log('   Preferences cleared');
}

async function testContextWindow() {
  console.log('\n Layer 5: Multimodal Context Window (In-Memory)');
  console.log('─'.repeat(50));

  const ctx = ContextWindowFactory.create();

  // 1. Build system prompt (no user context)
  console.log('   Building system prompt (no user context)...');
  const basePrompt = ctx.buildSystemPrompt();
  assert.ok(basePrompt.includes('VoiceAqar'), 'System prompt should mention VoiceAqar');
  assert.ok(basePrompt.includes('صوت عقار'), 'System prompt should contain Arabic name');
  console.log(`   System prompt length: ${basePrompt.length} chars`);
  console.log('   Base system prompt built');

  // 2. Build with user context
  console.log('   Building system prompt (with user context)...');
  const userCtx = 'User Preferences:\n- Preferred districts: التجمع الخامس';
  const enrichedPrompt = ctx.buildSystemPrompt(userCtx);
  assert.ok(enrichedPrompt.includes('التجمع الخامس'), 'Enriched prompt should include user preferences');
  console.log('   Enriched system prompt built');

  // 3. Tool results buffer
  console.log('   Testing tool results buffer...');
  ctx.addToolResult('property_retrieval', 'Found 3 apartments in Tagamoa');
  ctx.addToolResult('sql_property_query', 'Found 2 exact matches');
  const results = ctx.getToolResults();
  assert.strictEqual(results.length, 2, 'Should have 2 tool results');
  assert.strictEqual(results[0].source, 'tool:property_retrieval', 'First source should be property_retrieval');
  console.log('   Tool results buffer works');

  // 4. Memory summary injection
  console.log('   Testing memory summary injection...');
  ctx.injectMemorySummary('Budget: 3M-5M EGP, Prefers: التجمع الخامس');
  const liveCtx = ctx.getContextForLiveApi([
    { role: 'user', content: 'بندور على شقة' },
    { role: 'model', content: 'حاضر يا فندم' },
  ]);
  assert.ok(liveCtx.systemPrompt.includes('3M-5M'), 'Live context should include injected memory');
  assert.strictEqual(liveCtx.recentTurns.length, 2, 'Should have 2 recent turns');
  assert.strictEqual(liveCtx.recentToolResults.length, 2, 'Should have 2 tool results');
  console.log('   Live API context assembled correctly');

  // 5. Reset
  console.log('   Testing reset...');
  ctx.reset();
  const afterReset = ctx.getToolResults();
  assert.strictEqual(afterReset.length, 0, 'Tool results should be empty after reset');
  console.log('   Context window reset works');
}

async function testMemoryManager() {
  console.log('\n Memory Manager — Full Call Lifecycle Orchestration');
  console.log('─'.repeat(50));

  const mm = new MemoryManager();

  // 1. Initialize
  console.log('   Initializing MemoryManager...');
  await mm.initialize();
  console.log('   MemoryManager initialized');

  const sessionId = `lifecycle_test_${Date.now()}`;
  const userId = `lifecycle_user_${Date.now()}`;

  // 2. onCallStart
  console.log('   Simulating call start...');
  await mm.onCallStart(sessionId, userId);
  const session = await mm.working.getSession(sessionId);
  assert.ok(session, 'Session should exist after call start');
  assert.strictEqual(session.userId, userId, 'Session should contain userId');
  console.log('   Call started, session created');

  // 3. Record preferences
  console.log('   Recording user preferences...');
  await mm.recordPreference(userId, 'District', 'التجمع الخامس');
  await mm.recordBudget(userId, 2000000, 4000000);
  console.log('   Preferences recorded in knowledge graph');

  // 4. onUserMessage
  console.log('   Simulating user message...');
  await mm.onUserMessage(sessionId, 'بندور على شقة في التجمع', userId);
  console.log('   User message processed');

  // 5. onToolResult
  console.log('   Simulating tool result...');
  await mm.onToolResult(sessionId, 'property_retrieval', 'Found 5 apartments in Tagamoa');
  console.log('   Tool result recorded');

  // 6. onAgentResponse
  console.log('   Simulating agent response...');
  await mm.onAgentResponse(sessionId, 'لقيتلك 5 شقق في التجمع الخامس يا فندم');
  console.log('   Agent response recorded');

  // 7. getAgentContext
  console.log('   Getting full agent context...');
  const ctx = await mm.getAgentContext(sessionId, userId);
  assert.ok(ctx.systemPrompt.length > 100, 'System prompt should be substantial');
  assert.ok(ctx.recentTurns.length >= 2, 'Should have at least 2 recent turns');
  console.log(`   System prompt: ${ctx.systemPrompt.length} chars`);
  console.log(`   Recent turns: ${ctx.recentTurns.length}`);
  console.log('   Full agent context assembled from all memory layers');

  // 8. onCallEnd
  console.log('   Simulating call end...');
  await mm.onCallEnd(sessionId, userId);
  const afterEnd = await mm.working.getSession(sessionId);
  assert.strictEqual(afterEnd, null, 'Session should be cleaned up after call end');
  console.log('   Call ended, session cleaned up');

  // Cleanup: remove test user from Neo4j
  await mm.graph.clearUserPreferences(userId);
}

async function main() {
  console.log(' Running Memory Services Integration Tests');
  console.log('═'.repeat(50));

  try {
    await testWorkingMemory();
    await testRelationalMemory();
    await testGraphMemory();
    await testContextWindow();
    await testMemoryManager();

    console.log('\n' + '═'.repeat(50));
    console.log(' All Memory Services Integration Tests PASSED!');
    console.log('═'.repeat(50));

    // Graceful shutdown
    setTimeout(() => {
      redis.disconnect();
      process.exit(0);
    }, 200);

  } catch (error: any) {
    console.error('\n Memory Services Test FAILED:');
    console.error(error);
    setTimeout(() => {
      redis.disconnect();
      process.exit(1);
    }, 200);
  }
}

main();
