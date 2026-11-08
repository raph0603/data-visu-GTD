import { describe, expect, it } from 'vitest';
import { countriesPatch, filtersWithCountries, sharedCountryIds } from './shared-countries';

const country = (id: string) => ({ dim: 'country', id });

describe('sharedCountryIds', () => {
  it('reads the pinned countries, whatever else is pinned', () => {
    expect(sharedCountryIds({ pinned: [{ dim: 'group', id: 'ISIL' }, country('IRQ'), country('SYR')], filters: {} })).toEqual(['IRQ', 'SYR']);
  });

  it('falls back to a country filter only when nothing is pinned', () => {
    expect(sharedCountryIds({ pinned: [], filters: { country: ['FRA'] } })).toEqual(['FRA']);
    expect(sharedCountryIds({ pinned: [country('IRQ')], filters: { country: ['FRA'] } })).toEqual(['IRQ']);
  });
});

describe('filtersWithCountries', () => {
  it('replaces a country filter by the explored countries and keeps the other filters', () => {
    expect(filtersWithCountries({ pinned: [country('IRQ')], filters: { country: ['FRA'], suicide: ['1'] } })).toEqual({ suicide: ['1'], country: ['IRQ'] });
    expect(filtersWithCountries({ pinned: [], filters: { suicide: ['1'] } })).toEqual({ suicide: ['1'] });
  });
});

describe('countriesPatch', () => {
  it('pins the countries, focuses the last and keeps the other pinned entities', () => {
    const patch = countriesPatch({ pinned: [{ dim: 'group', id: 'ISIL' }, country('IRQ')], focus: null, filters: {} }, ['SYR', 'TUR']);
    expect(patch?.pinned).toEqual([{ dim: 'group', id: 'ISIL' }, country('SYR'), country('TUR')]);
    expect(patch?.focus).toEqual(country('TUR'));
  });

  it('clears the countries and a country focus, but not another focus', () => {
    expect(countriesPatch({ pinned: [country('IRQ')], focus: country('IRQ'), filters: {} }, [])).toEqual({ pinned: [], focus: null });
    expect(countriesPatch({ pinned: [country('IRQ')], focus: { dim: 'group', id: 'ISIL' }, filters: {} }, [])?.focus).toEqual({ dim: 'group', id: 'ISIL' });
  });

  it('is null when the countries are already the ones asked for', () => {
    expect(countriesPatch({ pinned: [country('IRQ')], focus: null, filters: {} }, ['IRQ'])).toBeNull();
    expect(countriesPatch({ pinned: [], focus: null, filters: {} }, [])).toBeNull();
  });
});
