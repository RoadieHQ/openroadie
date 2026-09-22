import { describe, expect, it } from 'vitest';
import { createSecretSchema } from './secret-schema';

const validInput = {
  name: 'MY_TOKEN',
  description: '',
  helpUrl: '',
  value: 'some-value',
};

describe('createSecretSchema', () => {
  it('accepts a valid secret', () => {
    const result = createSecretSchema().safeParse(validInput);

    expect(result.success).toBe(true);
  });

  it('enforces the uppercase name rule', () => {
    const result = createSecretSchema().safeParse({
      ...validInput,
      name: 'my_token',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'Use uppercase letters, digits and underscores, e.g. MY_API_TOKEN',
    );
  });

  it('requires a name', () => {
    const result = createSecretSchema().safeParse({ ...validInput, name: '' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Secret name is required');
  });

  it('requires a value', () => {
    const result = createSecretSchema().safeParse({ ...validInput, value: '' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Value is required');
  });

  it('rejects a non-https help URL', () => {
    const result = createSecretSchema().safeParse({
      ...validInput,
      helpUrl: 'http://example.com',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Enter a full https:// URL');
  });

  it('accepts an https help URL', () => {
    const result = createSecretSchema().safeParse({
      ...validInput,
      helpUrl: 'https://docs.example.com',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a duplicate name when existingNames is provided', () => {
    const result = createSecretSchema({
      existingNames: ['MY_TOKEN'],
    }).safeParse(validInput);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'A secret named "MY_TOKEN" already exists. Choose a different name.',
    );
  });

  it('rejects a name reserved by reservedNames', () => {
    const result = createSecretSchema({
      reservedNames: ['MY_TOKEN'],
    }).safeParse(validInput);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'A secret named "MY_TOKEN" already exists. Choose a different name.',
    );
  });

  it('still enforces the uppercase and https rules with existingNames set', () => {
    const schema = createSecretSchema({ existingNames: ['OTHER_TOKEN'] });

    expect(schema.safeParse({ ...validInput, name: 'my_token' }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ ...validInput, helpUrl: 'http://example.com' })
        .success,
    ).toBe(false);
  });

  it('allows a non-duplicate name when existingNames is provided', () => {
    const result = createSecretSchema({
      existingNames: ['OTHER_TOKEN'],
    }).safeParse(validInput);

    expect(result.success).toBe(true);
  });
});
