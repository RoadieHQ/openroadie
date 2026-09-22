---
paths:
  - '**/*.test.{ts,tsx}'
---

# Testing

Runner: **Vitest** with `@testing-library/react` and `@testing-library/user-event`.

## File naming

Always `<component-name>.test.tsx` co-located next to the component. Never use `__tests__/` directories.

## Pattern

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComponentName } from './component-name';

describe('ComponentName', () => {
  it('should render', () => {
    render(<ComponentName />);
    expect(screen.getByText('...')).toBeInTheDocument();
  });

  it('should handle interaction', async () => {
    const user = userEvent.setup();
    render(<ComponentName />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByText('...')).toBeVisible();
  });
});
```
