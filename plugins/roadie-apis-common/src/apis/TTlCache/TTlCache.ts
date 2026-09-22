export interface Cache<T = unknown> {
  get: (
    key: string,
    computeFunction: ({
      setTtl,
    }: {
      setTtl: (ttl: number) => void;
    }) => Promise<T>,
  ) => Promise<T>;
  clear: () => void;
}

export class TTlCache<T = unknown> implements Cache<T> {
  private cache: Map<string, Promise<T>>;
  private timers: Map<string, ReturnType<typeof setTimeout>>;
  private readonly defaultTtl: number;

  constructor(defaultTtl = 60000) {
    this.cache = new Map();
    this.timers = new Map();
    this.defaultTtl = defaultTtl;
  }

  clear() {
    this.cache.clear();
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
  }

  /**
   * Retrieves a value from the cache or computes it using the provided function.
   *
   * If multiple calls to `get` occur with the same key while the initial computation
   * is still pending, they will all share the same cached promise and receive
   * the same result upon resolution.
   *
   * @param key - The cache key.
   * @param computeFunction - A function that computes the value. Receives a `setTtl` callback
   *                          to override the default time-to-live (TTL).
   * @returns The cached or computed value.
   */
  async get(
    key: string,
    computeFunction: ({
      setTtl,
    }: {
      setTtl: (ttl: number) => void;
    }) => Promise<T>,
  ) {
    const cachedPromise = this.cache.get(key);

    if (cachedPromise) {
      return cachedPromise;
    }

    let ttl = this.defaultTtl;

    const setTtl = (newTtl: number) => {
      ttl = newTtl;
    };

    const promise = computeFunction({ setTtl });
    this.cache.set(key, promise);

    promise
      .catch(_ => {
        this.cache.delete(key);
        this.timers.delete(key);
      })
      .then(() => {
        if (this.timers.has(key)) {
          clearTimeout(this.timers.get(key));
        }
        const timer = setTimeout(() => {
          this.cache.delete(key);
          this.timers.delete(key);
        }, ttl);
        this.timers.set(key, timer);
      });

    return promise;
  }
}
