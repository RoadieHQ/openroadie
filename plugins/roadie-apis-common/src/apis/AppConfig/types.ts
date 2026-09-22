/*
 * Copyright 2022 Larder Software Ltd.
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
import { JsonObject } from '@roadiehq/types';
import { JSONSchema7 } from 'json-schema';

export type SecretConfig = {
  name: string;
  description?: string;
  helpUrl?: string;
};

export type BulkAnnotationEditor = {
  configId: string;
  title: string;
  catalogQueryFilter: Record<string, unknown>;
  selectLabel: string;
  annotationKey: string;
};

export type AppConfigSection = {
  id: string;
  title: string;
  data: JsonObject;
  customUi?: boolean;
  category?: string;
  group?: string;
  schema: RoadieSchema;
  rjsfSchema?: JSONSchema7;
  featureFlag?: string;
  path?: string;
  description?: string;
  secrets?: SecretConfig[];
  componentPackages?: (string | { package: string; components: string[] })[];
  bulkAnnotationEditor?: BulkAnnotationEditor;
};

type RoadieSchema = (JSONSchema7 | AppConfigSectionSplitSchema) & {
  docsLink?: string;
};
export type AppConfigSectionSplitSchema = {
  editor: JSONSchema7;
  defaultsViewer: JSONSchema7;
};

export type Proxy = { target: string; path: string };
