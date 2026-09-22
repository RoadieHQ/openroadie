import {
  getDeclaredVariableNames,
  suggestGraphqlCursorPagination,
} from './suggest-graphql-pagination';

describe('getDeclaredVariableNames', () => {
  it('returns the set of variable names declared on the operation', () => {
    const result = getDeclaredVariableNames(`
      query OrgRepos($after: String, $first: Int!) {
        organization(login: "x") { id }
      }
    `);
    expect(result).toEqual(new Set(['after', 'first']));
  });

  it('returns an empty set when the operation declares no variables', () => {
    const result = getDeclaredVariableNames(`
      query { viewer { login } }
    `);
    expect(result).toEqual(new Set());
  });

  it('returns null for unparseable or empty input', () => {
    expect(getDeclaredVariableNames('')).toBeNull();
    expect(getDeclaredVariableNames('not graphql {')).toBeNull();
  });
});

describe('suggestGraphqlCursorPagination', () => {
  it('derives the full bundle from a standard Relay query', () => {
    const result = suggestGraphqlCursorPagination(`
      query OrgRepos($after: String) {
        organization(login: "roadiehq") {
          repositories(first: 50, after: $after) {
            pageInfo { endCursor hasNextPage }
            nodes { id }
          }
        }
      }
    `);

    expect(result).toEqual({
      cursorVariable: 'after',
      nextCursorExpression: 'data.organization.repositories.pageInfo.endCursor',
      hasNextPageExpression:
        'data.organization.repositories.pageInfo.hasNextPage',
    });
  });

  it('uses the variable name when cursorVariable is named differently from `after`', () => {
    const result = suggestGraphqlCursorPagination(`
      query ($cursor: String) {
        viewer {
          repositories(after: $cursor, first: 50) {
            pageInfo { endCursor }
            nodes { id }
          }
        }
      }
    `);

    expect(result?.cursorVariable).toBe('cursor');
  });

  it('uses field aliases in the path', () => {
    const result = suggestGraphqlCursorPagination(`
      query {
        repos: repositories(first: $first, after: $after) {
          pageInfo { endCursor hasNextPage }
          nodes { id }
        }
      }
    `);

    expect(result?.nextCursorExpression).toBe('data.repos.pageInfo.endCursor');
    expect(result?.hasNextPageExpression).toBe(
      'data.repos.pageInfo.hasNextPage',
    );
  });

  it('omits hasNextPageExpression when the query does not select hasNextPage', () => {
    const result = suggestGraphqlCursorPagination(`
      query {
        viewer {
          repositories(first: $first, after: $after) {
            pageInfo { endCursor }
            nodes { id }
          }
        }
      }
    `);

    expect(result?.hasNextPageExpression).toBeUndefined();
  });

  it('returns null when no pageInfo.endCursor is selected', () => {
    expect(
      suggestGraphqlCursorPagination(`
        query { viewer { login } }
      `),
    ).toBeNull();
  });

  it('returns null for unparseable queries', () => {
    expect(
      suggestGraphqlCursorPagination('this is not a valid graphql query {'),
    ).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(suggestGraphqlCursorPagination('')).toBeNull();
    expect(suggestGraphqlCursorPagination('   \n  ')).toBeNull();
  });

  it('picks the outermost connection when nested connections both have pageInfo', () => {
    const result = suggestGraphqlCursorPagination(`
      query {
        organization(login: "x") {
          repositories(first: $first, after: $after) {
            pageInfo { endCursor }
            nodes {
              issues(first: 5, after: $issuesAfter) {
                pageInfo { endCursor }
                nodes { id }
              }
            }
          }
        }
      }
    `);

    expect(result?.nextCursorExpression).toBe(
      'data.organization.repositories.pageInfo.endCursor',
    );
    expect(result?.cursorVariable).toBe('after');
  });

  it('falls back to cursorVariable=after when the after argument is missing or literal', () => {
    const literal = suggestGraphqlCursorPagination(`
      query {
        viewer {
          repositories(first: 50, after: "abc") {
            pageInfo { endCursor }
            nodes { id }
          }
        }
      }
    `);
    expect(literal?.cursorVariable).toBe('after');

    const missing = suggestGraphqlCursorPagination(`
      query {
        viewer {
          repositories(first: 50) {
            pageInfo { endCursor }
            nodes { id }
          }
        }
      }
    `);
    expect(missing?.cursorVariable).toBe('after');
  });
});
