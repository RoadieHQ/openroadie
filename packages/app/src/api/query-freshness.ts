interface QueryFreshnessPolicy {
  staleTime?: number;
  refetchOnWindowFocus: boolean;
}

export const queryFreshness = {
  eventBacked: {
    refetchOnWindowFocus: false,
  },
  focusRefresh: {
    refetchOnWindowFocus: true,
  },
  deploymentStatic: {
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  },
} satisfies Record<string, QueryFreshnessPolicy>;
