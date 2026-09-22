import { JsonObject } from '@roadiehq/types';
import {
  AuthService,
  RoadieCredentials,
  RoadieNonePrincipal,
  RoadiePrincipalTypes,
  RoadieServicePrincipal,
  RoadieUserPrincipal,
  coreServices,
  createServiceFactory,
} from '@roadiehq/extensions-api';

const NONE_CREDENTIALS: RoadieCredentials<RoadieNonePrincipal> = {
  $$type: '@roadiehq/RoadieCredentials',
  principal: { type: 'none' },
};

class RoadieAuthService implements AuthService {
  async authenticate(
    _token: string,
    _options?: { allowLimitedAccess?: boolean },
  ): Promise<RoadieCredentials> {
    return NONE_CREDENTIALS;
  }

  isPrincipal<TType extends keyof RoadiePrincipalTypes>(
    credentials: RoadieCredentials,
    type: TType,
  ): credentials is RoadieCredentials<RoadiePrincipalTypes[TType]> {
    const principal = credentials.principal as { type?: string };
    return principal?.type === type;
  }

  async getNoneCredentials(): Promise<RoadieCredentials<RoadieNonePrincipal>> {
    return NONE_CREDENTIALS;
  }

  async getOwnServiceCredentials(): Promise<
    RoadieCredentials<RoadieServicePrincipal>
  > {
    return {
      $$type: '@roadiehq/RoadieCredentials',
      principal: { type: 'service', subject: 'roadie' },
    };
  }

  async getPluginRequestToken(_options: {
    onBehalfOf: RoadieCredentials;
    targetPluginId: string;
  }): Promise<{ token: string }> {
    return { token: '' };
  }

  async getLimitedUserToken(
    _credentials: RoadieCredentials<RoadieUserPrincipal>,
  ): Promise<{ token: string; expiresAt: Date }> {
    return { token: '', expiresAt: new Date(0) };
  }

  async listPublicServiceKeys(): Promise<{ keys: JsonObject[] }> {
    return { keys: [] };
  }
}

export const authServiceFactory = createServiceFactory({
  service: coreServices.auth,
  deps: {},
  async factory() {
    return new RoadieAuthService();
  },
});
