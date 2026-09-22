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

import React from 'react';
import {
  Filter,
  Shuffle,
  Merge,
  GitBranch,
  Sparkles,
  Braces,
  Play,
  Database,
  Globe,
  MessageSquare,
  GitFork,
  Save,
  BadgeCheck,
  SlidersHorizontal,
  ArrowRightFromLine,
  type LucideIcon,
} from 'lucide-react';

const iconMap = new Map<string, LucideIcon>([
  ['filter_list', Filter],
  ['transform', Shuffle],
  ['call_merge', Merge],
  ['account_tree', GitBranch],
  ['auto_awesome', Sparkles],
  ['data_object', Braces],
  ['play_arrow', Play],
  ['storage', Database],
  ['http', Globe],
  ['chat', MessageSquare],
  ['github', GitFork],
  ['save', Save],
  ['verified', BadgeCheck],
  ['tune', SlidersHorizontal],
  ['output', ArrowRightFromLine],
]);

const categoryIconMap = new Map<string, LucideIcon>([
  ['trigger', Play],
  ['source', Database],
  ['transform', Shuffle],
  ['sink', Save],
]);

export function getIconComponent(iconName: string): React.ReactElement {
  const IconComponent = iconMap.get(iconName) ?? Braces;
  return <IconComponent className="size-4" />;
}

export function getCategoryIcon(category: string): React.ReactElement {
  const IconComponent = categoryIconMap.get(category) ?? Braces;
  return <IconComponent className="size-4 text-muted-foreground" />;
}
