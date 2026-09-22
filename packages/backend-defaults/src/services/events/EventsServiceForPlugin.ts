import type {
  EventParams,
  EventsService,
  EventsServiceSubscribeOptions,
} from './types';

export class EventsServiceForPlugin implements EventsService {
  constructor(
    private eventsService: EventsService,
    private pluginId: string,
  ) {}

  async publish(params: EventParams): Promise<void> {
    return await this.eventsService.publish(params);
  }

  async subscribe(options: EventsServiceSubscribeOptions) {
    return await this.eventsService.subscribe({
      ...options,
      id: `${this.pluginId}-${options.id}`,
    });
  }
}
