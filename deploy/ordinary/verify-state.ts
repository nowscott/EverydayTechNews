import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Store } from './packages/ordinary-news/src/store.ts';
import { config, hash } from './packages/ordinary-news/src/core.ts';
const input=new DatabaseSync('/data/state.sqlite3',{readOnly:true});
const before={issues:input.prepare('SELECT * FROM issues ORDER BY id').all(),deliveries:input.prepare('SELECT * FROM deliveries ORDER BY id').all()};input.close();
let store=new Store('/data');
try {
  const c=config('/data');assert.ok(['shadow','production','paused'].includes(c.mode));
  assert.equal(hash(JSON.stringify(store.ledger())),hash(JSON.stringify(before)),'restore changed live-ledger copy');
  assert.equal(store.one("SELECT data FROM meta WHERE key='schema_version'")!.data,'1');
  store.close();store=new Store('/data');
  assert.equal(hash(JSON.stringify(store.ledger())),hash(JSON.stringify(before)),'second restore changed ledger');
  console.log(JSON.stringify({verified:true,schema:1,issues:before.issues.length,deliveries:before.deliveries.length}));
} finally {store.close();}
