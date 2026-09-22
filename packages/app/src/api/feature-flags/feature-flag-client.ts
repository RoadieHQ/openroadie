export type FeatureFlagValue =
  | string
  | boolean
  | number
  | Record<string, unknown>
  | null;

export class FeatureFlagClient {
  private flags: Record<string, FeatureFlagValue> | undefined;
  private inflight: Promise<Record<string, FeatureFlagValue>> | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly fetch: typeof globalThis.fetch,
  ) {}

  async getAllFlags(): Promise<Record<string, FeatureFlagValue>> {
    if (this.flags) {
      return this.flags;
    }
    if (!this.inflight) {
      this.inflight = this.fetchFlags();
    }
    return this.inflight;
  }

  get hasCachedFlags(): boolean {
    return this.flags !== undefined;
  }

  getCachedFlag<T extends FeatureFlagValue = FeatureFlagValue>(
    key: string,
    defaultValue: T,
  ): T {
    if (!this.flags) return defaultValue;
    const value = this.flags[`${key}`];
    return value === undefined ? defaultValue : (value as T);
  }

  async getFlag<T extends FeatureFlagValue = FeatureFlagValue>(
    key: string,
    defaultValue: T,
  ): Promise<T> {
    const flags = await this.getAllFlags();
    const value = flags[`${key}`];
    if (value === undefined) {
      return defaultValue;
    }
    return value as T;
  }

  private async fetchFlags(): Promise<Record<string, FeatureFlagValue>> {
    try {
      const res = await this.fetch(this.baseUrl);
      if (!res.ok) {
        return {};
      }
      const data = (await res.json()) as Record<string, FeatureFlagValue>;
      this.flags = data;
      return data;
    } catch {
      return {};
    }
  }
}
