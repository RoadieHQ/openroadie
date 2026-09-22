/**
 * Shared structural type for the JSONata AI-assist service.
 * Imported by jsonata-expression-field, filter-builder, and map-builder
 * so they all stay in sync.
 */
export interface JsonataAssistServiceLike {
  stream(
    request: {
      inputSample: unknown;
      description: string;
      transformType?: 'filter' | 'map';
    },
    onChunk: (text: string) => void,
    onComplete?: () => void,
    onError?: (error: Error) => void,
  ): Promise<void>;
}
