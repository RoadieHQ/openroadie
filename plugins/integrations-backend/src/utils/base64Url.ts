function stripBase64Padding(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 61) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

export function base64UrlEncode(str: string): string {
  return stripBase64Padding(
    Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  );
}

export function base64UrlEncodeBuffer(buf: Buffer): string {
  return stripBase64Padding(
    buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  );
}
