import { SecretsSettingsClient } from './secrets-client';
import {
  mockResponse,
  mockFetchFn,
  fetchCallBody,
} from '../infrastructure/test-utils';

describe('SecretsSettingsClient', () => {
  const baseUrl = 'http://test/api/secrets-settings';
  let mockFetch: ReturnType<typeof mockFetchFn>;
  let client: SecretsSettingsClient;

  beforeEach(() => {
    mockFetch = mockFetchFn();
    client = new SecretsSettingsClient(baseUrl, mockFetch);
  });

  describe('getKeys', () => {
    it('calls GET /keys', async () => {
      mockFetch.mockResolvedValue(mockResponse([]));
      await client.getKeys();
      expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/keys`);
    });

    it('returns secret list', async () => {
      const secrets = [
        { name: 'API_KEY', value: '***', description: '', status: 'Available' },
      ];
      mockFetch.mockResolvedValue(mockResponse(secrets));
      expect(await client.getKeys()).toEqual(secrets);
    });

    it('throws ResponseError on failure', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ message: 'Server error' }, false, 500),
      );
      await expect(client.getKeys()).rejects.toThrow('Server error');
    });
  });

  describe('setSecret', () => {
    it('calls POST /keys with name and value', async () => {
      mockFetch.mockResolvedValue(mockResponse({}, true, 201));
      await client.setSecret('MY_SECRET', ' value ');

      expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'MY_SECRET', value: 'value' }),
      });
    });

    it('trims the value', async () => {
      mockFetch.mockResolvedValue(mockResponse({}));
      await client.setSecret('KEY', '  trimmed  ');

      expect(fetchCallBody<{ value: string }>(mockFetch).value).toBe('trimmed');
    });
  });

  describe('deleteSecret', () => {
    it('calls DELETE /secret-value/:name', async () => {
      mockFetch.mockResolvedValue(mockResponse({}, true));
      await client.deleteSecret('MY_SECRET');
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/secret-value/MY_SECRET`,
        { method: 'DELETE' },
      );
    });
  });

  describe('addSecret', () => {
    it('calls POST /secret-metadata', async () => {
      mockFetch.mockResolvedValue(mockResponse({}));
      await client.addSecret({ name: 'NEW', description: 'A secret' });

      expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/secret-metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'NEW', description: 'A secret' }),
      });
    });
  });

  describe('upsertSecret', () => {
    it('creates metadata then sets the secret', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({}, true, 201))
        .mockResolvedValueOnce(mockResponse({}, true, 201));

      await client.upsertSecret({
        name: 'NEW_SECRET',
        internalKeyName: 'NEW_SECRET',
        value: ' secret ',
      });

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        `${baseUrl}/secret-metadata`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'NEW_SECRET',
            internalKeyName: 'NEW_SECRET',
          }),
        },
      );
      expect(mockFetch).toHaveBeenNthCalledWith(2, `${baseUrl}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'NEW_SECRET', value: 'secret' }),
      });
    });

    it('still sets the value when metadata already exists', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(
            { message: 'A secret with name "NEW_SECRET" already exists' },
            false,
            400,
          ),
        )
        .mockResolvedValueOnce(mockResponse({}, true, 201));

      await client.upsertSecret({
        name: 'NEW_SECRET',
        value: 'value',
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenLastCalledWith(`${baseUrl}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'NEW_SECRET', value: 'value' }),
      });
    });

    it('patches metadata when metadata already exists and fields are provided', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(
            { message: 'A secret with name "EXISTING" already exists' },
            false,
            400,
          ),
        )
        .mockResolvedValueOnce(mockResponse({}, true, 201))
        .mockResolvedValueOnce(mockResponse({}, true, 200));

      await client.upsertSecret({
        name: 'EXISTING',
        value: 'v',
        description: 'New desc',
        helpUrl: 'https://example.com/help',
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        `${baseUrl}/secret-metadata/EXISTING`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: 'New desc',
            helpUrl: 'https://example.com/help',
          }),
        },
      );
    });

    it('does not patch metadata when only the default internal key is provided', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(
            { message: 'A secret with name "EXISTING" already exists' },
            false,
            400,
          ),
        )
        .mockResolvedValueOnce(mockResponse({}, true, 201));

      await client.upsertSecret({
        name: 'EXISTING',
        internalKeyName: 'EXISTING',
        value: 'v',
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(2, `${baseUrl}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'EXISTING', value: 'v' }),
      });
    });

    it('throws on non-duplicate metadata errors', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ message: 'Error creating secret metadata' }, false, 500),
      );

      await expect(
        client.upsertSecret({
          name: 'NEW_SECRET',
          internalKeyName: 'NEW_SECRET',
          value: 'value',
        }),
      ).rejects.toThrow('Error creating secret metadata');
    });
  });

  describe('editSecret', () => {
    it('calls PATCH /secret-metadata/:name', async () => {
      mockFetch.mockResolvedValue(mockResponse({}));
      await client.editSecret('KEY', { description: 'updated' });

      expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/secret-metadata/KEY`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'updated' }),
      });
    });
  });

  describe('getStorageMode', () => {
    it('calls GET /storage-mode and returns the payload', async () => {
      const payload = { mode: 'dotenv', readOnly: false, dotenvPath: '/x' };
      mockFetch.mockResolvedValue(mockResponse(payload));
      const res = await client.getStorageMode();
      expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/storage-mode`);
      expect(res).toEqual(payload);
    });
  });

  describe('getSecretStatus', () => {
    it('calls GET /secret-status/:ref and returns { exists }', async () => {
      mockFetch.mockResolvedValue(mockResponse({ exists: true }));
      const res = await client.getSecretStatus('FOO');
      expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/secret-status/FOO`);
      expect(res).toEqual({ exists: true });
    });
  });

  it('no longer exposes stopBackend', () => {
    expect(
      (client as unknown as { stopBackend?: () => void }).stopBackend,
    ).toBeUndefined();
  });
});
