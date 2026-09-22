import { Kind, parse } from 'graphql';
import { z } from 'zod';

const headerEntry = z.object({ key: z.string(), value: z.string() });

const nextLinkConditionSchema = z
  .object({
    param: z.string(),
    equals: z.string().optional(),
    notEquals: z.string().optional(),
  })
  .refine(
    value => value.equals !== undefined || value.notEquals !== undefined,
    {
      message: 'nextLinkCondition requires equals or notEquals',
    },
  );

function isSingleOperationDocument(query: string): boolean {
  try {
    const doc = parse(query);
    const operations = doc.definitions.filter(
      d => d.kind === Kind.OPERATION_DEFINITION,
    );
    return operations.length <= 1;
  } catch {
    return true;
  }
}

export const paginationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z
    .object({
      type: z.literal('cursor'),
      cursorParam: z.string(),
      nextCursorExpression: z.string(),
      paramLocation: z.enum(['query', 'body']).optional(),
      bodyParamsPath: z.string().min(1).optional(),
    })
    .refine(
      value =>
        value.bodyParamsPath === undefined || value.paramLocation === 'body',
      { message: 'bodyParamsPath requires paramLocation "body"' },
    ),
  z.object({
    type: z.literal('page'),
    pageParam: z.string(),
    perPageParam: z.string(),
    perPage: z.number(),
    startPage: z.number().optional(),
  }),
  z
    .object({
      type: z.literal('offset'),
      offsetParam: z.string(),
      limitParam: z.string(),
      limit: z.number(),
      paramLocation: z.enum(['query', 'body']).optional(),
      bodyParamsPath: z.string().min(1).optional(),
      totalExpression: z.string().optional(),
    })
    .refine(
      value =>
        value.bodyParamsPath === undefined || value.paramLocation === 'body',
      { message: 'bodyParamsPath requires paramLocation "body"' },
    ),
  z.object({
    type: z.literal('link'),
    perPageParam: z.string().optional(),
    perPage: z.number().optional(),
    nextRequestMethod: z.enum(['GET', 'POST']).optional(),
    nextLinkCondition: nextLinkConditionSchema.optional(),
  }),
  z.object({
    type: z.literal('body-link'),
    nextLinkExpression: z.string(),
    perPageParam: z.string().optional(),
    perPage: z.number().optional(),
    nextRequestMethod: z.enum(['GET', 'POST']).optional(),
  }),
  z.object({
    type: z.literal('graphql-cursor'),
    cursorVariable: z.string(),
    nextCursorExpression: z.string(),
    hasNextPageExpression: z.string().optional(),
  }),
]);

const graphqlConfigSchema = z.object({
  query: z.string().refine(isSingleOperationDocument, {
    message:
      'Multi-operation GraphQL documents are not supported. Please include only one operation per query.',
  }),
  variables: z.record(z.string(), z.unknown()).optional(),
});

export const httpSourceConfigSchema = z.object({
  backendType: z.literal('http'),
  integrationId: z.string(),
  mode: z.enum(['rest', 'graphql']).optional().default('rest'),
  path: z.string(),
  method: z.enum(['GET', 'POST']).optional().default('GET'),
  headers: z
    .union([z.record(z.string(), z.string()), z.array(headerEntry)])
    .optional(),
  body: z.unknown().optional(),
  graphql: graphqlConfigSchema.optional(),
  arrayExpression: z.string(),
  objectIdExpression: z.string().optional().default('id'),
  queryParams: z.record(z.string(), z.string()).optional(),
  pagination: paginationSchema.optional(),
});

export type HttpSourceConfig = z.infer<typeof httpSourceConfigSchema>;

export function parseHttpSourceConfig(
  config: Record<string, unknown>,
): HttpSourceConfig {
  return httpSourceConfigSchema.parse({ ...config, backendType: 'http' });
}
