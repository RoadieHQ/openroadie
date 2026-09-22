import type {
  HttpRequestOptions,
  IntegrationClient,
} from '@roadiehq/integrations-node';
import type { IntegrationRuleCaller } from '../database';

export function makeIntegrationRuleCaller(
  integrationClient: Pick<IntegrationClient, 'request'>,
): IntegrationRuleCaller {
  return ({ integrationId, method, path, workspaceId }) => {
    const requestOptions: HttpRequestOptions = {
      backendType: 'http',
      method: method.toUpperCase() as HttpRequestOptions['method'],
      path,
      workspaceId,
    };
    return integrationClient.request(integrationId, requestOptions);
  };
}
