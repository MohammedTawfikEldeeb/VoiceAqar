/**
 * PCM Audio Processor Worklet
 * Captures raw 16kHz Int16 PCM audio from the microphone for WebSocket streaming.
 * Used by the Gemini Live voice mode in VoiceAqar.
 */
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0]; // Mono channel
    if (!channelData || channelData.length === 0) return true;

    // Convert Float32 [-1, 1] samples to Int16 [-32768, 32767]
    const int16 = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Post the Int16 PCM buffer to the main thread
    this.port.postMessage(int16.buffer, [int16.buffer]);

    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
