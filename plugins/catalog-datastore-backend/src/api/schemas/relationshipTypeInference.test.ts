import { describe, expect, it } from 'vitest';
import { inferRelationshipType } from './relationshipTypeInference';

describe('inferRelationshipType', () => {
  it('returns relatedTo/relatesTo for identity-kind suggestions regardless of field name', () => {
    expect(
      inferRelationshipType({
        sourceField: '$.owner.login',
        targetField: '$.login',
        suggestionKind: 'identity',
      }),
    ).toEqual({
      relationshipType: 'relatedTo',
      reciprocalRelationshipType: 'relatesTo',
    });
  });

  it('falls back to relatedTo when no token matches', () => {
    expect(
      inferRelationshipType({
        sourceField: '$.foo.bar',
        targetField: '$.baz',
        suggestionKind: 'relationship',
      }),
    ).toEqual({
      relationshipType: 'relatedTo',
      reciprocalRelationshipType: 'relatesTo',
    });
  });

  it.each([
    ['$.owner.login', 'ownedBy', 'ownerOf'],
    ['$.repository.owner.email', 'ownedBy', 'ownerOf'],
    ['$.author.login', 'authoredBy', 'authorOf'],
    ['$.createdBy', 'authoredBy', 'authorOf'],
    ['$.assignee.login', 'assignedTo', 'assigneeOf'],
    ['$.maintainer.email', 'maintainedBy', 'maintainerOf'],
    ['$.manager.id', 'reportsTo', 'manages'],
    ['$.team.slug', 'memberOf', 'hasMember'],
    ['$.parent.id', 'childOf', 'parentOf'],
    ['$.dependsOn[*].name', 'dependsOn', 'dependencyOf'],
    ['$.dependencies[*].id', 'dependsOn', 'dependencyOf'],
    ['$.consumer.id', 'consumes', 'consumedBy'],
    ['$.provider.name', 'provides', 'providedBy'],
    ['$.project.id', 'partOf', 'hasPart'],
    ['$.repo.name', 'partOf', 'hasPart'],
  ])(
    'infers from source field %s',
    (sourceField, relationshipType, reciprocalRelationshipType) => {
      expect(
        inferRelationshipType({
          sourceField,
          targetField: '$.id',
          suggestionKind: 'relationship',
        }),
      ).toEqual({ relationshipType, reciprocalRelationshipType });
    },
  );

  it('strips JSONPath bracket qualifiers before matching', () => {
    expect(
      inferRelationshipType({
        sourceField: '$.tags[name="owner"].value',
        targetField: '$.id',
        suggestionKind: 'relationship',
      }),
    ).toEqual({
      relationshipType: 'relatedTo',
      reciprocalRelationshipType: 'relatesTo',
    });
    expect(
      inferRelationshipType({
        sourceField: '$.owner[*].login',
        targetField: '$.id',
        suggestionKind: 'relationship',
      }),
    ).toEqual({
      relationshipType: 'ownedBy',
      reciprocalRelationshipType: 'ownerOf',
    });
  });

  it('matches the target field when the source has no signal', () => {
    expect(
      inferRelationshipType({
        sourceField: '$.id',
        targetField: '$.owner.login',
        suggestionKind: 'relationship',
      }),
    ).toEqual({
      relationshipType: 'ownedBy',
      reciprocalRelationshipType: 'ownerOf',
    });
  });

  it('prefers the source field over the target when both have signals', () => {
    expect(
      inferRelationshipType({
        sourceField: '$.dependsOn[*].name',
        targetField: '$.owner.login',
        suggestionKind: 'relationship',
      }),
    ).toEqual({
      relationshipType: 'dependsOn',
      reciprocalRelationshipType: 'dependencyOf',
    });
  });

  it('matches snake_case and kebab-case variants', () => {
    expect(
      inferRelationshipType({
        sourceField: '$.owned_by',
        targetField: '$.id',
        suggestionKind: 'relationship',
      }),
    ).toEqual({
      relationshipType: 'ownedBy',
      reciprocalRelationshipType: 'ownerOf',
    });
    expect(
      inferRelationshipType({
        sourceField: '$.depends-on[*].id',
        targetField: '$.id',
        suggestionKind: 'relationship',
      }),
    ).toEqual({
      relationshipType: 'dependsOn',
      reciprocalRelationshipType: 'dependencyOf',
    });
  });
});
