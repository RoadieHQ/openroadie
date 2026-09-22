import { describe, expect, it, vi } from 'vitest';
import type { IntegrationBackedConfig } from '../../../api/datastore/datastore-client';
import type { RelationshipRuleEditorState } from './use-relationship-rule-editor';
import {
  addLookupStage,
  removeLookupStage,
  stageStatus,
  stagesFromEditor,
} from './relationship-stages';

type EditorOverrides = Partial<RelationshipRuleEditorState>;

function makeEditor(
  overrides: EditorOverrides = {},
): RelationshipRuleEditorState {
  return {
    sourceFieldExpression: '',
    targetFieldExpression: '',
    relationshipType: '',
    strategy: 'field-matching',
    isIntegrationBacked: false,
    integrationConfig: null,
    setStrategy: vi.fn(),
    setIntegrationConfig: vi.fn(),
    previewResult: null,
    previewLoading: false,
    previewError: null,
    previewStale: false,
    ...overrides,
  } as unknown as RelationshipRuleEditorState;
}

const CONFIG: IntegrationBackedConfig = {
  integrationId: 'github',
  method: 'GET',
  path: '/repos/{value}',
  responseMatchExpression: '$.slug',
};

describe('stagesFromEditor', () => {
  it('returns Source → Match for a field-matching rule', () => {
    const stages = stagesFromEditor(makeEditor());
    expect(stages.map(s => s.role)).toEqual(['source', 'match']);
    expect(stages.every(s => !s.removable)).toBe(true);
  });

  it('inserts a removable Lookup stage for an integration-backed rule', () => {
    const stages = stagesFromEditor(
      makeEditor({ isIntegrationBacked: true, integrationConfig: CONFIG }),
    );
    expect(stages.map(s => s.role)).toEqual(['source', 'lookup', 'match']);
    const lookup = stages.find(s => s.role === 'lookup');
    expect(lookup?.removable).toBe(true);
  });
});

describe('add/removeLookupStage (strategy switch)', () => {
  it('adding a lookup flips strategy to integration-backed and seeds a config', () => {
    const editor = makeEditor();
    addLookupStage(editor);
    expect(editor.setStrategy).toHaveBeenCalledWith('integration-backed');
    expect(editor.setIntegrationConfig).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '', integrationId: '' }),
    );
  });

  it('adding a lookup keeps an existing config', () => {
    const editor = makeEditor({ integrationConfig: CONFIG });
    addLookupStage(editor);
    expect(editor.setStrategy).toHaveBeenCalledWith('integration-backed');
    expect(editor.setIntegrationConfig).not.toHaveBeenCalled();
  });

  it('removing the lookup returns to field-matching', () => {
    const editor = makeEditor({
      isIntegrationBacked: true,
      integrationConfig: CONFIG,
    });
    removeLookupStage(editor);
    expect(editor.setStrategy).toHaveBeenCalledWith('field-matching');
  });
});

describe('stageStatus', () => {
  it('source is pending until a field expression is set', () => {
    expect(stageStatus('source', makeEditor())).toBe('pending');
    expect(
      stageStatus('source', makeEditor({ sourceFieldExpression: '$.id' })),
    ).toBe('configured');
  });

  it('match is configured with target field + relationship type, success after preview', () => {
    const configured = makeEditor({
      targetFieldExpression: '$.name',
      relationshipType: 'ownedBy',
    });
    expect(stageStatus('match', configured)).toBe('configured');

    const previewed = makeEditor({
      targetFieldExpression: '$.name',
      relationshipType: 'ownedBy',
      previewResult: { items: [], total: 0 } as never,
    });
    expect(stageStatus('match', previewed)).toBe('success');
  });

  it('reflects running and error preview states', () => {
    expect(stageStatus('match', makeEditor({ previewLoading: true }))).toBe(
      'running',
    );
    expect(stageStatus('match', makeEditor({ previewError: 'boom' }))).toBe(
      'error',
    );
  });

  it('lookup is configured only with integration + path + response match', () => {
    expect(
      stageStatus(
        'lookup',
        makeEditor({ isIntegrationBacked: true, integrationConfig: CONFIG }),
      ),
    ).toBe('configured');
    expect(
      stageStatus(
        'lookup',
        makeEditor({
          isIntegrationBacked: true,
          integrationConfig: { ...CONFIG, path: '' },
        }),
      ),
    ).toBe('pending');
  });

  it('lookup is configured when an advanced path expression is set instead of a literal path', () => {
    expect(
      stageStatus(
        'lookup',
        makeEditor({
          isIntegrationBacked: true,
          integrationConfig: {
            ...CONFIG,
            path: '',
            pathExpression: '"/repos/" & spec.repo',
          },
        }),
      ),
    ).toBe('configured');
  });
});
