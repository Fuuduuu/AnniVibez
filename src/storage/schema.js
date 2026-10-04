export const DB_NAME = 'majandus_local_v1';
export const DB_VERSION = 2;

export const STORE_NAMES = [
  'meta',
  'auth',
  'householdProfile',
  'calendarEvents',
  'sharedPlaces',
  'wasteState',
  'outbox',
  'syncState',
  'conflicts',
  'shoppingItems',
];

const STORE_KEY_PATHS = {
  meta: 'key',
  auth: 'key',
  householdProfile: 'key',
  calendarEvents: 'id',
  sharedPlaces: 'id',
  wasteState: 'key',
  outbox: 'mutationId',
  syncState: 'key',
  conflicts: 'id',
  shoppingItems: 'id',
};

export function upgradeSchema(db, oldVersion, transaction) {
  if (oldVersion < 1) {
    for (const name of STORE_NAMES) {
      if (name === 'shoppingItems') continue;
      const store = db.createObjectStore(name, { keyPath: STORE_KEY_PATHS[name] });
      if (name === 'outbox') store.createIndex('bySequence', 'sequence', { unique: true });
    }
  }
  if (oldVersion < 2) {
    db.createObjectStore('shoppingItems', { keyPath: STORE_KEY_PATHS.shoppingItems });
  }
}
