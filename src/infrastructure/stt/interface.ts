export interface ISttService {
  /**
   * Transcribe speech audio bytes into text.
   * @param audioBuffer Buffer containing the audio bytes.
   * @param mimeType MIME type of the audio format (e.g. 'audio/wav', 'audio/mp3', 'audio/webm', 'audio/ogg').
   * @param prompt Optional instruction prompt to guide transcription (e.g., custom vocabulary or translation requirements).
   * @returns Promise resolving to the transcribed text.
   */
  transcribe(audioBuffer: Buffer, mimeType: string, prompt?: string): Promise<string>;
}
export default ISttService;
