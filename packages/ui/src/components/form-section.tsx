import * as React from 'react';
import { cn } from '../lib/utils';

export interface FormSectionProps extends React.HTMLAttributes<HTMLHeadingElement> {
  title: string;
}

/** Muted section heading that divides a long form into groups of fields. */
const FormSection = React.forwardRef<HTMLHeadingElement, FormSectionProps>(
  ({ title, className, ...props }, ref) => {
    return (
      <h3
        ref={ref}
        className={cn(
          'mt-2 text-sm leading-[22px] font-medium text-muted-foreground',
          className,
        )}
        {...props}
      >
        {title}
      </h3>
    );
  },
);
FormSection.displayName = 'FormSection';

export { FormSection };
