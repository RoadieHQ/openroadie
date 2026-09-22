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
import React from 'react';
import { DateTime } from 'luxon';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@roadiehq/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roadiehq/ui/table';
import { Button } from '@roadiehq/ui/button';
import { InlineCode } from '@roadiehq/ui/inline-code';
import { EmptyState } from '@roadiehq/ui/empty-state';
import { KeyRound, Trash2, Webhook } from 'lucide-react';
import { useAlert } from '../../api';
import { TableBodySkeleton } from '../common';
import { useWebhooks } from './use-webhooks';
import { CreateTokenDialog } from './create-token-dialog';
import { pageContentClassName } from '../../config/page-layout';
import { cn } from '@roadiehq/ui/utils';

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  return DateTime.fromISO(iso).toRelative() ?? iso;
}

export function WebhooksPage() {
  const {
    subscriptions,
    tokens,
    loading,
    error,
    deletingToken,
    deletingSubscription,
    createToken,
    deleteToken,
    deleteSubscription,
  } = useWebhooks();
  const alertApi = useAlert();

  const handleDeleteToken = async (id: string, label: string) => {
    if (!window.confirm(`Revoke token "${label}"?`)) return;
    try {
      await deleteToken(id);
    } catch (e) {
      alertApi.post({
        message:
          e instanceof Error ? e.message : 'Failed to revoke webhook token',
        severity: 'error',
      });
    }
  };

  const handleDeleteSubscription = async (id: string, url: string) => {
    if (!window.confirm(`Remove subscription for ${url}?`)) return;
    try {
      await deleteSubscription(id);
    } catch (e) {
      alertApi.post({
        message:
          e instanceof Error
            ? e.message
            : 'Failed to remove webhook subscription',
        severity: 'error',
      });
    }
  };

  if (error) {
    return (
      <div className={pageContentClassName}>
        <Card>
          <CardHeader>
            <CardTitle>Failed to load webhooks</CardTitle>
            <CardDescription>{error.message}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn(pageContentClassName, 'space-y-6')}>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Webhook tokens</CardTitle>
              <CardDescription className="text-pretty">
                Bearer tokens used by OSS roadie plugins to register
                subscriptions with this deployment. Each token is shown once at
                creation — store it somewhere safe.
              </CardDescription>
            </div>
            <CreateTokenDialog
              createToken={createToken}
              disabled={deletingToken}
            />
          </div>
        </CardHeader>
        <CardContent>
          {!loading && tokens.length === 0 ? (
            <EmptyState
              icon={<KeyRound className="h-8 w-8" />}
              title="No tokens yet"
              description="Create one to allow an OSS roadie plugin to register webhook subscriptions."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              {loading && tokens.length === 0 ? (
                <TableBodySkeleton columns={4} />
              ) : (
                <TableBody>
                  {tokens.map(token => (
                    <TableRow key={token.id}>
                      <TableCell className="font-medium">
                        {token.label}
                      </TableCell>
                      <TableCell>{formatRelative(token.createdAt)}</TableCell>
                      <TableCell>{formatRelative(token.lastUsedAt)}</TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={deletingToken}
                          onClick={() =>
                            handleDeleteToken(token.id, token.label)
                          }
                          aria-label={`Revoke ${token.label}`}
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              )}
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active subscriptions</CardTitle>
          <CardDescription className="text-pretty">
            OSS plugins that have registered to receive datasource-updated
            webhooks. Each subscription has its own HMAC secret used to sign
            outgoing webhook requests.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!loading && subscriptions.length === 0 ? (
            <EmptyState
              icon={<Webhook className="h-8 w-8" />}
              title="No subscriptions yet"
              description="They appear here automatically once an OSS roadie instance registers using one of the tokens above."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Callback URL</TableHead>
                  <TableHead>Filters</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              {loading && subscriptions.length === 0 ? (
                <TableBodySkeleton columns={4} />
              ) : (
                <TableBody>
                  {subscriptions.map(sub => (
                    <TableRow key={sub.id}>
                      <TableCell className="font-mono text-xs break-all">
                        {sub.url}
                      </TableCell>
                      <TableCell>
                        <InlineCode>{JSON.stringify(sub.filters)}</InlineCode>
                      </TableCell>
                      <TableCell>{formatRelative(sub.createdAt)}</TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={deletingSubscription}
                          onClick={() =>
                            handleDeleteSubscription(sub.id, sub.url)
                          }
                          aria-label={`Remove subscription ${sub.url}`}
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              )}
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
