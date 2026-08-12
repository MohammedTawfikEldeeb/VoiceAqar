import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { env } from '../src/config/env.js';

/**
 * Prepend a standard WAV header to raw PCM audio data.
 */
function pcmToWav(pcmBuffer: Buffer, sampleRate: number = 24000): Buffer {
  const header = Buffer.alloc(44);
  
  // "RIFF"
  header.write('RIFF', 0);
  // File size - 8
  header.writeUInt32LE(pcmBuffer.length + 36, 4);
  // "WAVE"
  header.write('WAVE', 8);
  // "fmt " chunk
  header.write('fmt ', 12);
  // Chunk size (16)
  header.writeUInt32LE(16, 16);
  // Audio format (1 = uncompressed PCM)
  header.writeUInt16LE(1, 20);
  // Channels (1 = mono)
  header.writeUInt16LE(1, 22);
  // Sample rate (24000 Hz default for Gemini)
  header.writeUInt32LE(sampleRate, 24);
  // Byte rate = sampleRate * channels * bytesPerSample (2 bytes for 16-bit)
  header.writeUInt32LE(sampleRate * 1 * 2, 28);
  // Block align = channels * bytesPerSample
  header.writeUInt16LE(1 * 2, 32);
  // Bits per sample (16 bit)
  header.writeUInt16LE(16, 34);
  // "data" chunk
  header.write('data', 36);
  // Data chunk size
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

async function debugGeminiTts() {
  console.log(' Generating Arabic audio using Gemini 2.5 Flash TTS...');

  try {
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: `Read the following text out loud in clear, natural Egyptian Arabic dialect (بالعامية المصرية). Do not add any text other than reading it word-for-word: "يا هلا بيك في صوت عقار يا فندم! قولي، بندور على شقة ولا ڤيلا؟ وعايزها في التجمع الخامس ولا الشيخ زايد؟"`,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Puck',
            }
          }
        }
      } as any
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (!part) {
      console.log('No part found in candidate response.');
      return;
    }

    if (part.inlineData) {
      const mimeType = part.inlineData.mimeType;
      console.log(`\n Success! MimeType returned by Gemini: "${mimeType}"`);
      
      let rawBuffer = Buffer.from(part.inlineData.data, 'base64');
      let finalBuffer = rawBuffer;
      let ext = 'raw';

      if (mimeType.includes('wav')) {
        ext = 'wav';
      } else if (mimeType.includes('mpeg') || mimeType.includes('mp3')) {
        ext = 'mp3';
      } else if (mimeType.includes('aac')) {
        ext = 'aac';
      } else if (mimeType.includes('ogg')) {
        ext = 'ogg';
      } else if (mimeType.includes('pcm')) {
        // If the API returned raw PCM audio, package it as standard playable WAV
        console.log('Detected raw PCM. Prepending WAV header (24kHz Mono 16-bit)...');
        finalBuffer = pcmToWav(rawBuffer, 24000);
        ext = 'wav';
      }

      const filename = `arabic_voice_gemini.${ext}`;
      const outputPath = path.resolve(filename);
      fs.writeFileSync(outputPath, finalBuffer);

      console.log(`\n Audio file saved to:`);
      console.log(` ${outputPath}`);
      console.log(`\nYou can play this file directly using VLC, Windows Media Player, or any browser!`);
    } else {
      console.log('Part did not contain inlineData.', part);
    }

  } catch (error: any) {
    console.error(' Generation failed:');
    console.error(error.message || error);
  }
}

debugGeminiTts();
