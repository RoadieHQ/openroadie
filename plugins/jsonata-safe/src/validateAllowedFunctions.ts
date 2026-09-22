import { Expression, ExprNode } from 'jsonata';

export interface ValidateOptions {
  allowedFunctions?: Array<string>;
  allowLambdas?: boolean;
}

export const validateAllowedFunctions = (
  expr: Expression,
  options: ValidateOptions = {},
): { ok: boolean; violations: Array<{ path: string; reason: string }> } => {
  const { allowedFunctions, allowLambdas = true } = options;
  const ast = expr.ast();

  const violations: { path: string; function?: string; reason: string }[] = [];

  const getProcedure = (
    node: ExprNode,
  ): { type?: unknown; value?: unknown } | undefined => {
    const procedure = (node as { procedure?: unknown }).procedure;
    return procedure && typeof procedure === 'object'
      ? (procedure as { type?: unknown; value?: unknown })
      : undefined;
  };

  const visit = (node: ExprNode, path = '$') => {
    if (!node || typeof node !== 'object') {
      return;
    }

    if (node.type === 'function' && allowedFunctions) {
      const procedure = getProcedure(node);
      if (
        procedure &&
        procedure?.type === 'variable' &&
        typeof procedure.value === 'string'
      ) {
        const name = procedure.value;
        if (!allowedFunctions.includes(name)) {
          violations.push({
            path,
            function: name,
            reason: `disallowed function: ${name}`,
          });
        }
      } else {
        violations.push({
          path,
          reason: 'dynamic-function-call',
        });
      }
    }

    if (node.type === 'lambda' && !allowLambdas) {
      violations.push({
        path,
        reason: 'lambda-not-allowed',
      });
    }

    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object') {
        if (Array.isArray(v)) {
          v.forEach((item, i) => visit(item, `${path}.${k}[${i}]`));
        } else {
          visit(v, `${path}.${k}`);
        }
      }
    }
  };

  visit(ast);

  return {
    ok: violations.length === 0,
    violations,
  };
};
