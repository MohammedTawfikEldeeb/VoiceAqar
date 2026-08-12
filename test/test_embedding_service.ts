import assert from 'node:assert';
import { embeddingService } from '../src/infrastructure/embeddings/index.js';

async function runEmbeddingTests() {
  console.log(' Running Embedding Service Unit Tests...\n');

  try {
    // 1. Verify dimensions
    console.log(' Test Step 1: Checking model dimension...');
    const dimension = embeddingService.getDimension();
    console.log(`Model dimension is: ${dimension}`);
    assert.strictEqual(dimension, 384, 'Xenova/multilingual-e5-small must output 384-dimensional vectors');
    console.log(' Dimension check passed!');

    // 2. Generate single embedding for Arabic text
    console.log('\n Test Step 2: Generating single embedding for Arabic text...');
    const arabicText = 'بحث عن شقة ثلاث غرف في القاهرة الجديدة بسعر مناسب';
    const vector = await embeddingService.generateEmbedding(arabicText, true);
    
    assert.ok(Array.isArray(vector), 'Result must be an array');
    assert.strictEqual(vector.length, 384, 'Returned vector length must match 384');
    assert.ok(vector.every(val => typeof val === 'number'), 'All vector items must be numbers');
    
    console.log(`Vector generated successfully!`);
    console.log(`First 5 values: [${vector.slice(0, 5).join(', ')}]`);
    console.log(' Single embedding generation passed!');

    // 3. Generate batch embeddings
    console.log('\n Test Step 3: Generating batch embeddings for multiple Arabic texts...');
    const texts = [
      'ڤيلا للبيع في كمبوند ماونتن فيو الشيخ زايد',
      'شاليه صف أول على البحر في الساحل الشمالي'
    ];
    const vectors = await embeddingService.generateEmbeddings(texts, false);
    
    assert.ok(Array.isArray(vectors), 'Result must be an array of vectors');
    assert.strictEqual(vectors.length, 2, 'Should return exactly 2 vectors');
    assert.strictEqual(vectors[0].length, 384, 'First vector should have length 384');
    assert.strictEqual(vectors[1].length, 384, 'Second vector should have length 384');
    
    console.log(' Batch embedding generation passed!');

    console.log('\n----------------------------------------');
    console.log(' All Embedding Service Unit Tests Passed Successfully!');
    
    setTimeout(() => {
      process.exit(0);
    }, 100);

  } catch (error) {
    console.error('\n Embedding Service Unit Test FAILED:');
    console.error(error);
    setTimeout(() => {
      process.exit(1);
    }, 100);
  }
}

runEmbeddingTests();
