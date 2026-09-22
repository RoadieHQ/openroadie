import { describe, it, expect } from 'vitest';
import {
  compileInputSchema,
  deriveActionMode,
  renderTemplate,
  renderJsonTemplate,
  buildSampleInput,
} from './schema';
import type { ActionParam, ActionStep } from './types';

describe('compileInputSchema', () => {
  it('compiles each scalar type', () => {
    const params: ActionParam[] = [
      { name: 'a', type: 'string' },
      { name: 'b', type: 'number' },
      { name: 'c', type: 'integer' },
      { name: 'd', type: 'boolean' },
    ];
    expect(compileInputSchema(params)).toEqual({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'number' },
        c: { type: 'integer' },
        d: { type: 'boolean' },
      },
    });
  });

  it('compiles array<string> to an array schema', () => {
    expect(
      compileInputSchema([{ name: 'tags', type: 'array<string>' }]),
    ).toEqual({
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string' } } },
    });
  });

  it('collects required params and carries descriptions', () => {
    const schema = compileInputSchema([
      { name: 'name', type: 'string', required: true, description: 'the name' },
      { name: 'opt', type: 'string' },
    ]);
    expect(schema.required).toEqual(['name']);
    expect(schema.properties?.name.description).toBe('the name');
  });

  it('omits required when nothing is required', () => {
    expect(
      compileInputSchema([{ name: 'a', type: 'string' }]).required,
    ).toBeUndefined();
  });
});

describe('renderTemplate', () => {
  it('substitutes scalars raw', () => {
    expect(
      renderTemplate('{"name":"{{name}}","count":{{count}},"on":{{on}}}', {
        name: 'repo',
        count: 5,
        on: true,
      }),
    ).toBe('{"name":"repo","count":5,"on":true}');
  });

  it('JSON.stringifies arrays/objects', () => {
    expect(renderTemplate('{"tags":{{tags}}}', { tags: ['a', 'b'] })).toBe(
      '{"tags":["a","b"]}',
    );
  });

  it('renders missing and unknown tokens as empty string', () => {
    expect(renderTemplate('a={{missing}};b={{unknown}}', { other: 1 })).toBe(
      'a=;b=',
    );
  });

  it('trims whitespace inside tokens', () => {
    expect(renderTemplate('{{ name }}', { name: 'x' })).toBe('x');
  });

  it('applies the encoder to substituted values when supplied', () => {
    expect(
      renderTemplate(
        '/orgs/{{org}}/repos',
        { org: 'a/b c' },
        encodeURIComponent,
      ),
    ).toBe('/orgs/a%2Fb%20c/repos');
  });

  it('encoding prevents an input from escaping its path segment', () => {
    expect(
      renderTemplate(
        '/repos/{{name}}',
        { name: '../../admin' },
        encodeURIComponent,
      ),
    ).toBe('/repos/..%2F..%2Fadmin');
  });

  it('invokes the uuidv4() global function', () => {
    const out = renderTemplate('{{uuidv4()}}', {});
    expect(out).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('generates a distinct uuid per occurrence', () => {
    const out = renderTemplate('{{uuidv4()}} {{uuidv4()}}', {});
    const [a, b] = out.split(' ');
    expect(a).not.toBe(b);
  });

  it('tolerates whitespace inside a function-call token', () => {
    expect(renderTemplate('{{ uuidv4() }}', {})).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('throws a clear error for an unknown function call', () => {
    expect(() => renderTemplate('a={{bogus()}}', {})).toThrow(
      'Unknown template function: bogus() (available: uuidv4())',
    );
  });
});

describe('renderJsonTemplate', () => {
  it('emits each value as a self-quoting JSON value (tokens unquoted)', () => {
    expect(
      renderJsonTemplate('{"name":{{name}},"count":{{count}},"on":{{on}}}', {
        name: 'repo',
        count: 5,
        on: true,
      }),
    ).toBe('{"name":"repo","count":5,"on":true}');
  });

  it('escapes string inputs so they cannot break out of their JSON string', () => {
    const out = renderJsonTemplate('{"name":{{name}}}', {
      name: 'x","admin":true',
    });
    expect(out).toBe('{"name":"x\\",\\"admin\\":true"}');
    expect(JSON.parse(out)).toEqual({ name: 'x","admin":true' });
  });

  it('renders arrays/objects as JSON and missing tokens as null', () => {
    expect(
      renderJsonTemplate('{"tags":{{tags}},"opt":{{opt}}}', {
        tags: ['a', 'b'],
      }),
    ).toBe('{"tags":["a","b"],"opt":null}');
  });

  it('throws a clear error for an unknown function call', () => {
    expect(() => renderJsonTemplate('{"id":{{bogus()}}}', {})).toThrow(
      'Unknown template function: bogus() (available: uuidv4())',
    );
  });

  it('emits uuidv4() as a quoted JSON string', () => {
    const out = renderJsonTemplate('{"id":{{uuidv4()}}}', {});
    const parsed = JSON.parse(out) as { id: string };
    expect(parsed.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('buildSampleInput', () => {
  it('produces a default value per type', () => {
    const params: ActionParam[] = [
      { name: 's', type: 'string' },
      { name: 'n', type: 'number' },
      { name: 'i', type: 'integer' },
      { name: 'b', type: 'boolean' },
      { name: 'arr', type: 'array<string>' },
    ];
    expect(buildSampleInput(params)).toEqual({
      s: '',
      n: 0,
      i: 0,
      b: false,
      arr: [''],
    });
  });
});

describe('deriveActionMode', () => {
  const step = (method: ActionStep['request']['method']): ActionStep => ({
    id: 'step1',
    integrationId: 'int-1',
    request: { method, path: '/x', headers: [], body: '' },
  });

  it('derives read when every step is a GET', () => {
    expect(deriveActionMode([step('GET')])).toBe('read');
    expect(deriveActionMode([step('GET'), step('GET')])).toBe('read');
  });

  it('derives write for a single non-GET step', () => {
    expect(deriveActionMode([step('POST')])).toBe('write');
    expect(deriveActionMode([step('DELETE')])).toBe('write');
  });

  it('derives write when any step mutates (mixed methods)', () => {
    expect(deriveActionMode([step('GET'), step('PUT'), step('GET')])).toBe(
      'write',
    );
  });

  it('derives write for empty steps (safe default)', () => {
    expect(deriveActionMode([])).toBe('write');
  });

  it('treats known AWS read operations as read and defaults others to write', () => {
    const awsStep = (operation: string): ActionStep => ({
      id: 'step1',
      integrationId: 'aws-1',
      request: {
        backendType: 'aws',
        mode: 'service-api',
        service: 'lambda',
        operation,
        profile: '123456789012',
        region: 'us-east-1',
        method: 'POST',
        path: '/',
        headers: [],
        body: '{}',
      },
    });

    expect(deriveActionMode([awsStep('ListFunctions')])).toBe('read');
    expect(deriveActionMode([awsStep('GetFunction')])).toBe('read');
    expect(deriveActionMode([awsStep('DescribeInstances')])).toBe('read');
    expect(deriveActionMode([awsStep('InvokeFunction')])).toBe('write');
    expect(deriveActionMode([awsStep('')])).toBe('write');
  });
});
