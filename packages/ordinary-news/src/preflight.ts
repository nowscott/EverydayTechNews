// Live connectivity verification only: no sendMail, newsletter freezing or Notion writes.
import { subscribers } from './subscribers.ts';
import { createMailTransport } from './delivery.ts';
import { createSubscriptionToken } from '../../news-common/src/tokens.ts';
import { hash } from './core.ts';
const users=await subscribers();
const base=String(process.env.APP_BASE_URL??'').replace(/\/+$/,'');
if(base!=='https://mailist.nowscott.top'||!process.env.SUBSCRIPTION_CONFIRMATION_SECRET)throw new Error('ordinary_subscription_site_configuration_invalid');
const {token}=createSubscriptionToken('parity-probe@example.invalid','unsubscribe',process.env.SUBSCRIPTION_CONFIRMATION_SECRET,new Date(Date.now()-120000),60);
const response=await fetch(base+'/api/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),signal:AbortSignal.timeout(30000)});
const body=await response.json() as {status?:string};
if(response.status!==400||body.status!=='expired')throw new Error('ordinary_subscription_signature_mismatch');
const transport=createMailTransport(process.env,()=>{throw new Error('smtp_data_forbidden_in_preflight');});
try {await transport.verify();}finally{transport.close();}
console.log(JSON.stringify({status:'passed',notion_eligible:users.length,recipient_set_sha256:hash(users.map(u=>u.email.toLowerCase()).sort().join('\n')),
  subscription_signature:'matched_with_expired_token',smtp:'authentication_only',model_calls:0,messages_sent:0,notion_writes:0}));
