import { XMLParser, XMLValidator } from 'fast-xml-parser';

/**
 * Shaped so JSONata can address the result without backticks: namespace
 * prefixes are dropped (`soap:Envelope` → `Envelope`), attributes are `_name`
 * and an element's text beside attributes is `_text`. Values stay strings —
 * XML has no types, and coercing would mangle ids like `007`.
 */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '_',
  textNodeName: '_text',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

/**
 * Matches `text/xml`, `application/xml` and structured-syntax `+xml` types
 * (`application/rss+xml`, `application/atom+xml`, `application/soap+xml`, …).
 * `image/svg+xml` and `text/html` are deliberately not XML data here.
 */
export function isXmlContentType(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }
  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  const [type, subtype = ''] = mediaType.split('/');
  return (
    (type === 'text' || type === 'application') &&
    (subtype === 'xml' || subtype.endsWith('+xml'))
  );
}

/**
 * Parse an XML body into an object, or return `undefined` when it isn't
 * well-formed so the caller can keep the raw text (as it does for text that
 * isn't JSON). Entity expansion is bounded by the parser's defaults and
 * external entities are never resolved.
 */
export function parseXmlBody(body: string): unknown {
  if (XMLValidator.validate(body) !== true) {
    return undefined;
  }
  return xmlParser.parse(body);
}
