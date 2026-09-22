import jsonata, { JsonataOptions } from 'jsonata';
import { parseAllDocuments } from 'yaml';
import {
  validateAllowedFunctions,
  ValidateOptions,
} from './validateAllowedFunctions';
import { JSONATA_SAFE_BUILTINS } from './builtins';

const MAX_YAML_SIZE = 1_000_000;
const MAX_ALIAS_COUNT = 50;

function parseYaml(input: string): unknown[] {
  if (input.length > MAX_YAML_SIZE) {
    throw new Error('YAML input exceeds maximum size');
  }
  const docs = parseAllDocuments(input);
  return docs.map(doc => doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT }));
}

export const jsonataSafe = (
  expression: string,
  options?: JsonataOptions & ValidateOptions,
) => {
  const { allowedFunctions, allowLambdas, ...jsonataOptions } = options || {};
  const compiled = jsonata(expression, jsonataOptions);
  const effectiveAllowedFunctions = [
    ...JSONATA_SAFE_BUILTINS,
    ...(allowedFunctions || []),
  ];
  const { ok, violations } = validateAllowedFunctions(compiled, {
    allowLambdas,
    allowedFunctions: effectiveAllowedFunctions,
  });
  if (!ok) {
    throw new Error(
      `Failed to validate jsonata: ${JSON.stringify(violations)}`,
    );
  }
  compiled.registerFunction('parseYaml', parseYaml, '<s:a>');
  return compiled;
};
