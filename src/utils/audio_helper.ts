// --- Mu-law G.711 Lookup Tables (Pure TS - no compile errors on Windows) ---
const muLawToLinearTable = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const mu = ~i;
  const sign = mu & 0x80;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0F;
  let sample = (mantissa << 3) + 132;
  sample <<= exponent;
  sample -= 132;
  muLawToLinearTable[i] = sign ? -sample : sample;
}

const linearToMuLawTable = new Uint8Array(65536);
for (let i = 0; i < 65536; i++) {
  let sample = i >= 32768 ? i - 65536 : i;
  const sign = sample < 0 ? 0x80 : 0x00;
  if (sample < 0) sample = -sample;
  if (sample > 32635) sample = 32635;
  sample += 128; // Bias
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent--;
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  linearToMuLawTable[i] = ~(sign | (exponent << 4) | mantissa);
}

/**
 * Decodes 8kHz 8-bit Mu-law (Twilio) to 8kHz 16-bit linear PCM.
 */
export function decodeMuLaw(muLawBuffer: Buffer): Buffer {
  const pcmBuffer = Buffer.alloc(muLawBuffer.length * 2);
  for (let i = 0; i < muLawBuffer.length; i++) {
    const sample = muLawToLinearTable[muLawBuffer[i]];
    pcmBuffer.writeInt16LE(sample, i * 2);
  }
  return pcmBuffer;
}

/**
 * Encodes 8kHz 16-bit linear PCM to 8kHz 8-bit Mu-law (Twilio).
 */
export function encodeMuLaw(pcm16Buffer: Buffer): Buffer {
  const muLawBuffer = Buffer.alloc(pcm16Buffer.length / 2);
  for (let i = 0; i < muLawBuffer.length; i++) {
    const sample = pcm16Buffer.readUint16LE(i * 2);
    muLawBuffer[i] = linearToMuLawTable[sample];
  }
  return muLawBuffer;
}

/**
 * Resamples 8kHz 16-bit Mono PCM to 16kHz 16-bit Mono PCM (Upsampling by 2x).
 */
export function resample8To16(pcm8Buffer: Buffer): Buffer {
  const pcm16Buffer = Buffer.alloc(pcm8Buffer.length * 2);
  const numSamples = pcm8Buffer.length / 2;
  for (let i = 0; i < numSamples; i++) {
    const sample = pcm8Buffer.readInt16LE(i * 2);
    pcm16Buffer.writeInt16LE(sample, i * 4);
    pcm16Buffer.writeInt16LE(sample, i * 4 + 2); // Simple duplicate sample interpolation
  }
  return pcm16Buffer;
}

/**
 * Resamples 24kHz 16-bit Mono PCM to 8kHz 16-bit Mono PCM (Downsampling by 3x).
 */
export function resample24To8(pcm24Buffer: Buffer): Buffer {
  const pcm8Buffer = Buffer.alloc(Math.floor(pcm24Buffer.length / 3));
  const numSamples = pcm8Buffer.length / 2;
  for (let i = 0; i < numSamples; i++) {
    const sample = pcm24Buffer.readInt16LE(i * 6); // Step by 6 bytes (3 samples)
    pcm8Buffer.writeInt16LE(sample, i * 2);
  }
  return pcm8Buffer;
}

/**
 * Prepend WAV header (RIFF) to raw PCM data buffer.
 */
export function createWavHeader(dataLength: number, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, 28);
  header.writeUInt16LE((channels * bitsPerSample) / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}
