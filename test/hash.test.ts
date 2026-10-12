import { describe, expect, it } from 'vitest';
import { bindHash, createHashCodec, type HashEnv } from '../src/core/hash';
import { defaultState, sanitizeState, type AppState } from '../src/core/state';
import { createStore } from '../src/core/store';
import { VIEW_IDS } from '../src/core/tasks';
import { fixtureMeta, rng } from './fixtures/meta';

const defaults = defaultState(fixtureMeta);
const codec = createHashCodec(defaults);

// Strings chosen to break naive encoders: separators of the hash grammar, percent signs, unicode, spaces.
const NASTY = ['NGA', 'a,b', 'x&y=z', '100%', 'sp ace', "Côte d'Ivoire", '日本', 'a:b', '#hash', '+plus', '%2C', 'Al-Qaida (AQ)'];

function randomState(next: () => number): AppState {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
  const year = () => 2000 + Math.floor(next() * 10);
  const range = () => {
    const a = year();
    const b = year();
    return { from: Math.min(a, b), to: Math.max(a, b) };
  };
  const dims = fixtureMeta.dimensions.map((d) => d.id);
  const ref = () => ({ dim: pick(dims), id: pick(NASTY) });
  const filters: Record<string, string[]> = {};
  for (const dim of dims) if (next() < 0.4) filters[dim] = Array.from({ length: 1 + Math.floor(next() * 3) }, () => pick(NASTY));
  const ext: Record<string, string> = {};
  if (next() < 0.5) ext['leaderboard.top'] = pick(NASTY);
  if (next() < 0.5) ext['map.mode'] = pick(NASTY);
  return sanitizeState(
    {
      view: pick(VIEW_IDS),
      metric: pick(fixtureMeta.metrics).id,
      range: range(),
      compare: next() < 0.5 ? range() : null,
      focus: next() < 0.5 ? ref() : null,
      pinned: Array.from({ length: Math.floor(next() * 4) }, ref),
      incident: next() < 0.4 ? pick(NASTY) : null,
      filters,
      hover: next() < 0.5 ? ref() : null,
      ext,
    },
    fixtureMeta,
  );
}

describe('hash codec', () => {
  it('encodes the default state to an empty string', () => {
    expect(codec.encode(defaults)).toBe('');
    expect(codec.decode('')).toEqual(defaults);
    expect(codec.decode('#')).toEqual(defaults);
  });

  it('round-trips 500 random states (hover is transient and dropped)', () => {
    const next = rng(42);
    for (let i = 0; i < 500; i++) {
      const state = randomState(next);
      const hash = codec.encode(state);
      expect(hash).not.toMatch(/[\s#]/);
      expect(sanitizeState(codec.decode(hash), fixtureMeta)).toEqual({ ...state, hover: null });
    }
  });

  it('produces a unique canonical form', () => {
    const next = rng(7);
    for (let i = 0; i < 200; i++) {
      const hash = codec.encode(randomState(next));
      expect(codec.encode(sanitizeState(codec.decode(hash), fixtureMeta))).toBe(hash);
    }
  });

  it('never writes hover', () => {
    const state = { ...defaults, hover: { dim: 'country', id: 'NGA' } };
    expect(codec.encode(state)).toBe('');
  });

  it('survives garbage without throwing and falls back to defaults', () => {
    const garbage = '#t=abc&m=%E0%A4%A&zzz&=&v=nope&p=country:A,bad&q.group=%E0&f=nodim&cmp=1-&x.%E0=1&i=%E0';
    expect(() => codec.decode(garbage)).not.toThrow();
    expect(codec.decode(garbage)).toEqual(defaults);
  });

  it('writes a readable URL', () => {
    const hash = codec.encode({ ...defaults, view: 'leaderboard', metric: 'killed', range: { from: 2001, to: 2005 }, focus: { dim: 'country', id: 'NGA' } });
    expect(hash).toBe('v=leaderboard&m=killed&t=2001-2005&f=country:NGA');
  });
});

function fakeEnv() {
  let hash = '';
  const listeners = new Set<() => void>();
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const writes: string[] = [];
  const env: HashEnv = {
    read: () => hash,
    write(h) {
      hash = h;
      writes.push(h);
    },
    onExternalChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    schedule(cb) {
      const id = nextId++;
      timers.set(id, cb);
      return () => timers.delete(id);
    },
  };
  return {
    env,
    writes,
    pending: () => timers.size,
    flush() {
      for (const [id, cb] of [...timers]) {
        timers.delete(id);
        cb();
      }
    },
    navigate(h: string) {
      hash = h;
      listeners.forEach((l) => l());
    },
    listenerCount: () => listeners.size,
  };
}

describe('bindHash', () => {
  function setup() {
    const store = createStore<AppState>(defaults, { sanitize: (s) => sanitizeState(s, fixtureMeta) });
    const fake = fakeEnv();
    const off = bindHash(store, codec, fake.env);
    return { store, fake, off };
  }

  it('debounces store → URL writes and keeps only the last one', () => {
    const { store, fake } = setup();
    store.set({ range: { from: 2001, to: 2002 } });
    store.set({ range: { from: 2001, to: 2006 } });
    expect(fake.writes).toEqual([]);
    fake.flush();
    expect(fake.writes).toEqual(['t=2001-2006']);
  });

  it('does not touch the URL for hover changes', () => {
    const { store, fake } = setup();
    store.set({ hover: { dim: 'country', id: 'NGA' } });
    expect(fake.pending()).toBe(0);
  });

  it('applies external navigation to the store without echoing it back', () => {
    const { store, fake } = setup();
    fake.navigate('v=flow&t=2001-2002');
    expect(store.get().view).toBe('flow');
    expect(store.get().range).toEqual({ from: 2001, to: 2002 });
    fake.flush();
    expect(fake.writes).toEqual(['v=flow&t=2001-2002']);
    fake.navigate('v=flow&t=2001-2002'); // hashchange for the hash we just wrote
    expect(fake.pending()).toBe(0);
    expect(fake.writes).toHaveLength(1);
  });

  it('releases every listener on unbind', () => {
    const { store, fake, off } = setup();
    off();
    expect(fake.listenerCount()).toBe(0);
    expect(store.subscriberCount()).toBe(0);
  });
});
