import { DemoFactoryReel } from './demo-factory.reel.controller';
import { DemoRow, demoToRows, DSO } from './demo-factory.rows';

import type { DemoFactorySeedService } from './demo-factory.seed';
import type { DemoFactoryStore } from './demo-factory.store';
import type { RawDataFetchQueryParameters } from '@buildone/app-server-tslib/utils';

// The controller injects both by class; their modules pull in the database, which no test here needs.
jest.mock('./demo-factory.seed', () => ({ DemoFactorySeedService: class {} }));
jest.mock('./demo-factory.store', () => ({ DemoFactoryStore: class {} }));

const rows = [
  demoToRows({ schemaVersion: 1, id: 'pipeline', title: 'A Salesforce pipeline', settings: {}, scenes: [] }),
  demoToRows({ schemaVersion: 1, id: 'studio-tour', title: 'Studio tour', settings: {}, scenes: [] })
];

const controller = () => {
  const store = {
    read: async (name: string) => (name === DSO.demo ? rows.map((row) => row.demo as DemoRow) : [])
  } as unknown as DemoFactoryStore;
  const seed = { ensureReconciled: async () => undefined } as unknown as DemoFactorySeedService;
  return new DemoFactoryReel(store, seed);
};

/** The query the card view's search sends: the DSO's globalSearchFilter with the term filled in. */
const search = (term: string): RawDataFetchQueryParameters => ({
  queryInformation: JSON.stringify({
    fieldlist: '*',
    filters: {
      logic: 'and',
      filters: [
        {
          logic: 'or',
          filters: [
            { field: 'title', operator: 'contains', value: term },
            { field: 'id', operator: 'contains', value: term }
          ]
        }
      ]
    }
  }),
  filter: JSON.stringify({ top: 50, skip: 0 })
});

describe('DemoFactoryReel (the overview data source)', () => {
  it('returns every demo without a query', async () => {
    expect(
      (await controller().fetch(undefined as unknown as RawDataFetchQueryParameters)).map((demo) => demo.id)
    ).toEqual(['pipeline', 'studio-tour']);
  });

  it('applies the search the card view sends, case-insensitively', async () => {
    expect((await controller().fetch(search('salesFORCE'))).map((demo) => demo.id)).toEqual(['pipeline']);
    expect((await controller().fetch(search('tour'))).map((demo) => demo.id)).toEqual(['studio-tour']);
  });
});
