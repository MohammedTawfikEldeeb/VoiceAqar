import assert from 'node:assert';
import { vectorDbService } from '../src/infrastructure/vectordb/index.js';
import { embeddingService } from '../src/infrastructure/embeddings/index.js';
import { agent, initializeAgent } from '../src/agent/voiceaqar_agent.js';

async function testLangGraphAgent() {
  console.log('🧪 Running LangGraph Agent & DB Checkpoint Integration Tests...\n');
  const collectionName = 'properties';

  try {
    // 1. Setup: Initialize Agent Checkpoint tables in PostgreSQL
    console.log('👉 Step 1: Initializing PostgreSQL Checkpointer tables...');
    await initializeAgent();
    console.log('✅ Checkpointer tables verified/created!');

    // 2. Setup: Seed Qdrant properties
    console.log('\n🧹 Setup: Cleaning up any old "properties" collection in Qdrant...');
    const initialList = await vectorDbService.listCollections();
    if (initialList.some(c => c.name === collectionName)) {
      await vectorDbService.deleteCollection(collectionName);
    }
    await vectorDbService.createCollection(collectionName, 384, 'Cosine');

    console.log('👉 Seeding a Fifth Settlement property into Qdrant...');
    const text1 = 'شقة للبيع في التجمع الخامس في كمبوند ماونتن فيو بمساحة 150 متر مربع تحتوي على 3 غرف نوم و2 حمام بسعر 4500000 جنيه';
    const vector1 = await embeddingService.generateEmbedding(text1, false);
    const prop1 = {
      id: 1,
      vector: vector1,
      payload: {
        titleAr: 'شقة فاخرة للبيع في التجمع الخامس',
        descriptionAr: text1,
        cityAr: 'القاهرة الجديدة',
        districtAr: 'التجمع الخامس',
        compoundName: 'ماونتن فيو',
        propertyType: 'شقة',
        offeringType: 'للبيع',
        price: '4500000',
        bedrooms: 3,
        bathrooms: 2,
        areaSqm: 150,
        furnished: false,
      }
    };
    await vectorDbService.upsertMany(collectionName, [prop1]);
    console.log('✅ Property seeded successfully!');

    // 3. First Turn: Ask the agent to find a property
    console.log('\n💬 Turn 1: Asking agent to search for a property...');
    const threadId = `test_thread_${Date.now()}`;
    const config = { configurable: { thread_id: threadId } };

    const response1 = await agent.invoke({
      messages: [{ role: 'user', content: 'بندور على شقة في التجمع' }]
    }, config);

    const reply1 = response1.messages[response1.messages.length - 1].content;
    console.log('\nAgent Reply 1:\n', reply1);

    assert.ok(reply1, 'Agent reply 1 should not be empty');
    assert.ok(reply1.includes('التجمع') || reply1.includes('ماونتن فيو') || reply1.includes('٤٥٠٠٠٠٠') || reply1.includes('4500000'), 'Agent should retrieve and mention the seeded property details');
    console.log('✅ Turn 1 passed successfully!');

    // 4. Second Turn (Persistence Check): Ask a follow-up query on the same thread
    console.log('\n💬 Turn 2: Asking follow-up query on the same thread (checking database checkpoint)...');
    const response2 = await agent.invoke({
      messages: [{ role: 'user', content: 'بكام سعرها؟ وكم عدد الغرف؟' }]
    }, config);

    const reply2 = response2.messages[response2.messages.length - 1].content;
    console.log('\nAgent Reply 2:\n', reply2);

    assert.ok(reply2, 'Agent reply 2 should not be empty');
    assert.ok(reply2.includes('4500000') || reply2.includes('٤٥٠٠٠٠٠') || reply2.includes('مليون') || reply2.includes('غرف') || reply2.includes('3'), 'Agent should remember the property from the checkpoint history and return price/rooms');
    console.log('✅ Turn 2 (Checkpoint Persistence) passed successfully!');

    // 5. Onboarding Turn: Introduce a new user and verify they are saved
    console.log('\n💬 Turn 3: Introducing a new user to test onboarding and profile registration...');
    const testPhone = `011${Math.floor(10000000 + Math.random() * 90000000)}`;
    const response3 = await agent.invoke({
      messages: [{ role: 'user', content: `أهلاً يا فندم، أنا اسمي أستاذ يوسف ورقم تليفوني هو ${testPhone}` }]
    }, config);

    const reply3 = response3.messages[response3.messages.length - 1].content;
    console.log('\nAgent Reply 3:\n', reply3);

    assert.ok(reply3, 'Agent reply 3 should not be empty');
    assert.ok(reply3.includes('يوسف') || reply3.includes('يوسف يا فندم') || reply3.includes('سجلت'), 'Agent should greet the user by name after saving the profile');
    console.log('✅ Turn 3 (Onboarding & Registration) passed successfully!');

    // 6. Cleanup
    console.log('\n🧹 Cleaning up: Deleting "properties" test collection...');
    await vectorDbService.deleteCollection(collectionName);
    console.log('✅ Clean up finished successfully!');

    console.log('\n----------------------------------------');
    console.log('🎉 LangGraph Agent & DB Checkpointer Integration Tests Passed Successfully!');
    
    setTimeout(() => {
      process.exit(0);
    }, 100);

  } catch (error: any) {
    console.error('\n❌ LangGraph Agent Integration Test FAILED:');
    console.error(error);
    setTimeout(() => {
      process.exit(1);
    }, 100);
  }
}

testLangGraphAgent();
