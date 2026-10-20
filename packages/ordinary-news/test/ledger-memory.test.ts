import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store,ledgerDigest} from '../src/store.ts';
test('large persisted ledger verifies under a 64MB JS heap and detects mutation',()=>{
 const root=mkdtempSync(tmpdir()+'/ordinary-ledger-memory-');let store=new Store(root);
 try{
  store.db.exec('PRAGMA synchronous=OFF');const payload='x'.repeat(50000);
  store.tx(()=>{for(let i=0;i<1000;i++)store.run('INSERT INTO deliveries VALUES (?,?,?,?,?,?)','row-'+i,'issue','user'+i+'@example.test','smtp_accepted',1,payload);});
  const before=ledgerDigest(store.db);store.close();
  const module=fileURLToPath(new URL('../src/store.ts',import.meta.url));
  const code=`import {Store,ledgerDigest} from ${JSON.stringify(module)};const s=new Store(process.argv[1]);console.log(ledgerDigest(s.db));s.close();`;
  const r=spawnSync(process.execPath,['--max-old-space-size=64','--input-type=module','-e',code,root],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),before);
  store=new Store(root);store.run("UPDATE deliveries SET status='unknown_do_not_retry' WHERE id='row-0'");assert.notEqual(ledgerDigest(store.db),before);
 }finally{try{store.close();}catch{}rmSync(root,{recursive:true,force:true});}
});
