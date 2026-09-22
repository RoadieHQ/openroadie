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

import type { Knex } from 'knex';
import type { LoggerService } from '@roadiehq/extensions-api';
import type { CatalogWorkflowClient } from '@roadiehq/catalog-workflow-common';
import type { CatalogDatastoreApi } from '@roadiehq/catalog-datastore-common';
import type { IntegrationClient } from '@roadiehq/integrations-node';
import { v4 as uuid } from 'uuid';
import {
  ContextGroupDao,
  IndexDao,
  ObjectDao,
  RelationshipRuleDao,
} from '@roadiehq/catalog-datastore-backend';

export type WorkflowDatastoreBridgeApi = Omit<
  Pick<
    CatalogDatastoreApi,
    | 'listIndexConfigurations'
    | 'createIndexConfiguration'
    | 'createRelationshipRule'
    | 'listRelationshipRules'
    | 'createContextGroupRule'
    | 'listContextGroupRules'
    | 'updateContextGroupRule'
    | 'materializeContextGroupsForDatasource'
    | 'deleteAllIndexConfigurations'
    | 'deleteAllObjects'
  >,
  | 'createRelationshipRule'
  | 'listRelationshipRules'
  | 'createContextGroupRule'
  | 'listContextGroupRules'
  | 'updateContextGroupRule'
  | 'materializeContextGroupsForDatasource'
> & {
  createRelationshipRule(
    input: Parameters<CatalogDatastoreApi['createRelationshipRule']>[0],
    workspaceId: string,
  ): ReturnType<CatalogDatastoreApi['createRelationshipRule']>;
  listRelationshipRules(
    options: Parameters<CatalogDatastoreApi['listRelationshipRules']>[0],
    workspaceId: string,
  ): ReturnType<CatalogDatastoreApi['listRelationshipRules']>;
  createContextGroupRule(
    input: Parameters<CatalogDatastoreApi['createContextGroupRule']>[0],
    workspaceId: string,
  ): ReturnType<CatalogDatastoreApi['createContextGroupRule']>;
  listContextGroupRules(
    options: Parameters<CatalogDatastoreApi['listContextGroupRules']>[0],
    workspaceId: string,
  ): ReturnType<CatalogDatastoreApi['listContextGroupRules']>;
  updateContextGroupRule(
    id: string,
    input: Parameters<CatalogDatastoreApi['updateContextGroupRule']>[1],
    workspaceId: string,
  ): ReturnType<CatalogDatastoreApi['updateContextGroupRule']>;
  materializeContextGroupsForDatasource(
    datasourceId: string,
    workspaceId: string,
  ): ReturnType<CatalogDatastoreApi['materializeContextGroupsForDatasource']>;
};

export class WorkflowDatastoreBridge implements WorkflowDatastoreBridgeApi {
  private readonly knex: Knex;
  private readonly indexDao: IndexDao;
  private readonly objectDao: ObjectDao;
  private readonly relationshipRuleDao: RelationshipRuleDao;
  private readonly contextGroupDao: ContextGroupDao;

  constructor(options: {
    knex: Knex;
    logger: LoggerService;
    catalogWorkflowClient: CatalogWorkflowClient;
    integrationClient: IntegrationClient;
  }) {
    this.knex = options.knex;
    this.indexDao = new IndexDao({
      knex: options.knex,
      logger: options.logger,
    });
    this.objectDao = new ObjectDao({ knex: options.knex });
    this.relationshipRuleDao = new RelationshipRuleDao({ knex: options.knex });
    this.contextGroupDao = new ContextGroupDao({
      knex: options.knex,
      catalogWorkflowClient: options.catalogWorkflowClient,
      integrationClient: options.integrationClient,
    });
  }

  async listIndexConfigurations(
    datasourceId: string,
    workspaceId?: string,
  ): Promise<
    Awaited<ReturnType<WorkflowDatastoreBridgeApi['listIndexConfigurations']>>
  > {
    return this.indexDao.listIndexConfigurations(datasourceId, workspaceId);
  }

  async createIndexConfiguration(
    datasourceId: string,
    input: Parameters<
      WorkflowDatastoreBridgeApi['createIndexConfiguration']
    >[1],
    workspaceId?: string,
  ): Promise<
    Awaited<ReturnType<WorkflowDatastoreBridgeApi['createIndexConfiguration']>>
  > {
    await this.knex.transaction(async trx => {
      const datastoreRows = await this.objectDao.getRowsByDatasource(
        datasourceId,
        trx,
        workspaceId,
      );
      await this.indexDao.insertConfigAndBuildIndexes(
        {
          id: uuid(),
          datasourceId,
          key: input.key,
          valueExpression: input.valueExpression,
          purpose: input.purpose,
        },
        datastoreRows,
        trx,
        workspaceId,
      );
    });
  }

  async createRelationshipRule(
    input: Parameters<WorkflowDatastoreBridgeApi['createRelationshipRule']>[0],
    workspaceId: string,
  ): Promise<
    Awaited<ReturnType<WorkflowDatastoreBridgeApi['createRelationshipRule']>>
  > {
    return this.relationshipRuleDao.createRelationshipRule(input, {
      workspaceId,
      origin: input.origin,
      state: input.state,
    });
  }

  async listRelationshipRules(
    options: Parameters<WorkflowDatastoreBridgeApi['listRelationshipRules']>[0],
    workspaceId: string,
  ): Promise<
    Awaited<ReturnType<WorkflowDatastoreBridgeApi['listRelationshipRules']>>
  > {
    return this.relationshipRuleDao.listRelationshipRules({
      ...options,
      workspaceId,
    });
  }

  async createContextGroupRule(
    input: Parameters<WorkflowDatastoreBridgeApi['createContextGroupRule']>[0],
    workspaceId: string,
  ): Promise<
    Awaited<ReturnType<WorkflowDatastoreBridgeApi['createContextGroupRule']>>
  > {
    const rule = await this.contextGroupDao.createRule(input, workspaceId);
    await this.contextGroupDao.materializeRule(rule.id, workspaceId);
    return rule;
  }

  async listContextGroupRules(
    options: Parameters<WorkflowDatastoreBridgeApi['listContextGroupRules']>[0],
    workspaceId: string,
  ): Promise<
    Awaited<ReturnType<WorkflowDatastoreBridgeApi['listContextGroupRules']>>
  > {
    return this.contextGroupDao.listRules({ ...options, workspaceId });
  }

  async updateContextGroupRule(
    id: string,
    input: Parameters<WorkflowDatastoreBridgeApi['updateContextGroupRule']>[1],
    workspaceId: string,
  ): Promise<
    Awaited<ReturnType<WorkflowDatastoreBridgeApi['updateContextGroupRule']>>
  > {
    const rule = await this.contextGroupDao.updateRule(id, input, workspaceId);
    if (!rule) {
      throw new Error(`Context group rule ${id} not found`);
    }
    await this.contextGroupDao.materializeRule(id, workspaceId);
    return rule;
  }

  async materializeContextGroupsForDatasource(
    datasourceId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.contextGroupDao.materializeForDatasource(
      datasourceId,
      workspaceId,
    );
  }

  async deleteAllIndexConfigurations(
    datasourceId: string,
    workspaceId?: string,
  ): Promise<void> {
    await this.indexDao.deleteAllIndexConfigurations(datasourceId, workspaceId);
  }

  async deleteAllObjects(
    datasourceId: string,
    workspaceId?: string,
  ): Promise<void> {
    await this.objectDao.deleteAllDatastoreItems(datasourceId, workspaceId);
  }
}
