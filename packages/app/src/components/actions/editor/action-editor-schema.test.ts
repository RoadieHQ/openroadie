import { describe, expect, it } from 'vitest';
import { actionEditorSchema } from './action-editor-schema';

function draft(overrides?: Record<string, unknown>) {
  return {
    name: 'Create Issue',
    slug: 'create-issue',
    description: '',
    enabled: true,
    parameters: [],
    steps: [
      {
        id: 'step1',
        integrationId: 'int-1',
        request: { method: 'GET', path: '/issues', body: '', headers: [] },
      },
    ],
    ...overrides,
  };
}

function slugIssues(value: string) {
  const result = actionEditorSchema.safeParse(draft({ slug: value }));
  if (result.success) return [];
  return result.error.issues.filter(issue => issue.path[0] === 'slug');
}

describe('actionEditorSchema slug', () => {
  it('accepts a well-formed slug', () => {
    expect(slugIssues('create-issue')).toEqual([]);
  });

  it('accepts a blank slug — the backend derives one from the name', () => {
    expect(slugIssues('')).toEqual([]);
    expect(slugIssues('   ')).toEqual([]);
  });

  it.each(['Bad_Slug', 'Create Issue', 'a--b', '-lead', 'trail-', 'UPPER'])(
    'rejects %s',
    value => {
      const issues = slugIssues(value);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toMatch(/lowercase letters/);
    },
  );

  it('reports the issue on the slug path so the field can show it', () => {
    const result = actionEditorSchema.safeParse(draft({ slug: 'Bad_Slug' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.path[0] === 'slug')).toBe(true);
    }
  });
});
