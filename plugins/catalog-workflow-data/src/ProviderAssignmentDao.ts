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

import { Knex } from 'knex';
import { LoggerService } from '@roadiehq/extensions-api';
import { ProviderAssignmentRow } from './types';

const TABLE_NAME = 'workflow_provider_assignments';

export interface ProviderAssignment {
  providerId: string;
  workflowId: string;
  assignedAt: Date;
}

function rowToAssignment(row: ProviderAssignmentRow): ProviderAssignment {
  return {
    providerId: row.provider_id,
    workflowId: row.workflow_id,
    assignedAt: row.assigned_at,
  };
}

export class ProviderAssignmentDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;

  constructor(options: { knex: Knex; logger: LoggerService }) {
    this.knex = options.knex;
    this.logger = options.logger.child({ name: 'ProviderAssignmentDao' });
  }

  private table(trx?: Knex) {
    return (trx || this.knex)<ProviderAssignmentRow>(TABLE_NAME);
  }

  async getByWorkflowId(
    workflowId: string,
  ): Promise<ProviderAssignment | undefined> {
    const row = await this.table().where('workflow_id', workflowId).first();
    return row ? rowToAssignment(row) : undefined;
  }

  async getByProviderId(
    providerId: string,
  ): Promise<ProviderAssignment | undefined> {
    const row = await this.table().where('provider_id', providerId).first();
    return row ? rowToAssignment(row) : undefined;
  }

  async getAllAssignments(): Promise<ProviderAssignment[]> {
    const rows = await this.table().select('*');
    return rows.map(rowToAssignment);
  }

  async getOrCreateAssignment(
    providerId: string,
    workflowId: string,
  ): Promise<{ assignment: ProviderAssignment; created: boolean }> {
    const existing = await this.getByWorkflowId(workflowId);
    if (existing) {
      return { assignment: existing, created: false };
    }

    const row: ProviderAssignmentRow = {
      provider_id: providerId,
      workflow_id: workflowId,
      assigned_at: new Date(),
    };

    try {
      await this.table().insert(row);
      this.logger.info(
        `Assigned provider ${providerId} to workflow ${workflowId}`,
      );
      return { assignment: rowToAssignment(row), created: true };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes('UNIQUE constraint failed') ||
          error.message.includes('duplicate key') ||
          error.message.includes('unique constraint'))
      ) {
        const existingAfterConflict = await this.getByWorkflowId(workflowId);
        if (existingAfterConflict) {
          return { assignment: existingAfterConflict, created: false };
        }
      }
      throw error;
    }
  }

  async deleteByWorkflowId(workflowId: string): Promise<boolean> {
    const deleted = await this.table()
      .where('workflow_id', workflowId)
      .delete();
    if (deleted > 0) {
      this.logger.info(
        `Released provider assignment for workflow ${workflowId}`,
      );
      return true;
    }
    return false;
  }
}
