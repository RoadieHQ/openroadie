import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { referenceCompletionSource } from './reference-completion';

describe('referenceAutocompletion', () => {
  it('keeps the resource name and token distinct in each completion', () => {
    const references = [
      {
        id: 'source-id',
        type: 'datasource' as const,
        name: 'Deployment status',
        slug: 'data-source-jul-21-14-02-18',
      },
    ];
    const result = referenceCompletionSource(() => references)(
      new CompletionContext(EditorState.create({ doc: '@' }), 1, true),
    );

    expect(result?.options).toContainEqual(
      expect.objectContaining({
        displayLabel: 'Deployment status',
        label: '@datasource:data-source-jul-21-14-02-18',
        referenceName: 'Deployment status',
        referenceToken: ':data-source-jul-21-14-02-18',
        section: expect.objectContaining({
          name: 'Data sources',
          referenceType: 'datasource',
        }),
      }),
    );
    expect(result?.getMatch?.(result?.options[0] ?? {}, [])).toEqual([]);
  });
});
