import assert from 'node:assert';
import { vectorDbService } from '../src/infrastructure/vectordb/index.js';
import { embeddingService } from '../src/infrastructure/embeddings/index.js';
import { propertyRetrievalTool } from '../src/tools/property_retrieval_tool.js';

async function testPropertyRetrievalTool() {
  console.log(' Running LangChain Property Retrieval Tool Tests...\n');
  const collectionName = 'properties';

  try {
    // 1. Setup: Ensure collection exists with E5 embeddings configuration
    console.log(' Setup: Cleaning up any old "properties" collection if it exists...');
    const initialList = await vectorDbService.listCollections();
    if (initialList.some(c => c.name === collectionName)) {
      await vectorDbService.deleteCollection(collectionName);
    }

    console.log(' Creating Qdrant collection "properties" with size 384 (multilingual-e5-small)...');
    await vectorDbService.createCollection(collectionName, 384, 'Cosine');

    // 2. Insert sample properties with real embeddings
    console.log(' Generating embeddings and upserting sample properties...');
    
    // Sample 1: Fifth Settlement Apartment
    const text1 = 'شقة فاخرة للبيع في التجمع الخامس القاهرة الجديدة بمساحة 150 متر مربع تحتوي على 3 غرف نوم و2 حمام';
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

    // Sample 2: Sheikh Zayed Villa
    const text2 = 'ڤيلا مستقلة للبيع في كمبوند زد الشيخ زايد بمساحة 300 متر مربع تحتوي على 5 غرف نوم و4 حمامات وبها حمام سباحة خاص';
    const vector2 = await embeddingService.generateEmbedding(text2, false);
    const prop2 = {
      id: 2,
      vector: vector2,
      payload: {
        titleAr: 'ڤيلا مستقلة للبيع في الشيخ زايد',
        descriptionAr: text2,
        cityAr: 'الشيخ زايد',
        districtAr: 'حي الأشجار',
        compoundName: 'زد',
        propertyType: 'ڤيلا',
        offeringType: 'للبيع',
        price: '15000000',
        bedrooms: 5,
        bathrooms: 4,
        areaSqm: 300,
        furnished: true,
      }
    };

    await vectorDbService.upsertMany(collectionName, [prop1, prop2]);
    console.log(' Upserted sample properties successfully!');

    // 3. Test Retrieval Tool for Fifth Settlement (التجمع)
    console.log('\n Test Case 1: Invoking retrieval tool for "شقة في التجمع"...');
    const result1 = await propertyRetrievalTool.invoke({ query: 'شقة في التجمع', limit: 1 });
    console.log('Result from Tool:\n', result1);
    
    assert.ok(result1.includes('التجمع الخامس'), 'Tool results should contain property in Fifth Settlement');
    assert.ok(result1.includes('ID: 1'), 'Tool results should contain property ID 1');
    assert.ok(!result1.includes('ID: 2'), 'Tool results should limit search and exclude Sheikh Zayed villa');
    console.log(' Test Case 1 passed!');

    // 4. Test Retrieval Tool for Sheikh Zayed (الشيخ زايد)
    console.log('\n Test Case 2: Invoking retrieval tool for "ڤيلا في زايد حمام سباحة"...');
    const result2 = await propertyRetrievalTool.invoke({ query: 'ڤيلا في زايد حمام سباحة', limit: 1 });
    console.log('Result from Tool:\n', result2);
    
    assert.ok(result2.includes('الشيخ زايد'), 'Tool results should contain property in Sheikh Zayed');
    assert.ok(result2.includes('ID: 2'), 'Tool results should contain property ID 2');
    assert.ok(!result2.includes('ID: 1'), 'Tool results should limit search and exclude Fifth Settlement apartment');
    console.log(' Test Case 2 passed!');

    // 5. Test Case 3: Filter Query
    console.log('\n Test Case 3: Invoking retrieval tool with filter for city = "الشيخ زايد"...');
    const result3 = await propertyRetrievalTool.invoke({
      query: 'شقة في التجمع', // query matches Fifth Settlement, but filter should force Sheikh Zayed
      filter: {
        must: [
          {
            key: 'cityAr',
            match: {
              value: 'الشيخ زايد'
            }
          }
        ]
      },
      limit: 1
    });
    console.log('Result from Tool with filter:\n', result3);
    
    assert.ok(result3.includes('الشيخ زايد'), 'Filtered tool results should contain property in Sheikh Zayed due to filter');
    assert.ok(result3.includes('ID: 2'), 'Filtered tool results should contain property ID 2');
    assert.ok(!result3.includes('ID: 1'), 'Filtered tool results should exclude Fifth Settlement apartment due to filter');
    console.log(' Test Case 3 passed!');

    // 6. Cleanup
    console.log('\n Cleaning up: Deleting "properties" test collection...');
    await vectorDbService.deleteCollection(collectionName);
    console.log(' Clean up finished successfully!');

    console.log('\n----------------------------------------');
    console.log(' All LangChain Property Retrieval Tool Tests Passed Successfully!');
    
    setTimeout(() => {
      process.exit(0);
    }, 100);

  } catch (error) {
    console.error('\n LangChain Property Retrieval Tool Test FAILED:');
    console.error(error);
    setTimeout(() => {
      process.exit(1);
    }, 100);
  }
}

testPropertyRetrievalTool();
