import { TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import { applyMigrations } from './applyMigrations';
import { SuggestionVerdictDao } from './SuggestionVerdictDao';

const databases = TestDatabases.create();

describe('SuggestionVerdictDao', () => {
  let testDb: Knex;
  let dao: SuggestionVerdictDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    dao = new SuggestionVerdictDao({ knex: testDb });
  }, 120_000);

  beforeEach(async () => {
    await testDb('datastore_suggestion_verdict').del();
  });

  afterAll(async () => {
    await testDb.destroy();
  });

  it('appends and returns a verdict with generated id and timestamp', async () => {
    const ruleId = uuid();
    const verdict = await dao.appendVerdict({
      ruleId,
      action: 'dismiss',
      actor: 'user:default/joao',
      score: 0.62,
      confidenceBand: 'medium',
      evidenceSummary: { distinctMatchedValueCount: 4 },
      rankShown: 2,
    });

    expect(verdict.id).toBeTruthy();
    expect(verdict.ruleId).toBe(ruleId);
    expect(verdict.action).toBe('dismiss');
    expect(verdict.actor).toBe('user:default/joao');
    expect(verdict.score).toBeCloseTo(0.62);
    expect(verdict.confidenceBand).toBe('medium');
    expect(verdict.evidenceSummary).toEqual({ distinctMatchedValueCount: 4 });
    expect(verdict.rankShown).toBe(2);
    expect(new Date(verdict.createdAt).getTime()).not.toBeNaN();
  });

  it('stores nullable fields as null', async () => {
    const verdict = await dao.appendVerdict({
      ruleId: uuid(),
      action: 'reset',
      actor: 'service',
      score: null,
      confidenceBand: null,
      evidenceSummary: null,
      rankShown: null,
    });

    expect(verdict.score).toBeNull();
    expect(verdict.confidenceBand).toBeNull();
    expect(verdict.evidenceSummary).toBeNull();
    expect(verdict.rankShown).toBeNull();
  });

  it('lists verdicts filtered by ruleId, newest first, with total', async () => {
    const ruleA = uuid();
    const ruleB = uuid();
    await dao.appendVerdict({
      ruleId: ruleA,
      action: 'dismiss',
      actor: 'a',
      score: null,
      confidenceBand: null,
      evidenceSummary: null,
      rankShown: null,
    });
    await dao.appendVerdict({
      ruleId: ruleA,
      action: 'reset',
      actor: 'a',
      score: null,
      confidenceBand: null,
      evidenceSummary: null,
      rankShown: null,
    });
    await dao.appendVerdict({
      ruleId: ruleB,
      action: 'approve',
      actor: 'b',
      score: null,
      confidenceBand: null,
      evidenceSummary: null,
      rankShown: null,
    });

    const all = await dao.listVerdicts();
    expect(all.total).toBe(3);

    const forA = await dao.listVerdicts({ ruleId: ruleA });
    expect(forA.total).toBe(2);
    expect(forA.items.map(v => v.action)).toEqual(['reset', 'dismiss']);

    const paged = await dao.listVerdicts({ limit: 1, offset: 1 });
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBe(3);
  });

  it('lists every verdict for calibration in a stable created_at asc, id asc order', async () => {
    const ruleId = uuid();
    const v1 = await dao.appendVerdict({
      ruleId,
      action: 'dismiss',
      actor: 'a',
      score: null,
      confidenceBand: null,
      evidenceSummary: null,
      rankShown: null,
    });
    const v2 = await dao.appendVerdict({
      ruleId,
      action: 'approve',
      actor: 'a',
      score: null,
      confidenceBand: null,
      evidenceSummary: null,
      rankShown: null,
    });
    const v3 = await dao.appendVerdict({
      ruleId,
      action: 'reset',
      actor: 'a',
      score: null,
      confidenceBand: null,
      evidenceSummary: null,
      rankShown: null,
    });

    // Force every row's created_at to the same instant so ordering can only
    // come from the id tiebreaker, not insertion-order timestamps.
    const fixedTimestamp = new Date('2026-01-01T00:00:00.000Z');
    await testDb('datastore_suggestion_verdict')
      .whereIn('id', [v1.id, v2.id, v3.id])
      .update({ created_at: fixedTimestamp });

    const expectedIds = [v1.id, v2.id, v3.id].sort();

    const first = await dao.listVerdictsForCalibration();
    const firstIds = first.filter(v => v.ruleId === ruleId).map(v => v.id);
    expect(firstIds).toEqual(expectedIds);

    const second = await dao.listVerdictsForCalibration();
    const secondIds = second.filter(v => v.ruleId === ruleId).map(v => v.id);
    expect(secondIds).toEqual(firstIds);
  });

  it('keeps verdict history and calibration isolated by workspace', async () => {
    const workspaceA = uuid();
    const workspaceB = uuid();
    const ruleId = uuid();
    await dao.appendVerdict(
      {
        ruleId,
        action: 'approve',
        actor: 'workspace-a-reviewer',
        score: 0.9,
        confidenceBand: 'high',
        evidenceSummary: null,
        rankShown: 0,
      },
      workspaceA,
    );
    await dao.appendVerdict(
      {
        ruleId,
        action: 'dismiss',
        actor: 'workspace-b-reviewer',
        score: 0.2,
        confidenceBand: 'low',
        evidenceSummary: null,
        rankShown: 0,
      },
      workspaceB,
    );

    const historyA = await dao.listVerdicts({ workspaceId: workspaceA });
    const historyB = await dao.listVerdicts({ workspaceId: workspaceB });
    const calibrationA = await dao.listVerdictsForCalibration(workspaceA);
    const calibrationB = await dao.listVerdictsForCalibration(workspaceB);

    expect(historyA.items.map(verdict => verdict.action)).toEqual(['approve']);
    expect(historyB.items.map(verdict => verdict.action)).toEqual(['dismiss']);
    expect(calibrationA.map(verdict => verdict.actor)).toEqual([
      'workspace-a-reviewer',
    ]);
    expect(calibrationB.map(verdict => verdict.actor)).toEqual([
      'workspace-b-reviewer',
    ]);
  });
});
