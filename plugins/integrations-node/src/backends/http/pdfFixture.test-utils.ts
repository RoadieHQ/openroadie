/**
 * Builds a minimal, valid multi-page PDF (Helvetica text, one line per page)
 * so the PDF tests exercise real pdf.js parsing without a checked-in binary.
 */
export function buildPdf(
  pages: string[],
  info: { title?: string; author?: string } = {},
): Uint8Array {
  const escape = (s: string) => s.replace(/[\\()]/g, c => `\\${c}`);
  const objects: string[] = [];
  const fontId = 3 + pages.length * 2;
  const infoId = fontId + 1;
  const pageIds = pages.map((_, i) => 3 + i * 2);

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  pages.forEach((text, i) => {
    const pageId = pageIds[i];
    const stream = `BT /F1 12 Tf 72 720 Td (${escape(text)}) Tj ET`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] =
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const infoEntries = [
    info.title ? `/Title (${escape(info.title)})` : '',
    info.author ? `/Author (${escape(info.author)})` : '',
  ].join(' ');
  objects[infoId] = `<< ${infoEntries} >>`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out +=
    `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
