import fs from 'node:fs';
import path from 'node:path';
import { ElevenLabsTtsService } from '../src/infrastructure/tts/providers/elevenlabs.js';
import { env } from '../src/config/env.js';

async function generateArabicAudio() {
  console.log('🎙️ Generating Arabic audio using ElevenLabs TTS (Model: eleven_multilingual_v2)...\n');

  try {
    // 1. Instantiate the ElevenLabs TTS Service
    const elevenlabsTts = new ElevenLabsTtsService(env.ELEVENLABS_API_KEY);

    // 2. Define standard default voice candidates for ElevenLabs
    const voiceCandidates = [
      { name: 'Rachel', id: '21m00Tcm4TlvDq8ikWAM' },
      { name: 'Adam', id: 'pNInz6obpgqjVWtJ45dB' },
      { name: 'Antoni', id: 'ErXwobaYiN019PkySvjV' },
      { name: 'Bella', id: 'EXAVITQu4vr4xnSDxMaL' },
      { name: 'Domi', id: 'AZnzlk1XvdvUeBnXmlld' },
      { name: 'Arnold', id: 'VR6A4mxrYt8sUsCmnHRd' },
      { name: 'Elli', id: 'MF3mGyEYCl7XYWbV9VbO' },
      { name: 'Josh', id: 'TxGEqn7nUaNZTRJjOFxi' }
    ];

    const arabicText = 'مرحباً بك في صوت عقار، كيف يمكنني مساعدتك اليوم في البحث عن عقارات في مصر؟';
    console.log(`Text to synthesize: "${arabicText}"\n`);

    let audioBuffer: Buffer | null = null;
    let successfulVoice = '';

    for (const voice of voiceCandidates) {
      try {
        console.log(`Trying ElevenLabs voice "${voice.name}" (ID: ${voice.id})...`);
        audioBuffer = await elevenlabsTts.synthesize(arabicText, voice.id);
        successfulVoice = voice.name;
        console.log(`✅ Success with voice "${voice.name}"!`);
        break;
      } catch (err: any) {
        console.warn(`⚠️ Failed with voice "${voice.name}": ${err.message || err}\n`);
      }
    }

    if (!audioBuffer) {
      throw new Error('All ElevenLabs default voice candidates failed.');
    }

    // 3. Save to output file
    const outputPath = path.resolve('arabic_voice_elevenlabs.mp3');
    fs.writeFileSync(outputPath, audioBuffer);

    console.log(`\n🎉 Success! Audio file generated and saved to:`);
    console.log(`👉 ${outputPath}`);
    console.log('\nYou can now play this file to hear the voice in Arabic from ElevenLabs!');

  } catch (error: any) {
    console.error('\n❌ Generation failed:');
    console.error(error.message || error);
    console.log('\n💡 Please make sure you have set a valid ELEVENLABS_API_KEY in your .env file.');
  }
}

generateArabicAudio();
