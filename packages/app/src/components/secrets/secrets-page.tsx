import React from 'react';
import { SecretsTable } from './secrets-table';

export function SecretsPage() {
  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <SecretsTable />
    </div>
  );
}
