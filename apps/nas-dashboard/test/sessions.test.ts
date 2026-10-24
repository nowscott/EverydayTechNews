import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,statSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sessions,SESSION_SECONDS } from '../server/sessions.ts';
test('long sessions survive restart, expire, revoke durably, and invalidate on password change',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dashboard-auth-')),file=join(dir,'auth/sessions.json');
 try{
  const now=Date.now(),a=new Sessions('password-hash',file),token=a.issue(now);
  assert.equal(SESSION_SECONDS,180*24*3600);assert(a.valid(token,now+86400000));
  assert(!readFileSync(file,'utf8').includes(token));assert.equal(statSync(file).mode&0o777,0o600);
  const b=new Sessions('password-hash',file);assert(b.valid(token));assert(!b.valid(token,now+SESSION_SECONDS*1000));assert(!b.valid('forged'));
  assert(!new Sessions('different-password-hash',file).valid(token));
  b.revoke(token);assert(!new Sessions('password-hash',file).valid(token));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
