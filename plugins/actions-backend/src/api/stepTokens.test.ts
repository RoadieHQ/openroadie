import { describe, it, expect } from 'vitest';
import { resolveStepTokens } from './stepTokens';

describe('resolveStepTokens', () => {
  const outputs = {
    findRepo: {
      ok: true,
      status: 200,
      data: {
        default_branch: 'main',
        topics: ['a', 'b', 'c'],
        owner: { login: 'roadie' },
      },
    },
  };

  it('resolves a plain dot-path into a step output', async () => {
    const resolved = await resolveStepTokens(
      ['/repos/x/branches/{{steps.findRepo.data.default_branch}}/protection'],
      outputs,
    );
    expect(resolved).toEqual({
      'steps.findRepo.data.default_branch': 'main',
    });
  });

  it('resolves nested paths and jsonata expressions', async () => {
    const resolved = await resolveStepTokens(
      [
        '{{steps.findRepo.data.owner.login}}',
        '{{ steps.findRepo.data.topics[[0..1]] }}',
      ],
      outputs,
    );
    expect(resolved['steps.findRepo.data.owner.login']).toBe('roadie');
    expect(resolved['steps.findRepo.data.topics[[0..1]]']).toEqual(['a', 'b']);
  });

  it('collects tokens across multiple templates and dedupes', async () => {
    const resolved = await resolveStepTokens(
      [
        '{{steps.findRepo.data.default_branch}}',
        'x {{steps.findRepo.data.default_branch}} y',
      ],
      outputs,
    );
    expect(Object.keys(resolved)).toEqual([
      'steps.findRepo.data.default_branch',
    ]);
  });

  it('ignores plain input tokens and function calls', async () => {
    const resolved = await resolveStepTokens(
      ['/orgs/{{org}}/repos {{uuidv4()}} {{stepsCount}}'],
      outputs,
    );
    expect(resolved).toEqual({});
  });

  it('throws when a reference resolves to no value (typo-proofing)', async () => {
    await expect(
      resolveStepTokens(['{{steps.findRepo.data.nope}}'], outputs),
    ).rejects.toThrow(/resolved to no value.*findRepo/s);
  });

  it('throws when the referenced step id does not exist', async () => {
    await expect(
      resolveStepTokens(['{{steps.findRep.data.default_branch}}'], outputs),
    ).rejects.toThrow(/resolved to no value/);
  });

  it('keeps brace-containing jsonata expressions intact (object constructors)', async () => {
    const resolved = await resolveStepTokens(
      ['{{ steps.findRepo.data.{"branch": default_branch} }}'],
      outputs,
    );
    expect(resolved['steps.findRepo.data.{"branch": default_branch}']).toEqual({
      branch: 'main',
    });
  });

  it('throws a descriptive error for an unparseable expression', async () => {
    await expect(
      resolveStepTokens(['{{steps.findRepo.data.[}}'], outputs),
    ).rejects.toThrow(/steps\.findRepo\.data\.\[/);
  });

  it('rejects disallowed jsonata functions (jsonata-safe)', async () => {
    await expect(
      resolveStepTokens(['{{steps.$eval("1+1")}}'], outputs),
    ).rejects.toThrow();
  });
});
