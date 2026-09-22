import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../collapsible';
import { cn } from '../../lib/utils';
import type { DynamicToolUIPart, ToolUIPart } from 'ai';
import { CheckIcon, ChevronDownIcon, Loader2Icon, XIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { isValidElement } from 'react';

import { CodeBlock } from './code-block';

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn(
      'group w-full border-b border-border bg-transparent',
      className,
    )}
    {...props}
  />
);

export type ToolHeaderProps = {
  title?: string;
  className?: string;
} & (
  | { type: ToolUIPart['type']; state: ToolUIPart['state']; toolName?: never }
  | {
      type: DynamicToolUIPart['type'];
      state: DynamicToolUIPart['state'];
      toolName: string;
    }
);

const StatusIndicator = ({ state }: { state: ToolPart['state'] }) => {
  const isRunning =
    state === 'input-streaming' ||
    state === 'input-available' ||
    state === 'approval-responded' ||
    state === 'approval-requested';

  if (isRunning) {
    return (
      <Loader2Icon className="motion-icon-spin size-2.5 text-muted-foreground/40" />
    );
  }

  if (state === 'output-available') {
    return <CheckIcon className="size-2.5 text-muted-foreground/50" />;
  }

  if (state === 'output-error' || state === 'output-denied') {
    return <XIcon className="size-2.5 text-destructive/60" />;
  }

  return null;
};

export const getStatusBadge = (status: ToolPart['state']) => (
  <StatusIndicator state={status} />
);

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  ...props
}: ToolHeaderProps) => {
  const derivedName =
    type === 'dynamic-tool' ? toolName : type.split('-').slice(1).join('-');

  return (
    <CollapsibleTrigger
      className={cn(
        'flex w-full items-center gap-1.5 py-1 text-left',
        className,
      )}
      {...props}
    >
      <StatusIndicator state={state} />
      <span className="flex-1 font-mono text-[11px] font-medium text-muted-foreground">
        {title ?? derivedName}
      </span>
      <ChevronDownIcon className="motion-transform size-3 text-muted-foreground/40 group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn('overflow-hidden py-2 text-xs', className)}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<'div'> & {
  input: ToolPart['input'];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn('overflow-hidden', className)} {...props}>
    <div className="rounded bg-muted/50">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<'div'> & {
  output: ToolPart['output'];
  errorText: ToolPart['errorText'];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === 'object' && !isValidElement(output)) {
    Output = (
      <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
    );
  } else if (typeof output === 'string') {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn('mt-1', className)} {...props}>
      <div
        className={cn(
          'overflow-x-auto rounded text-xs',
          errorText
            ? 'bg-destructive/10 text-destructive'
            : 'bg-muted/50 text-foreground',
        )}
      >
        {errorText && <div className="p-2">{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
