import assert from 'node:assert';
import { vectorDbService as qdrantService } from '../src/infrastructure/vectordb/index.js';

async function runQdrantUnitTests() {
  console.log(' Running Qdrant Service Unit Tests...\n');
  const collectionName = 'test_qdrant_unit_collection';

  try {
    // Setup: Ensure clean environment before starting
    console.log(' Setup: Cleaning up any old test collection if it exists...');
    const initialCollections = await qdrantService.listCollections();
    if (initialCollections.some(c => c.name === collectionName)) {
      await qdrantService.deleteCollection(collectionName);
      console.log(` Deleted existing test collection "${collectionName}"`);
    }

    // 1. Test Create Collection
    console.log('\n Test Step 1: Creating collection...');
    const createSuccess = await qdrantService.createCollection(collectionName, 4, 'Cosine');
    assert.strictEqual(createSuccess, true, 'Collection creation should return true');
    console.log(' createCollection passed!');

    // 2. Test Get Collection Info
    console.log('\n Test Step 2: Retrieving collection details...');
    const info = await qdrantService.getCollection(collectionName) as any;
    assert.ok(info, 'Collection info should be returned');
    assert.strictEqual(info.status, 'green', 'Collection status should be green');
    console.log(' getCollection passed!');

    // 3. Test List Collections
    console.log('\n Test Step 3: Listing collections...');
    const list = await qdrantService.listCollections();
    const collectionFound = list.some(c => c.name === collectionName);
    assert.strictEqual(collectionFound, true, `Collection "${collectionName}" should be present in listed collections`);
    console.log(' listCollections passed!');

    // 4. Test Delete Collection
    console.log('\n Test Step 4: Deleting collection...');
    const deleteSuccess = await qdrantService.deleteCollection(collectionName);
    assert.strictEqual(deleteSuccess, true, 'Collection deletion should return true');
    console.log(' deleteCollection passed!');

    // 5. Test List Collections (After Deletion)
    console.log('\n Test Step 5: Listing collections after deletion...');
    const postDeleteList = await qdrantService.listCollections();
    const collectionStillExists = postDeleteList.some(c => c.name === collectionName);
    assert.strictEqual(collectionStillExists, false, `Collection "${collectionName}" should NOT be present in list after deletion`);
    console.log(' Post-delete listCollections verified!');

    console.log('\n----------------------------------------');
    console.log(' All Qdrant Service Unit Tests Passed Successfully!');

    setTimeout(() => {
      process.exit(0);
    }, 100);

  } catch (error) {
    console.error('\n Qdrant Service Unit Test FAILED:');
    console.error(error);
    setTimeout(() => {
      process.exit(1);
    }, 100);
  }
}


runQdrantUnitTests();
