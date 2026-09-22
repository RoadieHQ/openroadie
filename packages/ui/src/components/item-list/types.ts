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

export type StatusFilter = 'all' | 'active' | 'inactive';

export interface StatusOption {
  value: StatusFilter;
  label: string;
}

export interface BaseItem {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  logoUrl: string;
  enabled?: boolean;
  updatedAt: string;
}

export interface ItemGroup<T extends BaseItem> {
  key: string;
  label: string;
  icon?: string;
  color?: string;
  logoUrl: string;
  items: T[];
}

export interface FilterState {
  search: string;
  status: StatusFilter;
}
