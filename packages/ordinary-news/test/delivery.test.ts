import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import net from 'node:net';
import {Store} from '../src/store.ts';
import {atomic,atomicText,config,hash,read} from '../src/core.ts';
import {compose,deliver,recover,createMailTransport} from '../src/delivery.ts';
import {report,shadowGate} from '../src/runtime.ts';
const time='2026-10-21T06:30:00+08:00';
const env={SENDING_ACCOUNT:'sender@example.test',SENDING_PASSWORD:'test-only',SERVER:'smtp.example.test',APP_BASE_URL:'https://example.test',SUBSCRIPTION_CONFIRMATION_SECRET:'test-only-secret',ORDINARY_PRODUCTION_ENABLED:'true'};
const users=(n=1)=>Array.from({length:n},(_,i)=>({email:`user${i}@example.test`,name:'订阅者'+i,page_id:'page-'+i,status_name:'状态',status_type:'select',premium:false}));
function setup(mode='shadow'){
 const root=mkdtempSync(tmpdir()+'/ordinary-delivery-');const store=new Store(root);const c={...config(root),mode,shadow_started_on:'2026-10-21',first_production_date:mode==='production'?'2026-10-21':null};
 if(mode==='production')atomic(root+'/cutover.json',{legacy_workflows_disabled:true,legacy_guard_enabled:true,shadow_gate_passed:true,first_production_date:'2026-10-21'});atomic(root+'/config.json',c);
 atomicText(root+'/news_archive/2026-10/20.md','# 今日新闻 - 2026年10月20日(sorted)\n- [重要科技新闻一条完整标题](https://www.ithome.com/1/015/001.htm)\n');
 const issue=compose(store,new Date(time));return {store,root,issue,close:()=>{store.close();rmSync(root,{recursive:true,force:true});}};
}
test('100-recipient queue has durable claims, reuses one transport and remains idempotent',async()=>{
 const {store,issue,close}=setup('production');let calls=0,closed=0,reads=0;let clock=new Date(time);
 try{
  const transport={sendMail:async(m:any)=>{calls++;assert.equal(store.one('SELECT status FROM deliveries WHERE email=?',m.to)!.status,'sending');assert.deepEqual(m.envelope.to,[m.to]);clock=new Date(clock.getTime()+1000);return {accepted:[m.to]};},close:()=>closed++};
  const deps={now:()=>clock,env,getSubscribers:async()=>{reads++;return users(100);},transport};
  await deliver(store,issue,deps);assert.equal(calls,100);assert.equal(closed,1);
  const original=store.meta('delivery:'+issue.id).finished_at;
  await deliver(store,issue,deps);assert.equal(calls,100);assert.equal(reads,1);assert.equal(store.meta('delivery:'+issue.id).finished_at,original);
  const summary=report(store,clock);assert.equal(summary.delivery.outcome,'smtp_accepted');assert.equal(summary.delivery.expected,100);assert.equal(summary.delivery.completed,true);
 }finally{close();}
});
test('shadow is owner-only, production is separately gated, frozen content cannot change',async()=>{
 const {store,issue,root,close}=setup();let sent=0;
 try{const deps={now:()=>new Date(time),env,getSubscribers:async()=>users(100),transport:{sendMail:async(m:any)=>{sent++;assert.equal(m.to,'nowscott@qq.com');assert.match(m.subject,/普通版TS测试/);return {accepted:[m.to]};},close:()=>{}}};
  await assert.rejects(deliver(store,{...issue,body:'changed'},deps),/frozen_issue_changed/);
  await deliver(store,issue,deps);assert.equal(sent,1);assert.equal(store.all('SELECT * FROM outbox').length,0);
  atomic(root+'/config.json',{...config(root),mode:'production',first_production_date:'2026-10-21'});assert.throws(()=>config(root),/cutover_proof_required/);
 }finally{close();}
});
test('DATA uncertainty and interrupted sending are held; explicit pre-DATA failure retries at most three',async()=>{
 for(const failure of ['DATA','CONN','RCPT TO']){
  const {store,issue,close}=setup();let sends=0;let clock=new Date(time);
  try{const deps={now:()=>clock,env,getSubscribers:async()=>users(),transport:{sendMail:async()=>{sends++;throw Object.assign(new Error('test failure'),{command:failure,responseCode:failure==='RCPT TO'?550:undefined});},close:()=>{}}};
   for(let i=0;i<5;i++){await deliver(store,issue,deps);clock=new Date(clock.getTime()+4*60000);}
   assert.equal(sends,failure==='CONN'?3:1);assert.equal(store.all('SELECT * FROM outbox').length,0);
   if(failure==='DATA')assert.equal(store.all('SELECT status FROM deliveries')[0].status,'unknown_do_not_retry');
  }finally{close();}
 }
 const {store,issue,close}=setup();
 try{store.run('INSERT INTO deliveries VALUES (?,?,?,?,?,?)','interrupted',issue.id,'x@example.test','sending',1,JSON.stringify({status:'sending'}));recover(store);assert.equal(store.one('SELECT status FROM deliveries WHERE id=?','interrupted')!.status,'unknown_do_not_retry');}finally{close();}
});
test('subscription changes before resume exclude removed users and sending stops at 09:00',async()=>{
 const {store,issue,close}=setup('production');let clock=new Date(time),calls=0;
 try{const transport={sendMail:async(m:any)=>{calls++;throw Object.assign(new Error('offline'),{command:'CONN'});},close:()=>{}};
  await deliver(store,issue,{now:()=>clock,env,getSubscribers:async()=>users(2),transport});
  clock=new Date('2026-10-21T08:59:59+08:00');
  await deliver(store,issue,{now:()=>clock,env,getSubscribers:async()=>users(1),transport:{sendMail:async(m:any)=>{calls++;clock=new Date('2026-10-21T09:00:00+08:00');return {accepted:[m.to]};},close:()=>{}}});
  assert.equal(calls,2);assert.equal(store.one('SELECT status FROM deliveries WHERE email=?','user1@example.test')!.status,'subscription_no_longer_eligible');
  assert.equal((await deliver(store,issue,{now:()=>clock,env,getSubscribers:async()=>{throw Error('should not read');},transport})).status,'outside_delivery_window');
 }finally{close();}
});
test('a batch-wide SMTP connection failure leaves later recipients pending for recovery',async()=>{
 const {store,issue,close}=setup('production');let clock=new Date(time),calls=0;
 try{
  const deps={now:()=>clock,env,getSubscribers:async()=>users(3),transport:{sendMail:async()=>{calls++;throw Object.assign(new Error('offline'),{command:'CONN',responseCode:421,response:'421 temporary failure'});},close:()=>{}}};
  await deliver(store,issue,deps);
  assert.equal(calls,1);
  assert.deepEqual(store.all('SELECT status FROM deliveries ORDER BY email').map(r=>r.status),['retryable_before_data','pending','pending']);
  const receipt=JSON.parse(store.one('SELECT data FROM deliveries WHERE email=?','user0@example.test')!.data);
  assert.equal(receipt.smtp_error_command,'CONN');assert.equal(receipt.smtp_response_code,421);assert.equal(receipt.smtp_response,'421 temporary failure');
  clock=new Date(clock.getTime()+2*60000);
  await deliver(store,issue,{...deps,transport:{sendMail:async(m:any)=>({accepted:[m.to]}),close:()=>{}}});
  assert.equal(report(store,clock).delivery.completed,true);
 }finally{close();}
});
test('Notion failure blocks all SMTP; persistence failure after SMTP acceptance never replays',async()=>{
 const {store,issue,close}=setup();let sends=0;
 try{
  const deps={now:()=>new Date(time),env,getSubscribers:async()=>{throw new Error('notion_http_503');},transport:{sendMail:async()=>{sends++;},close:()=>{}}};
  await assert.rejects(deliver(store,issue,deps),/notion/);assert.equal(sends,0);
  const original=store.run.bind(store);const transport={sendMail:async(m:any)=>{sends++;store.run=((sql:string,...args:any[])=>{if(sql.startsWith('UPDATE deliveries'))throw new Error('disk failure');return original(sql,...args);}) as typeof store.run;return {accepted:[m.to]};},close:()=>{}};
  await assert.rejects(deliver(store,issue,{...deps,getSubscribers:async()=>users(),transport}),/disk failure/);
  store.run=original;recover(store);await deliver(store,issue,{...deps,getSubscribers:async()=>users()});assert.equal(sends,1);
 }finally{close();}
});
test('real pooled SMTP disconnect after DATA causes one transaction and no library requeue',async()=>{
 const {store,issue,close}=setup();let transactions=0;const sockets=new Set<net.Socket>();
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.write('220 test ESMTP\r\n');let buffer='',inData=false;
  socket.on('data',data=>{buffer+=data.toString();let index:number;while((index=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+2);
   if(inData){if(line==='.'){transactions++;socket.destroy();}continue;}
   if(/^EHLO/.test(line))socket.write('250-test\r\n250 SIZE 1000000\r\n');
   else if(/^MAIL FROM|^RCPT TO/.test(line))socket.write('250 OK\r\n');
   else if(line==='DATA'){inData=true;socket.write('354 send data\r\n');}
   else if(line==='QUIT'){socket.end('221 bye\r\n');}
   else socket.write('250 OK\r\n');
  }});
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as net.AddressInfo).port;
 try{const deps={now:()=>new Date(time),env,getSubscribers:async()=>users(),createTransport:(onData:()=>void)=>createMailTransport(env,onData,{host:'127.0.0.1',port,secure:false,ignoreTLS:true,auth:undefined,socketTimeout:1000})};
  await deliver(store,issue,deps);await deliver(store,issue,deps);assert.equal(transactions,1);
  const r=store.all('SELECT status,data FROM deliveries')[0];assert.equal(r.status,'unknown_do_not_retry');assert.equal(JSON.parse(r.data).smtp_data_started,true);
 }finally{for(const s of sockets)s.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));close();}
});
test('three consecutive actual shadow days plus inbox confirmation gate cutover',()=>{
 const {store,root,close}=setup();
 try{for(const date of ['2026-10-21','2026-10-22','2026-10-23'])atomic(root+'/reports/'+date+'.json',{date,mode:'shadow',delivery:{completed:true,outcome:'smtp_accepted',delay_seconds:20,finished_at:date+'T06:32:00+08:00'},content:{count:25},grading:{valid:25,failed:0,total:25},parity:{status:'passed'}});
  assert.equal(shadowGate(root,'2026-10-23').reason,'shadow_inbox_confirmation_required');
  atomic(root+'/feedback/2026-10-22.json',{status:'received_confirmed'});assert.equal(shadowGate(root,'2026-10-23').passed,true);
  const noVotes=read(root+'/reports/2026-10-22.json');noVotes.grading.valid=0;atomic(root+'/reports/2026-10-22.json',noVotes);assert.equal(shadowGate(root,'2026-10-23').reason,'shadow_grading_has_no_valid_votes');noVotes.grading.valid=25;atomic(root+'/reports/2026-10-22.json',noVotes);
  const changed=read(root+'/reports/2026-10-22.json');changed.delivery.outcome='delivery_unknown';atomic(root+'/reports/2026-10-22.json',changed);assert.equal(shadowGate(root,'2026-10-23').passed,false);
 }finally{close();}
});

test('real SMTP pool rotates connections before the server closes a ten-message session',async()=>{
 const {store,issue,close}=setup('production');let messages=0,connections=0;const sockets=new Set<net.Socket>();
 const server=net.createServer(socket=>{connections++;sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.write('220 test ESMTP\r\n');let buffer='',inData=false,sessionMessages=0;
  socket.on('data',data=>{buffer+=data.toString();let index:number;while((index=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+2);
   if(inData){if(line==='.'){messages++;sessionMessages++;inData=false;socket.write('250 accepted\r\n');}continue;}
   if(/^EHLO/.test(line))socket.write('250-test\r\n250 SIZE 1000000\r\n');
   else if(/^MAIL FROM/.test(line)&&sessionMessages>=10)socket.end('421 session limit\r\n');
   else if(/^MAIL FROM|^RCPT TO|^RSET/.test(line))socket.write('250 OK\r\n');
   else if(line==='DATA'){inData=true;socket.write('354 send data\r\n');}
   else if(line==='QUIT')socket.end('221 bye\r\n');else socket.write('250 OK\r\n');
  }});
 });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as net.AddressInfo).port;
 try{await deliver(store,issue,{now:()=>new Date(time),env,getSubscribers:async()=>users(100),createTransport:onData=>createMailTransport(env,onData,{host:'127.0.0.1',port,secure:false,ignoreTLS:true,auth:undefined})});
  assert.equal(messages,100);assert.equal(connections,10);assert.equal(store.one("SELECT COUNT(*) n FROM deliveries WHERE status='smtp_accepted'")!.n,100);
 }finally{for(const s of sockets)s.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));close();}
});
