import {
  autocompletion,
  completionKeymap,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSection,
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import {
  type CapabilityReference,
  type CapabilityReferenceType,
  REFERENCE_TYPE_LABELS,
} from './references';

const COMPLETION_TYPE: Record<CapabilityReferenceType, string> = {
  datasource: 'class',
  action: 'function',
  'context-group': 'namespace',
  capability: 'interface',
};

const REFERENCE_OPTION_CLASS = 'capability-reference-completion-option';
const REFERENCE_ROW_CLASS = 'capability-reference-completion-row';

interface ReferenceCompletion extends Completion {
  referenceName: string;
  referenceToken: string;
}

interface ReferenceCompletionSection extends CompletionSection {
  referenceType: CapabilityReferenceType;
}

function createReferenceSection(
  type: CapabilityReferenceType,
): ReferenceCompletionSection {
  return {
    name: REFERENCE_TYPE_LABELS[`${type}`],
    referenceType: type,
    header: () => {
      const header = document.createElement('div');
      header.className = 'capability-reference-completion-section';

      const label = document.createElement('span');
      label.textContent = REFERENCE_TYPE_LABELS[`${type}`];

      // Mirror the `@type:` prefix authors actually type (`toOption` inserts
      // `@${ref.type}:…`), so the hint can never drift from the real form.
      const token = document.createElement('span');
      token.className = 'capability-reference-completion-section-token';
      token.textContent = type;

      header.append(label, token);
      return header;
    },
  };
}

const REFERENCE_SECTIONS: Record<
  CapabilityReferenceType,
  ReferenceCompletionSection
> = {
  datasource: createReferenceSection('datasource'),
  action: createReferenceSection('action'),
  'context-group': createReferenceSection('context-group'),
  capability: createReferenceSection('capability'),
};

// Matches the `@…` token currently being typed, including a partial
// `type:slug` body. Hyphens and colons are part of the token.
const TOKEN_BEFORE = /@[a-z0-9:-]*/i;

function toOption(ref: CapabilityReference): ReferenceCompletion {
  const token = `@${ref.type}:${ref.slug}`;
  return {
    // `label` drives both filtering and the inserted text, so it carries the
    // full token; the resource name is shown alongside via `displayLabel`.
    label: token,
    displayLabel: ref.name,
    referenceName: ref.name,
    referenceToken: `:${ref.slug}`,
    type: COMPLETION_TYPE[ref.type],
    section: REFERENCE_SECTIONS[ref.type],
    apply: token,
  };
}

function isReferenceCompletion(
  completion: Completion,
): completion is ReferenceCompletion {
  return (
    'referenceName' in completion &&
    'referenceToken' in completion &&
    typeof completion.referenceName === 'string' &&
    typeof completion.referenceToken === 'string'
  );
}

function renderReferenceCompletion(completion: Completion): Node | null {
  if (!isReferenceCompletion(completion)) {
    return null;
  }

  const row = document.createElement('span');
  row.className = REFERENCE_ROW_CLASS;

  const name = document.createElement('span');
  name.className = `${REFERENCE_ROW_CLASS}-name`;
  name.textContent = completion.referenceName;

  const token = document.createElement('span');
  token.className = `${REFERENCE_ROW_CLASS}-token`;
  token.textContent = completion.referenceToken;

  row.append(name, token);
  return row;
}

/**
 * A CodeMirror completion source that offers capability references when the
 * author types `@`. Reads the latest reference list lazily via `getReferences`
 * so the editor extension can be built once while the data keeps updating.
 */
export function referenceCompletionSource(
  getReferences: () => CapabilityReference[],
) {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(TOKEN_BEFORE);
    if (!word) return null;
    // Don't pop up on an empty position unless explicitly requested.
    if (word.from === word.to && !context.explicit) return null;

    const references = getReferences();
    if (references.length === 0) return null;

    return {
      from: word.from,
      options: references.map(toOption),
      // CodeMirror cannot calculate matched ranges for a displayLabel that is
      // intentionally different from the inserted token.
      getMatch: () => [],
      // Keep the menu open and filtering as the user types the token.
      validFor: /^@[a-z0-9:-]*$/i,
    };
  };
}

/**
 * Build the self-contained autocompletion extension wired to the live
 * reference list. Includes the completion keymap so it works even when the
 * editor's default autocompletion is disabled (which keeps our `@` source as
 * the single completion provider).
 */
export function referenceAutocompletion(
  getReferences: () => CapabilityReference[],
): Extension {
  return [
    autocompletion({
      override: [referenceCompletionSource(getReferences)],
      icons: false,
      tooltipClass: () => 'capability-reference-completion-tooltip',
      optionClass: completion =>
        isReferenceCompletion(completion) ? REFERENCE_OPTION_CLASS : '',
      addToOptions: [
        {
          position: 50,
          render: renderReferenceCompletion,
        },
      ],
      // Always highlight the first option when the menu opens so it's obvious
      // what Enter will insert — otherwise a single available reference can
      // render with no visible selection.
      selectOnOpen: true,
    }),
    keymap.of(completionKeymap),
  ];
}
