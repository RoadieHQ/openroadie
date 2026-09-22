/*
 * Copyright 2025 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Response } from 'express';
import jsonataSafe, { repairBareFunctionCalls } from '@roadiehq/jsonata-safe';
import { AiService, MODEL_TIER } from '@roadiehq/ai-node';
import { LoggerService } from '@roadiehq/extensions-api';
import { JSONATA_REFERENCE } from './jsonataReference';

const JSONATA_ASSIST_MODEL = MODEL_TIER.SMALL;

export interface JsonataAssistRequest {
  inputSample: unknown;
  description: string;
  transformType?: 'filter' | 'map';
}

export interface JsonataAssistResponse {
  expression: string;
  valid: boolean;
  error?: string;
}

function truncateForPrompt(data: unknown, maxLength: number = 5000): string {
  const json = JSON.stringify(data, null, 2);
  if (json === undefined) {
    return 'undefined';
  }
  if (json.length <= maxLength) {
    return json;
  }
  return `${json.slice(0, maxLength)}\n... (truncated)`;
}

function extractFieldNames(sample: unknown): string[] {
  if (
    Array.isArray(sample) &&
    sample.length > 0 &&
    typeof sample[0] === 'object' &&
    sample[0] !== null
  ) {
    return Object.keys(sample[0]);
  }
  if (typeof sample === 'object' && sample !== null) {
    return Object.keys(sample);
  }
  return [];
}

function buildPrompt(
  inputSample: unknown,
  description: string,
  transformType?: 'filter' | 'map',
): string {
  const sampleJson = truncateForPrompt(inputSample);
  const fields = extractFieldNames(inputSample);
  const fieldsInfo =
    fields.length > 0 ? `\nAVAILABLE FIELDS: ${fields.join(', ')}` : '';

  let transformContext = '';
  if (transformType === 'filter') {
    transformContext = `
CONTEXT: This is a FILTER expression.
- The expression is evaluated for EACH item in the array
- It must return true (keep item) or false (remove item)
- Reference fields directly: status = "active" NOT $.status
- For substring checks use $contains(name, "arc")
- For case-insensitive substring checks use $contains($lowercase(name), "arc")
- Example: login = "admin" or age > 18`;
  } else if (transformType === 'map') {
    transformContext = `
CONTEXT: This is a MAP/TRANSFORM expression.
- Transform the input array or each item
- To extract a field from all items: $.fieldName
- To reshape each item: $.{ "newKey": oldKey }`;
  }

  return `You are a JSONata expression generator.

INPUT DATA:
\`\`\`json
${sampleJson}
\`\`\`
${fieldsInfo}
${transformContext}

USER REQUEST: ${description}

${JSONATA_REFERENCE}

RULES:
- Return ONLY the JSONata expression, no explanation
- Do not wrap in backticks, quotes, or markdown

EXPRESSION:`;
}

export function validateJsonataExpression(expression: string): {
  valid: boolean;
  error?: string;
} {
  try {
    jsonataSafe(expression, { allowLambdas: false });
    return { valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid expression';
    return { valid: false, error: message };
  }
}

function normalizeExpressionCandidate(value: string): string {
  return value
    .trim()
    .replace(/^```(?:jsonata)?\s*/i, '')
    .replace(/```$/i, '')
    .replace(/^(?:expression|jsonata|output)\s*:\s*/i, '')
    .trim();
}

export function extractJsonataExpression(raw: string): string {
  const trimmed = raw.trim();
  const candidates = new Set<string>();

  candidates.add(trimmed);

  const expressionMarker = trimmed.match(/EXPRESSION:\s*([\s\S]*)$/i);
  if (expressionMarker?.[1]) {
    candidates.add(expressionMarker[1]);
  }

  for (const match of trimmed.matchAll(/```(?:jsonata)?\s*([\s\S]*?)```/gi)) {
    if (match[1]) {
      candidates.add(match[1]);
    }
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index++) {
    candidates.add(lines.slice(index).join('\n'));
  }

  for (const candidate of candidates) {
    const expression = repairBareFunctionCalls(
      normalizeExpressionCandidate(candidate),
    );
    if (!expression) {
      continue;
    }

    if (validateJsonataExpression(expression).valid) {
      return expression;
    }
  }

  return repairBareFunctionCalls(normalizeExpressionCandidate(trimmed));
}

export async function streamJsonataAssist(
  aiService: AiService,
  request: JsonataAssistRequest,
  response: Response,
  userId: string,
  logger: LoggerService,
): Promise<void> {
  const { inputSample, description, transformType } = request;

  if (!description || typeof description !== 'string') {
    response
      .status(400)
      .json({ error: { message: 'Description is required' } });
    return;
  }

  const prompt = buildPrompt(inputSample, description, transformType);

  logger.debug('Generating JSONata expression', { description });

  try {
    const model = await aiService.getModel(JSONATA_ASSIST_MODEL);
    if (!model) {
      response.status(503).json({
        error: {
          message:
            'AI is not configured. Please configure an AI provider in settings.',
        },
      });
      return;
    }

    await aiService.stream({
      model,
      query: prompt,
      response,
      userId,
    });
  } catch (err) {
    logger.error('Error streaming JSONata assist', err as Error);
    if (!response.headersSent) {
      response
        .status(500)
        .json({ error: { message: 'Failed to generate expression' } });
    } else {
      response.end();
    }
  }
}

export async function generateJsonataExpression(
  aiService: AiService,
  request: JsonataAssistRequest,
  userId: string,
  logger: LoggerService,
): Promise<JsonataAssistResponse> {
  const { inputSample, description, transformType } = request;

  if (!description || typeof description !== 'string') {
    throw new Error('Description is required');
  }

  const prompt = buildPrompt(inputSample, description, transformType);

  logger.debug('Generating JSONata expression (non-streaming)', {
    description,
  });

  try {
    const model = await aiService.getModel(JSONATA_ASSIST_MODEL);
    if (!model) {
      throw new Error(
        'AI is not configured. Please configure an AI provider in settings.',
      );
    }

    const result = await aiService.invoke({
      model,
      query: prompt,
      userId,
    });

    const expression = extractJsonataExpression(result.text);
    const validation = validateJsonataExpression(expression);

    return {
      expression,
      ...validation,
    };
  } catch (err) {
    logger.error('Error generating JSONata expression', err as Error);
    throw err;
  }
}
