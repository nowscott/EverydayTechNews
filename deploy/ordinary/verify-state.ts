import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Store, ledgerDigest } from './packages/ordinary-news/src/store.ts';
import { config } from './packages/ordinary-news/src/core.ts';
const input=new DatabaseSync('/data/state.sqlite3',{readOnly:true});
const before=ledgerDigest(input);input.close();
let store=new Store('/data');
try {
  const c=config('/data');assert.ok(['shadow','production','paused'].includes(c.mode));
  assert.equal(ledgerDigest(store.db),before,'restore changed live-ledger copy');
  assert.equal(store.one("SELECT data FROM meta WHERE key='schema_version'")!.data,'1');
  store.close();store=new Store('/data');
  assert.equal(ledgerDigest(store.db),before,'second restore changed ledger');
  console.log(JSON.stringify({verified:true,schema:1,issues:store.one('SELECT COUNT(*) n FROM issues')!.n,deliveries:store.one('SELECT COUNT(*) n FROM deliveries')!.n}));
} finally {store.close();}
