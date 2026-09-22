import { coreServices, createServiceFactory } from '@roadiehq/extensions-api';
import { DatabaseManager } from '../database';

export const rootDatabaseServiceFactory = createServiceFactory({
  service: coreServices.rootDatabase,
  deps: {
    config: coreServices.rootConfig,
    lifecycle: coreServices.rootLifecycle,
    logger: coreServices.rootLogger,
  },
  async factory({ config, lifecycle, logger }) {
    const dm = DatabaseManager.fromConfig(config, {
      rootLifecycle: lifecycle,
      rootLogger: logger,
    });
    return {
      forPlugin(pluginId: string) {
        return dm.forPlugin(pluginId, { lifecycle, logger });
      },
    };
  },
});
