import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
export const SESSION_SECONDS=180*24*3600;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
/** Only token hashes are persisted, in dashboard-owned storage, never business data. */
export class Sessions {
 private entries=new Map<string,number>();
 private owner:string;
 private file?:string;
 constructor(passwordHash:string,file?:string){
  this.file=file;
  this.owner=digest(passwordHash);
  if(file){
   try{
    const saved=JSON.parse(readFileSync(file,'utf8'));
    if(saved.owner===this.owner&&Array.isArray(saved.entries))for(const [key,until] of saved.entries){
     if(typeof key==='string'&&/^[a-f0-9]{64}$/.test(key)&&typeof until==='number'&&until>Date.now())this.entries.set(key,until);
    }
   }catch(e:any){if(e.code!=='ENOENT')throw Error('session_storage_unreadable');}
  }
 }
 private save(){
  if(!this.file)return;
  mkdirSync(dirname(this.file),{recursive:true,mode:0o700});
  const temp=this.file+'.'+randomBytes(8).toString('hex')+'.tmp';
  writeFileSync(temp,JSON.stringify({owner:this.owner,entries:[...this.entries]}),{mode:0o600,flag:'wx'});
  renameSync(temp,this.file);chmodSync(this.file,0o600);
 }
 issue(now=Date.now()){
  for(const [key,until] of this.entries)if(until<=now)this.entries.delete(key);
  if(this.entries.size>=100)this.entries.delete(this.entries.keys().next().value!);
  const token=randomBytes(32).toString('hex');this.entries.set(digest(token),now+SESSION_SECONDS*1000);this.save();return token;
 }
 valid(token:string,now=Date.now()){return !!token&&(this.entries.get(digest(token))??0)>now;}
 revoke(token:string){this.entries.delete(digest(token));this.save();}
}
