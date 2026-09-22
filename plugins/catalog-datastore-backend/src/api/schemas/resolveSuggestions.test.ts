import {
  PAIR_PERSIST_CAP,
  RANK_CLIFF_RATIO,
  resolveSuggestions,
} from './resolveSuggestions';

interface TestSuggestion {
  id: string;
  sourceDatasourceId?: string;
  sourceField: string;
  targetDatasourceId: string;
  targetField: string;
  score: number;
  conflictKeyField?: string;
}

function suggestion(overrides: Partial<TestSuggestion> = {}): TestSuggestion {
  return {
    id: 'default',
    sourceField: '$.owner',
    targetDatasourceId: 'github-users',
    targetField: '$.login',
    score: 0.9,
    ...overrides,
  };
}

const RUN_DS = 'k8s';

describe('resolveSuggestions', () => {
  it('constants match the spec verbatim', () => {
    expect(RANK_CLIFF_RATIO).toBe(0.5);
    expect(PAIR_PERSIST_CAP).toBe(25);
  });

  describe('pass 1 — conflict resolution', () => {
    it('keeps the higher-scoring suggestion when two targets compete for the same dependent field', () => {
      const winner = suggestion({
        id: 'winner',
        targetDatasourceId: 'github-users',
        targetField: '$.login',
        score: 0.91,
      });
      const loser = suggestion({
        id: 'loser',
        targetDatasourceId: 'ldap-users',
        targetField: '$.uid',
        score: 0.6,
      });
      const { kept, suppressed } = resolveSuggestions([loser, winner], RUN_DS);

      expect(kept.map(s => s.id)).toEqual(['winner']);
      expect(suppressed).toHaveLength(1);
      expect(suppressed[0].suggestion.id).toBe('loser');
      expect(suppressed[0].reason).toBe('lost-conflict-resolution');
      // Loser's detail must name the winner's target.
      expect(suppressed[0].detail).toContain('github-users');
      expect(suppressed[0].detail).toContain('$.login');
    });

    it('breaks a score tie by codepoint compare of (targetDatasourceId, targetField), smaller wins', () => {
      const a = suggestion({
        id: 'a',
        targetDatasourceId: 'aaa-datasource',
        targetField: '$.x',
        score: 0.8,
      });
      const b = suggestion({
        id: 'b',
        targetDatasourceId: 'zzz-datasource',
        targetField: '$.x',
        score: 0.8,
      });
      const { kept, suppressed } = resolveSuggestions([b, a], RUN_DS);

      expect(kept.map(s => s.id)).toEqual(['a']);
      expect(suppressed.map(s => s.suggestion.id)).toEqual(['b']);
    });

    it('uses sourceDatasourceId ?? runDatasourceId to group the dependent field key, so different source datasources do not conflict', () => {
      const s1 = suggestion({
        id: 's1',
        sourceDatasourceId: 'ds-a',
        sourceField: '$.owner',
        score: 0.5,
      });
      const s2 = suggestion({
        id: 's2',
        sourceDatasourceId: 'ds-b',
        sourceField: '$.owner',
        score: 0.4,
      });
      const { kept, suppressed } = resolveSuggestions([s1, s2], RUN_DS);

      expect(kept.map(s => s.id)).toEqual(['s1', 's2']);
      expect(suppressed).toHaveLength(0);
    });

    it('collapses a transform-rescued candidate onto its original field via conflictKeyField, so it conflicts with a plain suggestion for that field despite a different sourceField', () => {
      // Mirrors a real rescue: sourceField becomes the rendered JSONata
      // expression, but conflictKeyField still names the original dependent
      // field ($.owner) it was rescued from.
      const plain = suggestion({
        id: 'plain',
        sourceField: '$.owner',
        targetDatasourceId: 'github-users',
        targetField: '$.login',
        score: 0.6,
      });
      const rescued = suggestion({
        id: 'rescued',
        sourceField: "$substringBefore($.owner, '-suffix')",
        conflictKeyField: '$.owner',
        targetDatasourceId: 'ldap-users',
        targetField: '$.uid',
        score: 0.91,
      });
      const { kept, suppressed } = resolveSuggestions([plain, rescued], RUN_DS);

      expect(kept.map(s => s.id)).toEqual(['rescued']);
      expect(suppressed).toHaveLength(1);
      expect(suppressed[0].suggestion.id).toBe('plain');
      expect(suppressed[0].reason).toBe('lost-conflict-resolution');
    });

    it('control: without conflictKeyField, two suggestions with different sourceField values never conflict (unchanged behavior)', () => {
      const a = suggestion({
        id: 'a',
        sourceField: '$.owner',
        targetDatasourceId: 'github-users',
        targetField: '$.login',
        score: 0.6,
      });
      const b = suggestion({
        id: 'b',
        sourceField: "$substringBefore($.owner, '-suffix')",
        targetDatasourceId: 'ldap-users',
        targetField: '$.uid',
        score: 0.91,
      });
      const { kept, suppressed } = resolveSuggestions([a, b], RUN_DS);

      expect(kept.map(s => s.id).sort()).toEqual(['a', 'b']);
      expect(suppressed).toHaveLength(0);
    });
  });

  describe('pass 2 — rank cliff', () => {
    it('cuts at the first cliff and suppresses everything after it, with a detail describing the cut', () => {
      const items = [0.95, 0.9, 0.4, 0.35].map((score, i) =>
        suggestion({
          id: `s${i}`,
          sourceField: `$.field${i}`,
          targetField: `$.target${i}`,
          score,
        }),
      );
      const { kept, suppressed } = resolveSuggestions(items, RUN_DS);

      expect(kept.map(s => s.id)).toEqual(['s0', 's1']);
      expect(suppressed.map(s => s.suggestion.id).sort()).toEqual(['s2', 's3']);
      for (const entry of suppressed) {
        expect(entry.reason).toBe('below-rank-cliff');
        expect(entry.detail).toBe('rank cliff after #2 (0.90 → 0.40)');
      }
    });

    it('keeps everything when no ratio between adjacent scores drops below RANK_CLIFF_RATIO', () => {
      const items = [0.95, 0.9, 0.7, 0.5].map((score, i) =>
        suggestion({
          id: `s${i}`,
          sourceField: `$.field${i}`,
          targetField: `$.target${i}`,
          score,
        }),
      );
      const { kept, suppressed } = resolveSuggestions(items, RUN_DS);

      expect(kept.map(s => s.id)).toEqual(['s0', 's1', 's2', 's3']);
      expect(suppressed).toHaveLength(0);
    });

    it('does not cut when the next score is exactly half of the previous one (boundary is not below)', () => {
      const items = [1.0, 0.5].map((score, i) =>
        suggestion({
          id: `s${i}`,
          sourceField: `$.field${i}`,
          targetField: `$.target${i}`,
          score,
        }),
      );
      const { kept, suppressed } = resolveSuggestions(items, RUN_DS);

      expect(kept.map(s => s.id)).toEqual(['s0', 's1']);
      expect(suppressed).toHaveLength(0);
    });

    it('never cuts a single surviving suggestion for a pair', () => {
      const items = [suggestion({ id: 'only', score: 0.42 })];
      const { kept, suppressed } = resolveSuggestions(items, RUN_DS);

      expect(kept.map(s => s.id)).toEqual(['only']);
      expect(suppressed).toHaveLength(0);
    });
  });

  describe('pass 3 — per-pair cap', () => {
    it('keeps at most PAIR_PERSIST_CAP suggestions per unordered pair, suppressing the rest as over-pair-cap', () => {
      // 27 same-pair suggestions with tightly-spaced scores so no rank cliff
      // fires before the cap does.
      const items = Array.from({ length: 27 }, (_, i) =>
        suggestion({
          id: `s${i}`,
          sourceField: `$.field${String(i).padStart(2, '0')}`,
          targetField: `$.target${String(i).padStart(2, '0')}`,
          score: 1 - i * 0.01,
        }),
      );
      const { kept, suppressed } = resolveSuggestions(items, RUN_DS);

      expect(kept).toHaveLength(25);
      expect(suppressed).toHaveLength(2);
      expect(suppressed.every(s => s.reason === 'over-pair-cap')).toBe(true);
      // The two lowest-scored survive the cliff but not the cap.
      expect(suppressed.map(s => s.suggestion.id).sort()).toEqual([
        's25',
        's26',
      ]);
    });
  });

  describe('pass composition', () => {
    it('does not double-suppress a conflict loser in the rank-cliff pass', () => {
      // Two suggestions share a dependent field (conflict); the loser would
      // also be last in its pair's rank order, but must be reported only
      // once, as lost-conflict-resolution.
      const winner = suggestion({
        id: 'winner',
        sourceField: '$.owner',
        targetDatasourceId: 'github-users',
        targetField: '$.login',
        score: 0.95,
      });
      const loser = suggestion({
        id: 'loser',
        sourceField: '$.owner',
        targetDatasourceId: 'ldap-users',
        targetField: '$.uid',
        score: 0.1,
      });
      const { kept, suppressed } = resolveSuggestions([winner, loser], RUN_DS);

      expect(kept.map(s => s.id)).toEqual(['winner']);
      expect(suppressed).toHaveLength(1);
      expect(suppressed[0].suggestion.id).toBe('loser');
      expect(suppressed[0].reason).toBe('lost-conflict-resolution');
    });
  });

  it('preserves the original input relative order in kept', () => {
    const items = [
      suggestion({
        id: 'c',
        sourceField: '$.c',
        targetField: '$.tc',
        score: 0.3,
      }),
      suggestion({
        id: 'a',
        sourceField: '$.a',
        targetField: '$.ta',
        score: 0.9,
      }),
      suggestion({
        id: 'b',
        sourceField: '$.b',
        targetField: '$.tb',
        score: 0.5,
      }),
    ];
    const { kept } = resolveSuggestions(items, RUN_DS);

    // No conflicts/cliffs/caps triggered here (different dependent fields,
    // same pair but ratios stay >= 0.5) — order must mirror the input, not
    // the internal score-descending processing order.
    expect(kept.map(s => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('is deterministic across repeated calls with the same input', () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      suggestion({
        id: `s${i}`,
        sourceDatasourceId: i % 2 === 0 ? 'ds-a' : 'ds-b',
        sourceField: `$.field${i % 5}`,
        targetDatasourceId: i % 3 === 0 ? 'target-a' : 'target-b',
        targetField: `$.t${i % 7}`,
        score: Math.round(((i * 37) % 100) / 100 + 0.001 * i) / 1,
      }),
    );

    const first = resolveSuggestions(items, RUN_DS);
    const second = resolveSuggestions(items, RUN_DS);

    expect(second).toEqual(first);
  });
});
