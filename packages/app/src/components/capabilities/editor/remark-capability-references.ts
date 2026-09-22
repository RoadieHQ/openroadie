import { createReferenceRegex } from './references';

/**
 * Minimal structural view of the mdast nodes we touch. We avoid a hard
 * dependency on `mdast`/`unist` types — only `type`, `value` and `children`
 * are needed to split text nodes.
 */
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, string>;
    hChildren?: MdastNode[];
  };
}

function buildReferenceNode(
  token: string,
  type: string,
  slug: string,
): MdastNode {
  // Rendered as a <span> carrying marker properties; react-markdown's component
  // map only types intrinsic HTML tags, so we override `span` rather than
  // inventing a custom element name.
  return {
    type: 'capabilityReference',
    data: {
      hName: 'span',
      hProperties: { dataCapabilityReference: 'true', reftype: type, slug },
      hChildren: [{ type: 'text', value: token }],
    },
  };
}

/** Split a single text node's value into text + reference nodes. */
function splitTextNode(value: string): MdastNode[] | null {
  const regex = createReferenceRegex();
  const result: MdastNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let matched = false;

  while ((match = regex.exec(value)) !== null) {
    matched = true;
    const [token, type, slug] = match;
    if (match.index > lastIndex) {
      result.push({ type: 'text', value: value.slice(lastIndex, match.index) });
    }
    result.push(buildReferenceNode(token, type, slug));
    lastIndex = match.index + token.length;
  }

  if (!matched) return null;

  if (lastIndex < value.length) {
    result.push({ type: 'text', value: value.slice(lastIndex) });
  }
  return result;
}

function transform(node: MdastNode): void {
  if (!node.children) return;

  const next: MdastNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      const replacement = splitTextNode(child.value);
      if (replacement) {
        next.push(...replacement);
        continue;
      }
    }
    transform(child);
    next.push(child);
  }
  node.children = next;
}

/**
 * remark plugin that turns inline `@type:slug` reference tokens into
 * `<capability-reference>` elements, rendered by `CapabilityReferencePill`.
 */
export function remarkCapabilityReferences() {
  return (tree: MdastNode) => {
    transform(tree);
  };
}
