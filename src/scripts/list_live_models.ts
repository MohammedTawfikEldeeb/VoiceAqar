import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('Missing GEMINI_API_KEY');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function listLiveModels() {
  try {
    console.log('Fetching Gemini models via async iterator...');
    const response = await ai.models.list();
    
    console.log('\n--- Models supporting bidiGenerateContent ---');
    let count = 0;
    for await (const model of response) {
      const supportedMethods = (model as any).supportedMethods as string[] | undefined;
      if (supportedMethods && supportedMethods.some((m: string) => m.includes('bidiGenerateContent'))) {
        console.log(`- ${model.name} (${model.displayName})`);
        count++;
      }
    }
    if (count === 0) {
      console.log('No models found supporting bidiGenerateContent.');
    }
    
    console.log('\n--- All Gemini models available ---');
    const response2 = await ai.models.list();
    for await (const model of response2) {
      console.log(`- ${model.name} (${model.displayName}) | Methods: ${((model as any).supportedMethods as string[] | undefined)?.join(', ') ?? 'n/a'}`);
    }
  } catch (error) {
    console.error('Error listing models:', error);
  }
}

listLiveModels();
