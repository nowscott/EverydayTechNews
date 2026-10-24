import { useEffect, useState } from 'react';
type Row = Record<string, any>;
const stages: Record<string,string> = {generation:'改写',review:'内容审核',edition_review:'整刊审核',unknown:'未知环节'};
const states: Record<string,string> = {response_received:'已收到响应',invalid_response:'响应校验失败',reserved:'费用已预留',not_sent:'未发出请求',transport_usage_unknown:'传输异常 · 用量未知',http_error_usage_unknown:'HTTP 异常 · 用量未知',unknown:'状态未知'};
const day = () => new Date(Date.now()+28800000).toISOString().slice(0,10);
const number = (v:any) => v == null ? '未知' : Number(v).toLocaleString('zh-CN');
const money = (v:any) => v == null ? '未知' : '¥'+Number(v).toFixed(6);
const time = (v:any) => v ? new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(v)) : '精确时间未记录';
export function Usage({revision,onRead,onError,onAuth,onOpen}:{revision:number;onRead:(v:string)=>void;onError:(v:string)=>void;onAuth:(v:boolean)=>void;onOpen:(link:Row)=>void}) {
  const [from,setFrom]=useState(day),[to,setTo]=useState(day),[stage,setStage]=useState(''),[status,setStatus]=useState(''),[q,setQ]=useState(''),[page,setPage]=useState(1),[entry,setEntry]=useState<Row|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    const timer=setTimeout(()=>{
      fetch('/api/usage?'+new URLSearchParams({from,to,stage,status,q,page:String(page)}),{signal:controller.signal}).then(async r=>{
        const value=await r.json();if(!r.ok)throw Object.assign(Error(value.error),{status:r.status});return value;
      }).then(value=>{if(controller.signal.aborted)return;setEntry(value);onRead(value.read_at);onError('');}).catch(e=>{
        if(controller.signal.aborted)return;
        if(e.status===401){onAuth(false);return;}
        setError(e.status===400?'请选择有效日期（最多 31 天）和筛选条件。':'读取失败，请刷新重试。');setEntry(null);
      }).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    },200);
    return()=>{clearTimeout(timer);controller.abort();};
  },[from,to,stage,status,q,page,revision,onRead,onError,onAuth]);
  const change=(setter:(v:string)=>void,value:string)=>{setter(value);setPage(1);setEntry(null);};
  function preset(kind:string){const today=day();setFrom(kind==='week'?new Date(Date.parse(today+'T00:00:00Z')-6*86400000).toISOString().slice(0,10):kind==='month'?today.slice(0,8)+'01':today);setTo(today);setPage(1);setEntry(null);}
  const data=entry?.data,s=data?.summary,available=data?.available;
  const metrics=s?[
    ['输入 Token',number(s.input),s.missing_input?`${s.missing_input} 次输入未知`:'已记录用量'],
    ['输出 Token',number(s.output),s.missing_output?`${s.missing_output} 次输出未知`:'已记录用量'],
    ['总 Token',number(s.total),s.missing_usage?`已知部分 · ${s.missing_usage} 次用量不完整`:'输入 + 输出'],
    ['缓存命中率',s.cache_rate==null?'未知':(s.cache_rate*100).toFixed(1)+'%',`${number(s.cache_hit)} Token 命中 · ${s.missing_cache} 次缓存数据未知`],
    ['调用次数',number(s.calls),'包含失败及未发出记录'],
    ['估算费用',money(s.estimated_cny),`${s.unknown_cost_calls} 次费用未知 · 非账单实付`],
    ['待确认费用预留',money(s.unknown_reserved_cny),'仅计费用未知的调用'],
    ['重复调用',number(s.repeat_calls),`${money(s.repeat_estimated_cny)} 已知费用 · ${s.repeat_unknown_cost_calls} 次费用未知`]
  ]:[];
  return <div className="usage-page">
    <div className="usage-presets" aria-label="日期快捷选择"><button onClick={()=>preset('today')}>今日</button><button onClick={()=>preset('week')}>近 7 天</button><button onClick={()=>preset('month')}>本月</button><span>高级版 · 普通版当前不调用 AI</span></div>
    <div className="filters usage-filters"><label>开始日期<input type="date" value={from} onChange={e=>change(setFrom,e.target.value)}/></label><label>结束日期<input type="date" value={to} onChange={e=>change(setTo,e.target.value)}/></label><label>处理环节<select value={stage} onChange={e=>change(setStage,e.target.value)}><option value="">全部环节</option>{Object.entries(stages).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>调用状态<select value={status} onChange={e=>change(setStatus,e.target.value)}><option value="">全部状态</option>{[...new Set([...(data?.statuses??[]),...(status?[status]:[])])].map((v:string)=><option key={v} value={v}>{states[v]??v}</option>)}</select></label><label className="search">关联标题<input value={q} maxLength={200} placeholder="搜索新闻或整刊任务…" onChange={e=>change(setQ,e.target.value)}/></label></div>
    <p className="basis">按上海时间的调用账本日期统计，最多 31 天。汇总与图表覆盖全部筛选结果，分页只影响明细。</p>
    {error&&<p className="alert" role="alert">{error}</p>}
    {loading&&<p className="muted" role="status">正在读取用量…</p>}
    {entry&&<details className="evidence"><summary>数据来源与更新时间 · {time(entry.read_at)} · {entry.read_state==='ok'?'读取正常':'来源读取异常'}</summary><ul>{entry.evidence.map((v:Row,i:number)=><li key={i}>{v.source} · {v.state} · {time(v.source_time)}</li>)}</ul></details>}
    {entry&&!available&&<div className="alert" role="alert">调用账本无法完整读取，暂不展示统计。请检查数据来源后刷新。</div>}
    {available&&s&&<>
      <div className="usage-metrics">{metrics.map(([title,value,note])=><section className="usage-metric" key={title}><span>{title}</span><strong>{value}</strong><small>{note}</small></section>)}</div>
      <div className="usage-charts"><section className="table-card"><div className="section-title"><h2>每日消耗</h2><span>已知用量与估算费用</span></div><div className="usage-trend" aria-label="每日 Token 与费用趋势">{data.daily.map((v:Row)=>{
        const maxTotal=Math.max(1,...data.daily.map((d:Row)=>d.total)),maxCost=Math.max(.000001,...data.daily.map((d:Row)=>d.estimated_cny));
        return <div className="usage-day" key={v.day}><strong>{v.day.slice(5)}</strong><div><div className="usage-track"><span style={{width:(v.total/maxTotal*100)+'%'}}/></div><small>{number(v.total)} Token{v.missing_usage>0?' · 部分未知':''}</small><div className="usage-track cost"><span style={{width:(v.estimated_cny/maxCost*100)+'%'}}/></div><small>{money(v.estimated_cny)}{v.unknown_cost_calls>0?' · 部分未知':''}</small></div></div>;
      })}</div><p className="basis">蓝色为 Token，绿色为费用，各自按本区间最高值缩放。</p></section>
      <section className="table-card"><div className="section-title"><h2>消耗去向</h2><span>按处理环节</span></div>{data.stages.map((v:Row)=><div className="usage-stage" key={v.stage}><div><strong>{stages[v.stage]}</strong><span>{v.calls} 次调用</span></div><p>{number(v.total)} Token · {money(v.estimated_cny)}</p><small>{v.missing_usage} 次用量不完整 · {v.unknown_cost_calls} 次费用未知</small></div>)}<p className="basis">重复调用：同一任务首条记录之后的调用。首次记录按完整历史判断，不受日期或筛选影响。{s.repeat_unclassified_calls>0&&`${s.repeat_unclassified_calls} 次缺少任务标识，无法判断。`}</p></section></div>
      <section className="table-card"><div className="section-title"><h2>调用明细</h2><span>共 {data.total} 条</span></div><div className="table-scroll"><table className="usage-table"><thead><tr>{['关联内容 / 环节','调用时间（上海）','状态 / 原因','输入 / 输出 Token','缓存命中 Token','估算费用 / 耗时'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{data.items.map((v:Row)=><tr key={v.id}><td>{v.links.length?v.links.map((link:Row)=><button key={link.id} className="title-link" onClick={()=>onOpen(link)}>{link.kind==='issues'?link.id:v.title}</button>):v.title}<small>#{v.id} · {stages[v.stage]}{v.repeated?' · 重复调用':''}</small></td><td>{v.started_at?time(v.started_at):v.day}<small>{v.started_at?(v.finished_at?'结束 '+time(v.finished_at):'结束时间未记录'):'精确时间未记录'}</small></td><td>{states[v.status]??v.status}<small>{v.error_code??(['response_received','not_sent'].includes(v.status)?'—':'失败原因未记录')}</small></td><td>{number(v.input)} / {number(v.output)}<small>合计 {number(v.total)}</small></td><td>{number(v.cache_hit)}</td><td>{money(v.cost)}<small>{v.cost==null?'预留 '+money(v.reserved)+' · ':''}{v.seconds==null?'耗时未知':v.seconds.toFixed(2)+' 秒'}</small></td></tr>)}</tbody></table></div>{data.total===0&&<p className="empty">此区间和筛选条件下暂无调用记录。</p>}<div className="pager"><span>第 {page} / {Math.max(1,Math.ceil(data.total/30))} 页</span><button disabled={loading||page<=1} onClick={()=>setPage(page-1)}>上一页</button><button disabled={loading||page*30>=data.total} onClick={()=>setPage(page+1)}>下一页</button></div></section>
    </>}
    <section className="note"><strong>统计口径</strong><p>缓存命中属于输入 Token，不重复累加；命中率仅使用输入量与缓存量均有效的记录。缺失数据标为未知，汇总只累加已知部分。历史费用沿用账本估算，不按当前价格重算，也不代表实际扣款。</p></section>
  </div>;
}
