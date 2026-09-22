import { vi } from 'vitest';

import {
  extractJsonataExpression,
  generateJsonataExpression,
} from './jsonataAssist';

describe('jsonataAssist', () => {
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts the expression after an echoed EXPRESSION marker', async () => {
    const aiService = {
      getModel: vi.fn().mockReturnValue('model'),
      invoke: vi.fn().mockResolvedValue({
        text:
          'You are a JSONata expression generator.\n\n' +
          'USER REQUEST: name contains arc\n\n' +
          'EXPRESSION:\n' +
          '$contains($lowercase(name), "arc")',
      }),
    };

    const result = await generateJsonataExpression(
      aiService as any,
      {
        inputSample: [{ name: 'Arcadia' }],
        description: 'name contains arc',
        transformType: 'filter',
      },
      'user',
      logger as any,
    );

    expect(result).toEqual({
      expression: '$contains($lowercase(name), "arc")',
      valid: true,
    });
  });

  it('repairs bare function names missing $ prefix', () => {
    const input = 'not($contains($lowercase(role), "advanced"))';
    expect(extractJsonataExpression(input)).toBe(
      '$not($contains($lowercase(role), "advanced"))',
    );
  });

  it('repairs multiple bare function names', () => {
    const input = 'contains(lowercase(name), "arc")';
    const result = extractJsonataExpression(input);
    expect(result).toBe('$contains($lowercase(name), "arc")');
  });

  it('does not rewrite function names inside string literals', () => {
    const input = '$contains(desc, "not(applicable)")';
    expect(extractJsonataExpression(input)).toBe(input);
  });

  it('extracts a fenced jsonata block', () => {
    const raw =
      'Here you go:\n\n' +
      '```jsonata\n' +
      '{\n' +
      '  "name": name,\n' +
      '  "id": id\n' +
      '}\n' +
      '```';

    expect(extractJsonataExpression(raw)).toBe(
      '{\n  "name": name,\n  "id": id\n}',
    );
  });
});
