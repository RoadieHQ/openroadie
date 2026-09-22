import { ForwardedError } from '@roadiehq/errors';

/**
 * PDFs larger than this are rejected rather than parsed in-process: pdf.js
 * holds the whole document in memory, and a data source fetching many large
 * files concurrently would otherwise be able to exhaust the backend's heap.
 */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/** How far into the body to look for the `%PDF-` header (the spec allows leading junk). */
const PDF_HEADER_SCAN_BYTES = 1024;

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/**
 * What an HTTP source sees in place of a PDF body. An object rather than a
 * bare string, so `arrayExpression` / `objectIdExpression` can address the
 * parts (`text`, `pages[0]`, `metadata.title`) and a source that expects one
 * item per document can use `$` directly.
 */
export interface PdfTextResult {
  contentType: 'application/pdf';
  /** All pages' text, joined with a blank line between pages. */
  text: string;
  /** Per-page text, in page order. */
  pages: string[];
  pageCount: number;
  /** The document's info dictionary, where present. */
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    creationDate?: string;
    modificationDate?: string;
  };
}

export function isPdfContentType(contentType: string | null): boolean {
  return !!contentType && /application\/(x-)?pdf/i.test(contentType);
}

/**
 * Content types that may carry a PDF without saying so. Servers often send
 * files as `application/octet-stream` (or no type at all), so for these the
 * body is sniffed for the PDF header instead of trusting the header.
 */
export function mayBeBinaryDocument(contentType: string | null): boolean {
  return (
    !contentType ||
    /application\/(octet-stream|force-download|download)/i.test(contentType)
  );
}

export function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit =
    Math.min(bytes.length, PDF_HEADER_SCAN_BYTES) - PDF_HEADER.length;
  for (let i = 0; i <= limit; i++) {
    if (PDF_HEADER.every((b, j) => bytes[i + j] === b)) {
      return true;
    }
  }
  return false;
}

function infoString(info: Record<string, unknown>, key: string) {
  const value = info[key];
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}

/**
 * Extracts the text layer of a PDF. Scanned (image-only) documents have no
 * text layer and come back with empty `pages`, not an error — OCR is out of
 * scope here.
 */
export async function extractPdfText(
  bytes: Uint8Array,
  source: string,
): Promise<PdfTextResult> {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error(
      `PDF from ${source} is ${bytes.byteLength} bytes, over the ${MAX_PDF_BYTES}-byte limit for text extraction`,
    );
  }

  // Loaded on first use: pdf.js is large, and most integrations never see a PDF.
  const { getDocumentProxy, extractText, getMeta } = await import('unpdf');

  try {
    // verbosity 0 = errors only; pdf.js otherwise logs a warning per odd font.
    const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
    try {
      const { totalPages, text } = await extractText(pdf, {
        mergePages: false,
      });
      const pages = text.map(page => page.trim());
      const { info } = await getMeta(pdf).catch(() => ({ info: {} }));
      const meta = (info ?? {}) as Record<string, unknown>;
      return {
        contentType: 'application/pdf',
        text: pages.join('\n\n'),
        pages,
        pageCount: totalPages,
        metadata: {
          title: infoString(meta, 'Title'),
          author: infoString(meta, 'Author'),
          subject: infoString(meta, 'Subject'),
          creator: infoString(meta, 'Creator'),
          producer: infoString(meta, 'Producer'),
          creationDate: infoString(meta, 'CreationDate'),
          modificationDate: infoString(meta, 'ModDate'),
        },
      };
    } finally {
      await pdf.loadingTask.destroy();
    }
  } catch (error) {
    throw new ForwardedError(
      `Failed to extract text from PDF at ${source}`,
      error,
    );
  }
}
