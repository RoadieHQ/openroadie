import { describe, expect, it } from 'vitest';
import { isXmlContentType, parseXmlBody } from './xmlBody';

describe('isXmlContentType', () => {
  it.each([
    'text/xml',
    'application/xml',
    'text/xml; charset=utf-8',
    'application/rss+xml',
    'application/atom+xml',
    'application/soap+xml; charset=utf-8',
    'APPLICATION/XML',
  ])('treats %s as XML', contentType => {
    expect(isXmlContentType(contentType)).toBe(true);
  });

  it.each([
    null,
    '',
    'application/json',
    'text/html',
    'text/plain',
    'image/svg+xml',
    'application/xml-dtd',
    'application/octet-stream',
  ])('does not treat %s as XML', contentType => {
    expect(isXmlContentType(contentType)).toBe(false);
  });
});

describe('parseXmlBody', () => {
  it('parses elements into an object, dropping the declaration', () => {
    expect(
      parseXmlBody(
        '<?xml version="1.0" encoding="utf-8"?><root><name>A</name></root>',
      ),
    ).toEqual({ root: { name: 'A' } });
  });

  it('turns repeated elements into an array', () => {
    expect(parseXmlBody('<list><item>1</item><item>2</item></list>')).toEqual({
      list: { item: ['1', '2'] },
    });
  });

  it('keeps values as strings', () => {
    expect(parseXmlBody('<r><id>007</id><ok>true</ok></r>')).toEqual({
      r: { id: '007', ok: 'true' },
    });
  });

  it('exposes attributes and text with JSONata-friendly names', () => {
    expect(
      parseXmlBody(
        '<feed><link href="https://x.test/a" rel="alternate"/><title type="text">T</title></feed>',
      ),
    ).toEqual({
      feed: {
        link: { _href: 'https://x.test/a', _rel: 'alternate' },
        title: { _type: 'text', _text: 'T' },
      },
    });
  });

  it('strips namespace prefixes from a SOAP envelope', () => {
    const result = parseXmlBody(
      `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body>
          <GetThingsResponse xmlns="http://example.test/">
            <Thing><Id>1</Id></Thing>
          </GetThingsResponse>
        </soap:Body>
      </soap:Envelope>`,
    );
    expect(result).toMatchObject({
      Envelope: { Body: { GetThingsResponse: { Thing: { Id: '1' } } } },
    });
  });

  it('returns undefined for malformed XML', () => {
    expect(parseXmlBody('<root><unclosed></root>')).toBeUndefined();
    expect(parseXmlBody('')).toBeUndefined();
  });
});
