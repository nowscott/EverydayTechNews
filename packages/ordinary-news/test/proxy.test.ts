import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import type {AddressInfo} from 'node:net';

test('Node fetch uses an authenticated proxy from its private environment',async()=>{
 const server=http.createServer();let authenticated=false;
 server.on('connect',(request,socket)=>{
  authenticated=request.headers['proxy-authorization']==='Basic '+Buffer.from('test-user:test-pass').toString('base64');
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  socket.on('data',()=>socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok'));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.toLowerCase().includes('proxy')));
  env.HTTP_PROXY=`http://test-user:test-pass@127.0.0.1:${(server.address() as AddressInfo).port}`;
  env.NODE_USE_ENV_PROXY='1';
  const child=spawn(process.execPath,['--input-type=module','-e',
   'fetch("http://example.test/",{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(2))'],{env,stdio:'ignore'});
  const code=await new Promise<number|null>(resolve=>child.once('exit',resolve));
  assert.equal(code,0);assert.equal(authenticated,true);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
