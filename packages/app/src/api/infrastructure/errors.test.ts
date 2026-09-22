import { ResponseError } from './errors';
import { mockResponse } from './test-utils';

describe('ResponseError', () => {
  describe('fromResponse', () => {
    it('extracts message from error.message in JSON body', async () => {
      const err = await ResponseError.fromResponse(
        mockResponse({ error: { message: 'Not found' } }, false, 404),
      );
      expect(err.message).toBe('Not found');
      expect(err.statusCode).toBe(404);
    });

    it('stringifies an object error.message instead of [object Object]', async () => {
      const err = await ResponseError.fromResponse(
        mockResponse(
          { error: { message: { code: '42P01', detail: 'missing relation' } } },
          false,
          500,
        ),
      );
      expect(err.message).toBe('{"code":"42P01","detail":"missing relation"}');
      expect(err.message).not.toBe('[object Object]');
    });

    it('stringifies an error object that has no message field', async () => {
      const err = await ResponseError.fromResponse(
        mockResponse(
          { error: { code: 'ECONNRESET', syscall: 'read' } },
          false,
          502,
        ),
      );
      expect(err.message).toBe('{"code":"ECONNRESET","syscall":"read"}');
    });

    it('ignores a literal [object Object] error string and uses the rest of the body', async () => {
      const err = await ResponseError.fromResponse(
        mockResponse(
          { error: '[object Object]', details: 'jsonata evaluation failed' },
          false,
          500,
        ),
      );
      expect(err.message).toContain('jsonata evaluation failed');
      expect(err.message).not.toBe('[object Object]');
    });

    it('extracts message from top-level message field', async () => {
      const err = await ResponseError.fromResponse(
        mockResponse({ message: 'Bad request' }, false, 400),
      );
      expect(err.message).toBe('Bad request');
    });

    it('falls back to status text when body is not JSON', async () => {
      const response = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        clone() {
          return this;
        },
        text: async () => '',
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response;
      const err = await ResponseError.fromResponse(response);
      expect(err.message).toContain('500');
    });

    it('has name ResponseError', async () => {
      const err = await ResponseError.fromResponse(
        mockResponse({}, false, 500),
      );
      expect(err.name).toBe('ResponseError');
      expect(err).toBeInstanceOf(Error);
    });
  });
});
