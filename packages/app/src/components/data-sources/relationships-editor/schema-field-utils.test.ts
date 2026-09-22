import { describe, expect, it } from 'vitest';
import type { SchemaField } from './schema-field-utils';
import {
  flattenSchemaFields,
  isKnownFieldPath,
  relationshipJoinExprFromGraphPath,
} from './schema-field-utils';

describe('flattenSchemaFields', () => {
  it('extracts nested JSON Schema object properties without metadata fields', () => {
    const fields: SchemaField[] = [
      {
        name: 'spec',
        type: 'object',
        rawValue: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            metadata: {
              type: 'object',
              properties: {
                team: { type: 'string' },
              },
            },
          },
        },
      },
    ];

    const flattened = flattenSchemaFields(fields).map(field => field.path);

    expect(flattened).toContain('$.spec.owner');
    expect(flattened).toContain('$.spec.metadata.team');
    expect(flattened).not.toContain('$.spec.type');
    expect(flattened).not.toContain('$.spec.properties');
  });

  it('extracts fields from array item wrappers', () => {
    const fields: SchemaField[] = [
      {
        name: 'members',
        type: 'array',
        rawValue: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string' },
            },
          },
        },
      },
    ];

    const flattened = flattenSchemaFields(fields).map(field => field.path);

    expect(flattened).toContain('$.members');
    expect(flattened).toContain('$.members.id');
    expect(flattened).toContain('$.members.email');
  });

  it('offers an array of primitives as a field without inventing children', () => {
    const fields: SchemaField[] = [
      {
        name: 'images',
        type: 'array',
        rawValue: { type: 'array', items: { type: 'string' } },
      },
    ];

    const flattened = flattenSchemaFields(fields).map(field => field.path);

    // The array itself is the match target for an array of primitives.
    expect(flattened).toContain('$.images');
    // `items: { type: 'string' }` is a schema wrapper for a primitive, not an
    // object with a `type` property — offering `$.images.type` puts a field in
    // the picker that does not exist in the data.
    expect(flattened).not.toContain('$.images.type');
  });

  it('supports legacy plain object schema shapes', () => {
    const fields: SchemaField[] = [
      {
        name: 'entity',
        type: 'object',
        rawValue: {
          owner: 'string',
          nested: {
            team: 'string',
          },
        },
      },
    ];

    const flattened = flattenSchemaFields(fields).map(field => field.path);

    expect(flattened).toContain('$.entity.owner');
    expect(flattened).toContain('$.entity.nested.team');
  });

  it('keeps legacy fields named like schema metadata keys', () => {
    const fields: SchemaField[] = [
      {
        name: 'entity',
        type: 'object',
        rawValue: {
          type: 'string',
          properties: 'string',
          items: 'string',
          owner: 'string',
        },
      },
    ];

    const flattened = flattenSchemaFields(fields).map(field => field.path);

    expect(flattened).toContain('$.entity.type');
    expect(flattened).toContain('$.entity.properties');
    expect(flattened).toContain('$.entity.items');
    expect(flattened).toContain('$.entity.owner');
  });

  it('does not recurse into non-container leaf fields', () => {
    const fields: SchemaField[] = [
      {
        name: 'owner',
        type: 'string',
        rawValue: { type: 'string' },
      },
    ];

    const flattened = flattenSchemaFields(fields).map(field => field.path);

    expect(flattened).toContain('$.owner');
    expect(flattened).not.toContain('$.owner.type');
  });
});

describe('relationshipJoinExprFromGraphPath', () => {
  it('inserts [*] JSONata traversal when path crosses schema array segments', () => {
    const fields: SchemaField[] = [
      {
        name: '_additionalData',
        type: 'object',
        rawValue: {
          type: 'object',
          properties: {
            members: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  login: { type: 'string' },
                },
              },
            },
          },
        },
      },
    ];

    expect(
      relationshipJoinExprFromGraphPath(
        fields,
        '_additionalData.members.login',
      ),
    ).toBe('$._additionalData.members[*].login');
  });

  it('does not emit [*] for object-only traversal', () => {
    const fields: SchemaField[] = [
      {
        name: 'spec',
        type: 'object',
        rawValue: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
          },
        },
      },
    ];

    expect(relationshipJoinExprFromGraphPath(fields, 'spec.owner')).toBe(
      '$.spec.owner',
    );
  });
});

describe('isKnownFieldPath', () => {
  it('returns true only for discovered field paths', () => {
    const fields: SchemaField[] = [
      {
        name: 'spec',
        type: 'object',
        rawValue: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
          },
        },
      },
    ];

    expect(isKnownFieldPath('$.spec.owner', fields)).toBe(true);
    expect(isKnownFieldPath('$.spec.properties', fields)).toBe(false);
  });
});
