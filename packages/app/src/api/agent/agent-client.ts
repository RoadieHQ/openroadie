import type { AlertApi } from '../infrastructure/alert';

export interface AgentCallResult {
  success: boolean;
  response?: string;
  error?: string;
}

export type AIProvider = 'openai' | 'anthropic';

export interface OpenAISettings {
  apiKey: string;
}

export interface AnthropicSettings {
  apiKey: string;
}

export type ProviderSettings = Record<string, string>;

export interface AISettingsResponse {
  selectedProvider: AIProvider | null;
  settings: ProviderSettings | null;
  isConfigured?: boolean;
}

export interface AISettingsRequest {
  provider: AIProvider;
  settings: ProviderSettings;
}

export class AgentClient {
  constructor(
    private baseUrl: string,
    private fetch: typeof globalThis.fetch,
    private alertApi: AlertApi,
  ) {}

  async call<T = unknown>(options: {
    agentName: string;
    query: T;
    context?: Record<string, unknown>;
  }): Promise<AgentCallResult> {
    const { agentName, query } = options;

    try {
      const response = await this.fetch(
        `${this.baseUrl}/agents/${agentName}/call`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: JSON.stringify(query) }),
        },
      );

      if (response.ok) {
        const rawResponse = await response.text();
        if (rawResponse.length > 0) {
          return { success: true, response: rawResponse };
        }
        this.alertApi.post({
          message: 'Failed to generate response',
          severity: 'error',
        });
        return { success: false, error: 'Empty response generated' };
      }

      const errorText = await response.text();
      let error: string;
      try {
        const errorObj = JSON.parse(errorText);
        error = errorObj.error || errorText;
      } catch {
        error = errorText;
      }

      const errorMessage = error.includes('not properly configured')
        ? 'The AI plugin is not properly configured.'
        : `Failed to generate response: ${response.statusText}`;

      this.alertApi.post({ message: errorMessage, severity: 'error' });
      return { success: false, error: errorMessage };
    } catch (err: unknown) {
      const errorMessage = `Network error: ${
        err instanceof Error ? err.message : 'Unknown error'
      }`;
      this.alertApi.post({ message: errorMessage, severity: 'error' });
      return { success: false, error: errorMessage };
    }
  }

  async getSettings(): Promise<AISettingsResponse> {
    try {
      const response = await this.fetch(`${this.baseUrl}/settings`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        return await response.json();
      }

      return { selectedProvider: null, settings: null };
    } catch {
      return { selectedProvider: null, settings: null };
    }
  }

  async saveSettings(request: AISettingsRequest): Promise<AISettingsResponse> {
    // Must reject on failure: the AI settings form awaits this and only closes
    // the dialog / updates state on a resolved promise. Returning a value (or
    // toasting) on error would make a failed save look successful and drop the
    // user's input — the error is surfaced in-form via setError('root').
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
    } catch (err: unknown) {
      throw new Error(
        `Network error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      let error: string;
      try {
        const errorObj = JSON.parse(errorText);
        error = errorObj.error || errorText;
      } catch {
        error = errorText;
      }
      throw new Error(`Failed to save AI settings: ${error}`);
    }

    const saved = await response.json();
    this.alertApi.post({
      message: 'AI settings saved successfully',
      severity: 'success',
    });
    return saved;
  }
}
