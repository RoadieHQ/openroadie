export async function deleteDatasourceWithRules({
  datasourceId,
  relatedRuleIds,
  deleteDatasource,
  deleteRule,
}: {
  datasourceId: string;
  relatedRuleIds: string[];
  deleteDatasource: (id: string) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
}): Promise<{ failedRuleIds: string[] }> {
  await deleteDatasource(datasourceId);

  const failedRuleIds: string[] = [];
  for (const ruleId of relatedRuleIds) {
    try {
      await deleteRule(ruleId);
    } catch {
      failedRuleIds.push(ruleId);
    }
  }

  return { failedRuleIds };
}
