import { AgentClient, type AISettingsRequest } from './agent-client';
import type { AlertApi } from '../infrastructure/alert';
import { mockResponse, mockFetchFn } from '../infrastructure/test-utils';

describe('AgentClient', () => {
  const baseUrl = 'http://test/api/ai';
  let mockFetch: ReturnType<typeof mockFetchFn>;
  let mockAlert: AlertApi;
  let client: AgentClient;

  beforeEach(() => {
    mockFetch = mockFetchFn();
    mockAlert = { post: vi.fn() };
    client = new AgentClient(baseUrl, mockFetch, mockAlert);
  });

  it('calls POST /agents/:name/call with query', async () => {
    mockFetch.mockResolvedValue(mockResponse('result text'));
    await client.call({ agentName: 'summarize', query: { text: 'hello' } });

    expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/agents/summarize/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: JSON.stringify({ text: 'hello' }) }),
    });
  });

  it('returns success with response text', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => 'AI response',
    } as Response);

    const result = await client.call({
      agentName: 'test',
      query: 'hello',
    });

    expect(result).toEqual({ success: true, response: 'AI response' });
  });

  it('posts alert and returns error on empty response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '',
    } as Response);

    const result = await client.call({ agentName: 'test', query: 'x' });

    expect(result.success).toBe(false);
    expect(mockAlert.post).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' }),
    );
  });

  it('posts alert on server error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
      text: async () => JSON.stringify({ error: 'boom' }),
    } as Response);

    const result = await client.call({ agentName: 'test', query: 'x' });

    expect(result.success).toBe(false);
    expect(mockAlert.post).toHaveBeenCalled();
  });

  it('posts alert on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    const result = await client.call({ agentName: 'test', query: 'x' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network failure');
    expect(mockAlert.post).toHaveBeenCalled();
  });

  describe('saveSettings', () => {
    const request: AISettingsRequest = {
      provider: 'openai',
      settings: { apiKey: 'sk-test' },
    };

    it('returns the saved settings and toasts success', async () => {
      const saved = { selectedProvider: 'openai', settings: { apiKey: '***' } };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => saved,
      } as Response);

      await expect(client.saveSettings(request)).resolves.toEqual(saved);
      expect(mockAlert.post).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success' }),
      );
    });

    it('throws on a server error instead of returning a phantom success', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        text: async () => JSON.stringify({ error: 'boom' }),
      } as Response);

      await expect(client.saveSettings(request)).rejects.toThrow(/boom/);
      // No error toast: the form renders the failure in-dialog.
      expect(mockAlert.post).not.toHaveBeenCalled();
    });

    it('throws on a network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network failure'));

      await expect(client.saveSettings(request)).rejects.toThrow(
        /Network failure/,
      );
      expect(mockAlert.post).not.toHaveBeenCalled();
    });
  });
});
