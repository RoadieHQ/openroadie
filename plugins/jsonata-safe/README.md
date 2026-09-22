# @roadiehq/jsonata-safe

A safe wrapper around JSONata that validates expressions against an allowlist of functions before execution.

## Installation

```bash
yarn add @roadiehq/jsonata-safe
```

## Usage

```typescript
import jsonataSafe from '@roadiehq/jsonata-safe';

const expression = jsonataSafe('$sum(numbers)', {
  allowedFunctions: ['sum', 'count', 'average'],
});

const result = await expression.evaluate({ numbers: [1, 2, 3] });
```

## Options

| Option             | Type       | Default     | Description                                                                 |
| ------------------ | ---------- | ----------- | --------------------------------------------------------------------------- |
| `allowedFunctions` | `string[]` | `undefined` | List of allowed function names. If not provided, all functions are allowed. |
| `allowLambdas`     | `boolean`  | `true`      | Whether to allow lambda expressions in the JSONata expression.              |

## Error Handling

If the expression contains disallowed functions or lambdas (when disabled), an error is thrown:

```typescript
try {
  const expression = jsonataSafe('$eval("malicious")', {
    allowedFunctions: ['sum'],
  });
} catch (error) {
  // Error: Failed to validate jsonata: [{"path":"$","function":"eval","reason":"disallowed function: eval"}]
}
```
