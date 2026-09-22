import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServiceTokens } from '../../api';
import { resolveCustomerName } from './helpers';
import { workspaceQueryKey } from '../../api/workspace-scope';

type ResolveCustomerName = (customerId: string | undefined) => string;

const TokenNameContext = createContext<Map<string, string>>(new Map());

export function TokenNameProvider({ children }: { children: React.ReactNode }) {
  const serviceTokensClient = useServiceTokens();

  // Non-critical lookup: an errored query leaves `data` undefined and names
  // fall back to raw IDs (see resolveCustomerName).
  const { data } = useQuery({
    queryKey: workspaceQueryKey('mcpAuditLog', 'tokenNames'),
    queryFn: () => serviceTokensClient.list(),
  });

  const tokenNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const token of data?.tokens ?? []) {
      map.set(token.id, token.tokenName);
    }
    return map;
  }, [data]);

  return (
    <TokenNameContext.Provider value={tokenNameMap}>
      {children}
    </TokenNameContext.Provider>
  );
}

export function useResolveCustomerName(): ResolveCustomerName {
  const tokenNameMap = useContext(TokenNameContext);
  return useCallback(
    (customerId: string | undefined) =>
      resolveCustomerName(customerId, tokenNameMap),
    [tokenNameMap],
  );
}
