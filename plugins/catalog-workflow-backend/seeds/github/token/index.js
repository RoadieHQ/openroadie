/*
 * Copyright 2026 Larder Software Limited
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

module.exports = [
  require('./github-repositories'),
  require('./github-organizations'),
  require('./github-pull-requests'),
  require('./github-pull-requests-per-repo'),
  require('./github-merged-pull-requests-per-repo'),
  require('./github-releases'),
  require('./github-actions'),
  require('./github-apps'),
  require('./github-codespaces'),
  require('./github-users'),
  require('./github-teams'),
  require('./github-dependabot-alerts'),
  require('./github-collaborators'),
  require('./github-catalog-info-files'),
  require('./github-markdown-files'),
  require('./github-yaml-files'),
  require('./github-copilot-seats'),
  require('./github-copilot-billing'),
  require('./github-copilot-metrics'),
];
