import { describe, expect, it } from 'vitest';
import {
  MAX_PDF_BYTES,
  extractPdfText,
  hasPdfHeader,
  isPdfContentType,
  mayBeBinaryDocument,
} from './pdfText';
import { buildPdf } from './pdfFixture.test-utils';

describe('pdfText', () => {
  describe('extractPdfText', () => {
    it('returns per-page text, joined text, page count and metadata', async () => {
      const pdf = buildPdf(
        ['Members Present: Cllr N. Killeen', 'Apologies: none'],
        {
          title: 'Minutes of Full Council',
          author: 'Meetings Administrator',
        },
      );

      const result = await extractPdfText(pdf, 'GET https://example.com/m.pdf');

      expect(result).toEqual({
        contentType: 'application/pdf',
        pages: ['Members Present: Cllr N. Killeen', 'Apologies: none'],
        text: 'Members Present: Cllr N. Killeen\n\nApologies: none',
        pageCount: 2,
        metadata: expect.objectContaining({
          title: 'Minutes of Full Council',
          author: 'Meetings Administrator',
        }),
      });
    });

    it('omits metadata fields the document does not set', async () => {
      const result = await extractPdfText(buildPdf(['x']), 'src');

      expect(result.metadata.title).toBeUndefined();
      expect(result.metadata.author).toBeUndefined();
    });

    it('wraps unparseable bodies in an error naming the source', async () => {
      const notAPdf = new TextEncoder().encode('%PDF-1.4\nthis is not a pdf');

      await expect(
        extractPdfText(notAPdf, 'GET https://example.com/broken.pdf'),
      ).rejects.toThrow(
        'Failed to extract text from PDF at GET https://example.com/broken.pdf',
      );
    });

    it('rejects documents over the size limit without parsing them', async () => {
      const huge = new Uint8Array(MAX_PDF_BYTES + 1);

      await expect(extractPdfText(huge, 'src')).rejects.toThrow(
        /over the .*-byte limit/,
      );
    });
  });

  describe('content detection', () => {
    it('recognises PDF content types', () => {
      expect(isPdfContentType('application/pdf')).toBe(true);
      expect(isPdfContentType('application/x-pdf; charset=binary')).toBe(true);
      expect(isPdfContentType('text/html')).toBe(false);
      expect(isPdfContentType(null)).toBe(false);
    });

    it('treats untyped and octet-stream bodies as candidates for sniffing', () => {
      expect(mayBeBinaryDocument(null)).toBe(true);
      expect(mayBeBinaryDocument('application/octet-stream')).toBe(true);
      expect(mayBeBinaryDocument('text/html; charset=utf-8')).toBe(false);
    });

    it('finds the %PDF- header, including after leading junk', () => {
      const enc = new TextEncoder();
      expect(hasPdfHeader(enc.encode('%PDF-1.7\n...'))).toBe(true);
      expect(hasPdfHeader(enc.encode('\r\n\r\n%PDF-1.4'))).toBe(true);
      expect(hasPdfHeader(enc.encode('{"id": 1}'))).toBe(false);
      expect(hasPdfHeader(new Uint8Array())).toBe(false);
    });
  });
});
