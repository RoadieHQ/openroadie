/*
 * Copyright 2024 The Backstage Authors
 * Modifications copyright 2024 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Derived from Backstage (https://github.com/backstage/backstage),
 * packages/types/src/deferred.ts at v1.47.1, and modified.
 */

/**
 * A deferred promise that can be resolved or rejected later.
 */
export type DeferredPromise<
  TResolved = void,
  TRejected = Error,
> = Promise<TResolved> & {
  resolve(value: TResolved | PromiseLike<TResolved>): void;
  reject(reason?: TRejected): void;
};

class Deferred<TResolved = void, TRejected = Error> implements DeferredPromise<
  TResolved,
  TRejected
> {
  #resolve!: (value: TResolved | PromiseLike<TResolved>) => void;
  #reject!: (reason?: TRejected) => void;

  get resolve() {
    return this.#resolve;
  }

  get reject() {
    return this.#reject;
  }

  then!: Promise<TResolved>['then'];
  catch!: Promise<TResolved>['catch'];
  finally!: Promise<TResolved>['finally'];

  constructor() {
    const promise = new Promise<TResolved>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
    this.then = promise.then.bind(promise);
    this.catch = promise.catch.bind(promise);
    this.finally = promise.finally.bind(promise);
  }

  [Symbol.toStringTag] = 'DeferredPromise';
}

/**
 * Creates a deferred promise that can be resolved or rejected later.
 */
export function createDeferred<
  TResolved = void,
  TRejected = Error,
>(): DeferredPromise<TResolved, TRejected> {
  return new Deferred<TResolved, TRejected>();
}
