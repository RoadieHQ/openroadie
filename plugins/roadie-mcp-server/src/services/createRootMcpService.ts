/*
 * Copyright 2025 Larder Software Ltd.
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
import { McpService } from './McpService';

// The root endpoint unions every enabled service into one flat tool list, so
// its instructions lead with how the four groups divide by name prefix, then
// carry each service's own instructions through.
const ROOT_PREAMBLE = [
  'This server exposes several tool groups, distinguished by their name prefix:',
  '- explore_* — read-only lookups over your catalog (never mutate).',
  '- manage_* — create/update/delete operations (always mutate).',
  '- actions_* — run curated, org-defined operations against integrations.',
  '- integrations_* — raw authenticated requests to external services.',
  'Prefer explore_* to understand state, actions_* over integrations_* when a curated action exists, and check the prefix before calling: only manage_* and actions_execute_write change anything.',
].join('\n');

export const createRootMcpService = (
  services: McpService[],
  disabledTools?: Set<string>,
) => {
  let allTools = services.flatMap(service => service.tools);
  if (disabledTools?.size) {
    allTools = allTools.filter(t => !disabledTools.has(t.name));
  }
  const allResources = services.flatMap(service => service.resources);
  const allPrompts = services.flatMap(service => service.prompts);

  const instructions = [
    ROOT_PREAMBLE,
    ...services.map(s => s.instructions).filter((i): i is string => Boolean(i)),
  ].join('\n\n');

  return McpService.create('roadie-mcp', {
    tools: allTools,
    resources: allResources,
    prompts: allPrompts,
    instructions,
  });
};
