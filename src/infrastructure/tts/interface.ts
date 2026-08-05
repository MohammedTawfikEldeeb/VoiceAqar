export interface ITtsService {
  /**
   * Synthesize text into speech audio bytes.
   * @param text The input text to read out loud.
   * @param voiceName Optional voice name (e.g. 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Kore').
   * @returns Promise resolving to a Buffer of audio bytes (MP3/WAV format).
   */
  synthesize(text: string, voiceName?: string): Promise<Buffer>;
}
export default ITtsService;
