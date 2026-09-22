import { ResponseError } from '../infrastructure';

export type McpToolSettings = {
  name: string;
  description: string;
  enabled: boolean;
};

export type McpServerSettings = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  tools: McpToolSettings[];
};

export class McpSettingsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetch: typeof globalThis.fetch,
  ) {}

  async getServers(): Promise<McpServerSettings[]> {
    const response = await this.fetch(`${this.baseUrl}/servers`);
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    const data = (await response.json()) as { servers: McpServerSettings[] };
    return data.servers;
  }

  async setServersEnabled(
    updates: Array<{ id: string; enabled: boolean }>,
  ): Promise<McpServerSettings[]> {
    const response = await this.fetch(`${this.baseUrl}/servers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ servers: updates }),
    });
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    const data = (await response.json()) as { servers: McpServerSettings[] };
    return data.servers;
  }

  async setToolsEnabled(
    updates: Array<{ name: string; enabled: boolean }>,
  ): Promise<McpServerSettings[]> {
    const response = await this.fetch(`${this.baseUrl}/tools`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tools: updates }),
    });
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    const data = (await response.json()) as { servers: McpServerSettings[] };
    return data.servers;
  }
}
