import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { Sessions, SESSION_SECONDS } from './sessions.ts';
import { fileURLToPath } from 'node:url';
import { Dashboard, type Config, type Component } from './data.ts';
import { usage } from './usage.ts';
import { PREVIEW_CSP } from './mail-preview.ts';
import { verifyPassword } from './security.ts';
const base = resolve(fileURLToPath(new URL('..',import.meta.url)));
export function createApp(config: Config, passwordHash: string, secure = false, sessionFile?: string) {
  if (!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash)) throw Error('valid_dashboard_password_hash_required');
  const dashboard = new Dashboard(config), sessions = new Sessions(passwordHash,sessionFile), attempts = new Map<string,{n:number;until:number}>();
  let globalAttempts = {n:0,until:0};
  const cookie = (value: string, age: number) => `dashboard_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`;
  const send = (res: ServerResponse, code: number, body: any) => { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body)); };
  const session = (req: IncomingMessage) => /(?:^|;\s*)dashboard_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie??'')?.[1] ?? '';
  return createServer(async (req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      const url=new URL(req.url??'/', 'http://dashboard.local'),path=url.pathname;
      if(path==='/api/health'&&req.method==='GET')return send(res,200,{status:'ok',version:'1.3.0'});
      if(path==='/api/login'&&req.method==='POST') {
        if(req.headers.origin && req.headers.origin !== `${secure?'https':'http'}://${req.headers.host}`)return send(res,403,{error:'origin_rejected'});
        const ip=req.socket.remoteAddress??'unknown',now=Date.now();
        for(const [key,v] of attempts)if(v.until<now)attempts.delete(key);
        const entry=attempts.get(ip)??{n:0,until:now+15*60000};
        if(globalAttempts.until<now)globalAttempts={n:0,until:now+15*60000};
        if(entry.n>=8||globalAttempts.n>=50||attempts.size>1000){res.setHeader('Retry-After','900');return send(res,429,{error:'login_rate_limited'});}
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return send(res,413,{error:'body_too_large'});}
        let password: unknown;try {password=JSON.parse(raw).password;}catch{return send(res,400,{error:'invalid_json'});}
        if(typeof password!=='string'||!verifyPassword(password,passwordHash)) {
          entry.n++;globalAttempts.n++;attempts.set(ip,entry);return send(res,401,{error:'invalid_password'});
        }
        attempts.delete(ip);const token=sessions.issue(now);
        res.setHeader('Set-Cookie',cookie(token,SESSION_SECONDS));return send(res,200,{authenticated:true});
      }
      if(path.startsWith('/api/')) {
        const token=session(req);if(!sessions.valid(token))return send(res,401,{error:'login_required'});
        if(path==='/api/logout'&&req.method==='POST') {
          if(req.headers.origin&&req.headers.origin!==`${secure?'https':'http'}://${req.headers.host}`)return send(res,403,{error:'origin_rejected'});
          sessions.revoke(token);res.setHeader('Set-Cookie',cookie('',0));return send(res,200,{authenticated:false});
        }
        if(req.method!=='GET')return send(res,405,{error:'read_only'});
        if(path==='/api/session')return send(res,200,{authenticated:true});
        if(path==='/api/overview')return send(res,200,{read_at:new Date().toISOString(),data:dashboard.overview()});
        const component=url.searchParams.get('component')??'premium';
        if(!['ordinary','premium'].includes(component))return send(res,400,{error:'invalid_component'});
        const c=component as Component;
        if(path==='/api/usage')return send(res,200,usage(dashboard,url.searchParams));
        if(path==='/api/home')return send(res,200,dashboard.home(c));
        const feature=/^\/api\/issues\/([A-Za-z0-9_-]{1,140})\/articles\/(\d{1,3})$/.exec(path);
        if(feature)return send(res,200,dashboard.feature(c,feature[1],Number(feature[2])));
        const preview=/^\/api\/issues\/([A-Za-z0-9_-]{1,140})\/preview$/.exec(path);
        if(preview){
          const value=dashboard.preview(c,preview[1],url.searchParams.get('receipt')??undefined).data;
          res.removeHeader('X-Frame-Options');res.setHeader('Content-Security-Policy',PREVIEW_CSP);
          res.writeHead(value.state==='available'?200:409,{'Content-Type':'text/html; charset=utf-8'});
          return res.end(value.html??'<!doctype html><meta charset="utf-8"><p>此版本未保存可验证的邮件版式，请查看纯文本。</p>');
        }
        const match=/^\/api\/(news|issues)(?:\/([a-f0-9]{64}|[A-Za-z0-9_-]{1,140}))?$/.exec(path);
        if(match)return send(res,200,match[1]==='news'?dashboard.news(c,url.searchParams,match[2]):dashboard.issues(c,url.searchParams,match[2]));
        if(path==='/api/runs')return send(res,200,dashboard.runs(c,url.searchParams));
        return send(res,404,{error:'not_found'});
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'method_not_allowed'});
      const dist=resolve(base,'dist'),name=path==='/'?'index.html':decodeURIComponent(path).slice(1),file=resolve(dist,name);
      if(!file.startsWith(dist+'/'))return send(res,404,{error:'not_found'});
      try {
        if(!statSync(file).isFile())return send(res,404,{error:'not_found'});
        const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
        res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'});res.end(req.method==='HEAD'?undefined:readFileSync(file));
      }catch{return send(res,404,{error:'not_found'});}
    }catch(e:any){const known=['invalid_usage_filter','invalid_date','invalid_page','date_range_maximum_31_days','not_found'].includes(e.message);send(res,e.message==='not_found'?404:known?400:503,{error:known?e.message:'data_unavailable'});}
  });
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=createApp({ordinary:process.env.DASHBOARD_ORDINARY_DATA??'/data/ordinary',premium:process.env.DASHBOARD_PREMIUM_DATA??'/data/premium',runtime:process.env.DASHBOARD_RUNTIME??'/data/runtime',ordinaryDeployment:process.env.DASHBOARD_ORDINARY_DEPLOYMENT,bodies:process.env.DASHBOARD_BODY_CACHE??'/data/bodies',premiumDeployment:process.env.DASHBOARD_PREMIUM_DEPLOYMENT},process.env.DASHBOARD_PASSWORD_HASH??'',process.env.DASHBOARD_SECURE_COOKIE==='true',process.env.DASHBOARD_SESSION_FILE);
  server.requestTimeout=10000;server.headersTimeout=10000;server.maxRequestsPerSocket=200;
  server.listen(Number(process.env.PORT??3080),process.env.DASHBOARD_HOST??'0.0.0.0',()=>console.log('NAS dashboard 1.3.0 listening'));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
