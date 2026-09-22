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

import { generateText, streamText, pipeUIMessageStreamToResponse } from 'ai';
import { LoggerService } from '@roadiehq/extensions-api';
import {
  AiResponse,
  LLMModel,
  ModelCallOptions,
  ModelService,
} from '@roadiehq/ai-node';

export interface NonStreamingModelCallOptions {
  model: LLMModel;
  query: string;
  userId: string;
}

export class InferenceModelService implements ModelService {
  constructor(private readonly logger: LoggerService) {}

  async stream({ model, query, response }: ModelCallOptions) {
    this.logger.debug(`Streaming response for query: ${query}`);

    const stream = streamText({
      model,
      prompt: query,
    });

    stream.pipeTextStreamToResponse(response);
  }

  async streamUI({ model, query, response }: ModelCallOptions) {
    this.logger.debug(`Streaming UI response for query: ${query}`);

    const stream = streamText({
      model,
      prompt: query,
    });

    const uiStream = stream.toUIMessageStream();

    pipeUIMessageStreamToResponse({
      response,
      stream: uiStream,
      status: 200,
    });
  }

  async invoke({
    model,
    query,
  }: NonStreamingModelCallOptions): Promise<AiResponse> {
    this.logger.debug(`Processing query: ${query}`);

    const result = await generateText({
      model,
      prompt: query,
    });

    return {
      text: result.text,
      usage: {
        inputTokens: result.usage?.inputTokens || 0,
        outputTokens: result.usage?.outputTokens || 0,
        totalTokens: result.usage?.totalTokens || 0,
      },
    };
  }
}
