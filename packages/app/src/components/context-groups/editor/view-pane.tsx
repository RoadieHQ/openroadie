import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { z } from 'zod';
import { BookOpen, Loader2, Star, Trash2 } from 'lucide-react';
import { validateLiquidTemplate } from '@roadiehq/liquid-safe';
import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import { Editor, type EditorDiagnostic } from '@roadiehq/ui/editor';
import { InlineCode } from '@roadiehq/ui/inline-code';
import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { Popover, PopoverContent, PopoverTrigger } from '@roadiehq/ui/popover';
import { Spinner } from '@roadiehq/ui/spinner';
import { Switch } from '@roadiehq/ui/switch';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from '@roadiehq/ui/form';
import { useDatastore } from '../../../api';
import { contextGroupViewSchemaQuery, queryKeys } from '../../../api/queries';
import {
  getWorkspaceScopeKey,
  workspaceQueryKey,
  workspaceQueryKeyInScope,
} from '../../../api/workspace-scope';
import {
  AdvancedConfirmBanner,
  useAdvancedModeState,
  useZodForm,
} from '../../common';
import type {
  ContextGroupPreviewGroup,
  ContextGroupView,
} from '../../../api/datastore/datastore-client';
import { countTokenRange, formatTokenRange } from './token-counter';
import {
  compileViewTemplate,
  memberAccess,
  parseViewTemplate,
  ViewBuilder,
  ViewStarterGallery,
  EMPTY_VIEW_SPEC,
  type ViewSpec,
} from './view-builder';

const viewFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .regex(
      /^(?!-)(?!.*--)[a-z0-9-]+(?<!-)$/,
      'Lowercase alphanumeric with hyphens, e.g. "identifiers-only"',
    ),
  description: z.string(),
  template: z.string().min(1, 'Template is required'),
});

type ViewFormValues = z.infer<typeof viewFormSchema>;

/** The data functions the render path registers; templates may call them, so
 *  validation must know about them or every use reads as an unknown filter. */
const DATA_FUNCTIONS = ['related', 'object'];

const BLANK_TEMPLATE_STARTER = `# {{ group.name }}
{% for entry in members %}
## {{ entry[0] }}
{% for member in entry[1] %}{{ member.data | json: 2 }}
{% endfor %}{% endfor %}`;

const TEMPLATE_TAGS = [
  'assign',
  'break',
  'capture',
  'case / when',
  'comment',
  'continue',
  'cycle',
  'echo',
  'for / else',
  'if / elsif / else',
  'liquid',
  'raw',
  'unless',
  '# (inline comment)',
];

const TEMPLATE_FILTERS = [
  {
    label: 'Data (fetch from the catalog)',
    filters: ['related', 'object'],
  },
  {
    label: 'General',
    filters: ['json', 'default', 'size', 'date'],
  },
  {
    label: 'Strings',
    filters: [
      'append',
      'capitalize',
      'downcase',
      'lstrip',
      'prepend',
      'remove',
      'remove_first',
      'remove_last',
      'replace',
      'replace_first',
      'replace_last',
      'rstrip',
      'split',
      'strip',
      'strip_newlines',
      'truncate',
      'truncatewords',
      'upcase',
    ],
  },
  {
    label: 'Numbers',
    filters: [
      'abs',
      'at_least',
      'at_most',
      'ceil',
      'divided_by',
      'floor',
      'minus',
      'modulo',
      'plus',
      'round',
      'times',
    ],
  },
  {
    label: 'Arrays',
    filters: [
      'compact',
      'concat',
      'find',
      'find_exp',
      'first',
      'group_by',
      'group_by_exp',
      'has',
      'has_exp',
      'join',
      'last',
      'map',
      'reject',
      'reject_exp',
      'reverse',
      'slice',
      'sort',
      'sort_natural',
      'sum',
      'uniq',
      'where',
      'where_exp',
    ],
  },
];

const TEMPLATE_EXAMPLES = [
  {
    title: 'Dump the whole members map as JSON',
    code: '{{ members | json: 2 }}',
  },
  {
    title: 'Markdown summary, one section per data source',
    code: `# {{ group.name }}
{% for entry in members %}
## {{ entry[0] }}
{% for member in entry[1] %}- {{ member.data.name | default: member.objectId }}
{% endfor %}{% endfor %}`,
  },
  {
    title: 'Follow relationships with related',
    code: `{% assign prs = members['github-users'][0] | related: 'owns' %}
Pull requests ({{ prs | size }}):
{% for pr in prs %}- {{ pr.data.title }}
{% endfor %}`,
  },
  {
    title: 'Expand a reference into its full object',
    code: `{% assign refs = members['github-users'][0] | related %}
{% assign ref = refs.owns.items | first %}
{{ ref.datasourceId | object: ref.objectId | json: 2 }}`,
  },
];

function TemplateReference({ memberKeys }: { memberKeys: string[] }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
        >
          <BookOpen className="size-4" />
          Template reference
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[70vh] w-[26rem] overflow-y-auto"
      >
        <div className="space-y-4 text-xs text-muted-foreground">
          <p>
            Templates are{' '}
            <a
              href="https://liquidjs.com/tags/overview.html"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Liquid
            </a>{' '}
            rendered over the group document. The rendered text is exactly what
            an agent receives, so the output can be any format — JSON, Markdown,
            plain text.
          </p>

          {memberKeys.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-medium text-foreground">
                This group&apos;s data sources
              </p>
              <div className="flex flex-wrap gap-1">
                {memberKeys.map(key => (
                  <InlineCode key={key}>{memberAccess(key)}</InlineCode>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="font-medium text-foreground">Variables</p>
            <ul className="space-y-1">
              <li>
                <InlineCode>group</InlineCode> — the group&apos;s identity:{' '}
                <InlineCode>group.id</InlineCode>,{' '}
                <InlineCode>group.name</InlineCode>.
              </li>
              <li>
                <InlineCode>rule</InlineCode> — the rule that produced it:{' '}
                <InlineCode>rule.id</InlineCode>,{' '}
                <InlineCode>rule.name</InlineCode>,{' '}
                <InlineCode>rule.slug</InlineCode>,{' '}
                <InlineCode>rule.description</InlineCode>.
              </li>
              <li>
                <InlineCode>members</InlineCode> — the group&apos;s objects,
                keyed by data source slug. Each member is{' '}
                <InlineCode>{'{ datasourceId, objectId, data }'}</InlineCode> —
                the raw object lives in <InlineCode>data</InlineCode>. Access
                directly (
                <InlineCode>
                  members[&apos;github-users&apos;][0].data.email
                </InlineCode>
                ) or loop generically: in{' '}
                <InlineCode>{'{% for entry in members %}'}</InlineCode>,{' '}
                <InlineCode>entry[0]</InlineCode> is the data source key and{' '}
                <InlineCode>entry[1]</InlineCode> its member list.
              </li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <p className="font-medium text-foreground">Data functions</p>
            <ul className="space-y-1">
              <li>
                <InlineCode>related</InlineCode> — the objects a member points
                to via outgoing relationships. Bare{' '}
                <InlineCode>{'{{ member | related }}'}</InlineCode> returns
                references grouped by relationship type; typed{' '}
                <InlineCode>{"{{ member | related: 'owns' }}"}</InlineCode>{' '}
                returns full member wrappers.
              </li>
              <li>
                <InlineCode>object</InlineCode> — one object by identity:{' '}
                <InlineCode>
                  {"{{ member.datasourceId | object: 'object-id' }}"}
                </InlineCode>
                .
              </li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <p className="font-medium text-foreground">Tags</p>
            <div className="flex flex-wrap gap-1">
              {TEMPLATE_TAGS.map(tag => (
                <InlineCode key={tag}>{tag}</InlineCode>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="font-medium text-foreground">Filters</p>
            {TEMPLATE_FILTERS.map(group => (
              <div key={group.label} className="space-y-1">
                <p>{group.label}</p>
                <div className="flex flex-wrap gap-1">
                  {group.filters.map(filter => (
                    <InlineCode key={filter}>{filter}</InlineCode>
                  ))}
                </div>
              </div>
            ))}
            <p>
              <InlineCode>json</InlineCode> takes an optional indent width and
              base column:{' '}
              <InlineCode>{'{{ member.data | json: 2, 6 }}'}</InlineCode>{' '}
              prefixes every line after the first with 6 spaces, so a multi-line
              value stays aligned with the column it&apos;s embedded at.
            </p>
            <p>
              Anything else (e.g. <InlineCode>include</InlineCode>,{' '}
              <InlineCode>render</InlineCode>, HTML filters) is rejected when
              the template is saved.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="font-medium text-foreground">Examples</p>
            {TEMPLATE_EXAMPLES.map(example => (
              <div key={example.title} className="space-y-1">
                <p>{example.title}</p>
                <pre className="overflow-x-auto rounded-md border bg-muted/40 p-2 font-mono">
                  {example.code}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A materialized group rendered through the template being edited — what an
 *  agent would receive if it requested this view right now. */
function ViewTemplatePreview({
  ruleId,
  groupId,
  template,
}: {
  ruleId: string;
  groupId: string;
  template: string;
}) {
  const datastore = useDatastore();
  const { data, isLoading, error } = useQuery({
    queryKey: workspaceQueryKey(
      'contextGroups',
      'viewTemplatePreview',
      ruleId,
      groupId,
      template,
    ),
    queryFn: () =>
      datastore.renderContextGroupViewPreview(ruleId, {
        template,
        groupId,
      }),
    // Template edits re-key the query; keep the last render visible while the
    // new one computes instead of flashing a spinner per keystroke.
    placeholderData: keepPreviousData,
  });

  const tokens = useMemo(
    () => (data ? countTokenRange(data.rendered) : null),
    [data],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-24 items-center justify-center">
        <Spinner size={16} />
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {error instanceof Error ? error.message : 'Failed to render template'}
      </p>
    );
  }
  return (
    <div className="space-y-1">
      {tokens && (
        <p
          className={
            tokens.isHigh
              ? 'text-2xs font-medium text-warning'
              : 'text-2xs text-muted-foreground'
          }
        >
          {formatTokenRange(tokens)} tokens per group
        </p>
      )}
      <pre className="max-h-96 overflow-auto rounded-md border border-border bg-card p-3 text-xs whitespace-pre-wrap">
        {data?.rendered}
      </pre>
    </div>
  );
}

interface ViewPaneProps {
  ruleId: string;
  /** Absent means creating a new view. */
  view?: ContextGroupView;
  /** Renders the right-hand groups preview column (supplied by the editor so
   *  it matches the settings tab exactly); receives the expanded-row renderer
   *  that shows a group through the template currently being edited. */
  renderPreview?: (
    renderExpanded: (group: ContextGroupPreviewGroup) => ReactNode,
  ) => ReactNode;
  /** Called after a new view is created (create mode only). */
  onCreated?: (created: ContextGroupView) => void;
  /** Called after this view is deleted (edit mode only). */
  onDeleted?: () => void;
  /** Called when creating is abandoned (create mode only). */
  onCancelCreate?: () => void;
}

/**
 * Full-page editor for one named view of a context group rule.
 *
 * The stored artifact is a Liquid template, but the interface is the builder:
 * pick data sources, fields and relationships and the template is compiled for
 * you. The spec round-trips out of the template it produced, so reopening a
 * builder-made view lands back in the builder; anything hand-written
 * (including the seeded default) opens in advanced mode instead of being
 * silently rewritten.
 */
export function ViewPane({
  ruleId,
  view,
  renderPreview,
  onCreated,
  onDeleted,
  onCancelCreate,
}: ViewPaneProps) {
  const datastore = useDatastore();
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Create mode starts on the starter gallery; editing an existing view
  // goes straight to the builder.
  const [started, setStarted] = useState(Boolean(view));

  const invalidate = (workspaceScopeKey: string) =>
    queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.contextGroupViews(ruleId),
        workspaceScopeKey,
      ),
    });

  const { data: schema, isLoading: schemaLoading } = useQuery(
    contextGroupViewSchemaQuery(datastore, ruleId),
  );

  const initialValues = useMemo<ViewFormValues>(
    () => ({
      name: view?.name ?? '',
      description: view?.description ?? '',
      template: view?.template ?? '',
    }),
    [view],
  );

  const form = useZodForm({
    schema: viewFormSchema,
    defaultValues: initialValues,
  });
  const { isSubmitting } = form.formState;
  const rootError = form.formState.errors.root?.message;

  const handleTemplateChange = useCallback(
    (_spec: ViewSpec | undefined, template: string) => {
      form.setValue('template', template, {
        shouldDirty: true,
        shouldValidate: true,
      });
    },
    [form],
  );

  const advanced = useAdvancedModeState<ViewSpec>({
    initialExpression: view?.template,
    emptyStructured: EMPTY_VIEW_SPEC,
    parse: parseViewTemplate,
    compile: compileViewTemplate,
    onChange: handleTemplateChange,
  });

  const promoteMutation = useMutation({
    mutationFn: async (id: string) => {
      const workspaceScopeKey = getWorkspaceScopeKey();
      await datastore.updateContextGroupView(id, { isDefault: true });
      return workspaceScopeKey;
    },
    onSuccess: workspaceScopeKey => invalidate(workspaceScopeKey),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const workspaceScopeKey = getWorkspaceScopeKey();
      await datastore.deleteContextGroupView(id);
      return workspaceScopeKey;
    },
    onSuccess: workspaceScopeKey => invalidate(workspaceScopeKey),
  });

  // The expanded preview rows re-render on every template change; debounce so
  // typing must settle before the backend recomputes each expanded group.
  const template = advanced.expression;
  const [debouncedTemplate, setDebouncedTemplate] = useState(template);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTemplate(template), 500);
    return () => clearTimeout(timer);
  }, [template]);

  // Parse errors carry a template position, so they can be shown on the line
  // that caused them rather than as a message under the editor.
  const issues = useMemo(
    () =>
      advanced.advancedMode
        ? validateLiquidTemplate(template, DATA_FUNCTIONS)
        : [],
    [advanced.advancedMode, template],
  );
  const diagnostics = useMemo<EditorDiagnostic[]>(
    () =>
      issues
        .filter(issue => issue.line !== undefined)
        .map(issue => ({
          line: issue.line as number,
          column: issue.col,
          message: issue.message,
          severity: 'error' as const,
        })),
    [issues],
  );
  const positionlessIssue = issues.find(issue => issue.line === undefined);

  const handleStarter = (starter: {
    id: string;
    description: string;
    spec?: ViewSpec;
  }) => {
    if (!form.getValues('name')) {
      form.setValue('name', starter.id === 'blank' ? '' : starter.id, {
        shouldValidate: false,
      });
    }
    if (!form.getValues('description') && starter.spec) {
      form.setValue('description', starter.description);
    }
    if (starter.spec) {
      advanced.setStructured(starter.spec);
    } else {
      advanced.toggleAdvanced(true);
      advanced.setAdvancedExpression(BLANK_TEMPLATE_STARTER);
    }
    setStarted(true);
  };

  const handleSubmit = form.handleSubmit(async values => {
    const workspaceScopeKey = getWorkspaceScopeKey();
    try {
      const input = {
        name: values.name,
        description: values.description.trim() || undefined,
        template: values.template,
      };
      if (view) {
        await datastore.updateContextGroupView(view.id, input);
        await invalidate(workspaceScopeKey);
        form.reset(values);
      } else {
        const created = await datastore.createContextGroupView(ruleId, input);
        await invalidate(workspaceScopeKey);
        onCreated?.(created);
      }
    } catch (e: unknown) {
      form.setError('root', {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return (
    <div className="flex min-h-0 flex-1 gap-6 overflow-hidden p-6">
      <div className="w-[30rem] shrink-0 overflow-y-auto pt-2 pr-1">
        <Form {...form}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <p className="text-sm text-muted-foreground">
              A named view of this context group. Agents receive the default
              view unless they request another by name.
            </p>
            {view &&
              (view.isDefault ? (
                <div>
                  <Badge variant="secondary">default</Badge>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Make ${view.name} the default view`}
                    disabled={promoteMutation.isPending}
                    onClick={() => {
                      setActionError(null);
                      promoteMutation.mutate(view.id, {
                        onError: (e: unknown) =>
                          setActionError(
                            e instanceof Error ? e.message : String(e),
                          ),
                      });
                    }}
                  >
                    <Star className="size-4" />
                    Make default
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Delete view ${view.name}`}
                    onClick={() => {
                      setActionError(null);
                      setConfirmingDelete(true);
                    }}
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                </div>
              ))}

            <fieldset disabled={isSubmitting} className="flex flex-col gap-5">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <OutlinedInput label="Name *" {...field} />
                    </FormControl>
                    <FormDescription>
                      The handle agents use to request this view, e.g.{' '}
                      <code>identifiers-only</code>.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <OutlinedInput label="Description" {...field} />
                    </FormControl>
                    <FormDescription>
                      Shown to agents choosing between views — say what this one
                      is for.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!started ? (
                <ViewStarterGallery
                  ruleId={ruleId}
                  schema={schema}
                  loading={schemaLoading}
                  onPick={handleStarter}
                />
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium">Contents</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Edit template directly</span>
                      <Switch
                        checked={advanced.advancedMode}
                        onCheckedChange={advanced.toggleAdvanced}
                        aria-label="Edit template directly"
                      />
                    </div>
                  </div>

                  {advanced.confirmOpen && (
                    <AdvancedConfirmBanner
                      onConfirm={advanced.confirmExitAdvanced}
                      onCancel={advanced.cancelExitAdvanced}
                      testId="view-advanced-confirm"
                    />
                  )}

                  {advanced.advancedMode ? (
                    <div className="flex flex-col gap-2">
                      <Editor
                        value={advanced.expression}
                        onChange={advanced.setAdvancedExpression}
                        minHeight="18rem"
                        maxHeight="32rem"
                        resizable
                        height="22rem"
                        diagnostics={diagnostics}
                        error={positionlessIssue?.message ?? null}
                        aria-label="View template"
                        data-testid="view-template-editor"
                      />
                      <TemplateReference
                        memberKeys={(schema?.sources ?? []).map(s => s.key)}
                      />
                    </div>
                  ) : (
                    <ViewBuilder
                      schema={schema}
                      loading={schemaLoading}
                      spec={advanced.structured}
                      onChange={advanced.setStructured}
                    />
                  )}
                </div>
              )}
            </fieldset>

            <div className="flex items-center justify-end gap-3 border-t pt-4">
              {(rootError || actionError) && (
                <p role="alert" className="mr-auto text-xs text-destructive">
                  {rootError ?? actionError}
                </p>
              )}
              {!view && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={onCancelCreate}
                >
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={isSubmitting || !started}>
                {isSubmitting && (
                  <Loader2 className="motion-icon-spin size-4" />
                )}
                {view ? 'Save' : 'Create'}
              </Button>
            </div>
          </form>
        </Form>

        <ConfirmationDialog
          open={confirmingDelete}
          title={`Delete view "${view?.name}"?`}
          contentText="Agents requesting this view by name will get an error after deletion."
          isDelete
          confirmButtonText="Delete"
          confirmingText="Deleting…"
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={async () => {
            if (!view) return;
            try {
              await deleteMutation.mutateAsync(view.id);
              setConfirmingDelete(false);
              onDeleted?.();
            } catch (e: unknown) {
              setActionError(e instanceof Error ? e.message : String(e));
              setConfirmingDelete(false);
            }
          }}
        />
      </div>

      {renderPreview?.(group => (
        <ViewTemplatePreview
          ruleId={ruleId}
          groupId={group.id}
          template={debouncedTemplate}
        />
      ))}
    </div>
  );
}
