import { deepEqual, deepFreeze } from './equal';

export type Unsubscribe = () => void;

export interface SubscribeOptions<T> {
  /** Defaults to Object.is. Works on state slices because unchanged slices keep their identity. */
  readonly equals?: (a: T, b: T) => boolean;
  /** Call the listener once with the current value (prev === value). */
  readonly fireImmediately?: boolean;
}

export interface Store<S extends object> {
  get(): S;
  /** Shallow-merges a patch (or the result of an updater) into the state, then notifies. */
  set(patch: Partial<S> | ((state: S) => Partial<S>)): void;
  subscribe<T>(selector: (state: S) => T, listener: (value: T, prev: T) => void, options?: SubscribeOptions<T>): Unsubscribe;
  /** Diagnostic: number of live subscriptions (leak detection in tests). */
  subscriberCount(): number;
}

export interface StoreOptions<S> {
  /** Canonicalizes every candidate state before commit (invariants, clamping). */
  readonly sanitize?: (next: S, prev: S) => S;
  /** A listener that throws must not break the others; receives the error. Defaults to console.error. */
  readonly onError?: (error: unknown) => void;
  /** Upper bound of notification rounds triggered by one set() (cycle guard). */
  readonly maxCascade?: number;
}

interface Subscription<S> {
  run(state: S): void;
}

/**
 * Minimal typed observable store.
 * - Immutable, deep-frozen snapshots: a module mutating state throws instead of corrupting the others.
 * - Structural sharing: a key whose new value is deeply equal to the old one keeps the old reference,
 *   so `subscribe(s => s.range, ...)` fires only when the range really changed.
 * - Synchronous notification, re-entrant: a listener may call set(); listeners are re-run until the
 *   state is stable, and a ping-pong between modules throws after `maxCascade` rounds.
 */
export function createStore<S extends object>(initial: S, options: StoreOptions<S> = {}): Store<S> {
  const sanitize = options.sanitize ?? ((next: S) => next);
  const onError = options.onError ?? ((error: unknown) => console.error(error));
  const maxCascade = options.maxCascade ?? 32;

  let state = deepFreeze(sanitize(initial, initial));
  const subscriptions = new Set<Subscription<S>>();
  let flushing = false;
  let dirty = false;

  function commit(patch: Partial<S>): boolean {
    const merged = { ...state, ...patch } as S;
    const clean = sanitize(merged, state);
    const next = { ...state } as Record<string, unknown>;
    let changed = false;
    for (const key of Object.keys(clean)) {
      const value = (clean as Record<string, unknown>)[key];
      if (!deepEqual((state as Record<string, unknown>)[key], value)) {
        next[key] = value;
        changed = true;
      }
    }
    if (!changed) return false;
    state = deepFreeze(next as S);
    return true;
  }

  function flush(): void {
    if (flushing) {
      dirty = true;
      return;
    }
    flushing = true;
    try {
      let rounds = 0;
      do {
        dirty = false;
        rounds += 1;
        if (rounds > maxCascade) {
          throw new Error(`store: plus de ${maxCascade} cycles de notification (écoute circulaire entre modules ?)`);
        }
        for (const subscription of [...subscriptions]) {
          try {
            subscription.run(state);
          } catch (error) {
            onError(error);
          }
        }
      } while (dirty);
    } finally {
      flushing = false;
      dirty = false;
    }
  }

  return {
    get: () => state,
    set(patch) {
      const resolved = typeof patch === 'function' ? patch(state) : patch;
      if (commit(resolved)) flush();
    },
    subscribe<T>(selector: (s: S) => T, listener: (value: T, prev: T) => void, opts: SubscribeOptions<T> = {}): Unsubscribe {
      const equals = opts.equals ?? Object.is;
      let last = selector(state);
      const subscription: Subscription<S> = {
        run(current) {
          const value = selector(current);
          if (equals(value, last)) return;
          const prev = last;
          last = value;
          listener(value, prev);
        },
      };
      subscriptions.add(subscription);
      if (opts.fireImmediately) listener(last, last);
      return () => {
        subscriptions.delete(subscription);
      };
    },
    subscriberCount: () => subscriptions.size,
  };
}
