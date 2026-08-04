export interface IEmbeddingService {
  /**
   * Generate an embedding vector for a single string.
   * @param text The input string to embed.
   * @param isQuery Boolean specifying if the string is a search query (relevant for models like E5).
   */
  generateEmbedding(text: string, isQuery?: boolean): Promise<number[]>;

  /**
   * Generate embedding vectors for multiple strings.
   * @param texts Array of input strings to embed.
   * @param isQuery Boolean specifying if the strings are search queries.
   */
  generateEmbeddings(texts: string[], isQuery?: boolean): Promise<number[][]>;

  /**
   * Get the dimension of the embedding vectors returned by this service.
   */
  getDimension(): number;
}
export default IEmbeddingService;
