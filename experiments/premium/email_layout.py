"""Original email layout inspired by the scan-first structure of daily briefings.
No copied AppSo logos, images or article text. Inline styles, tables, no scripts.
"""
from collections import OrderedDict
from datetime import datetime
from html import escape as e

LAYOUT_VERSION = 'morning-3-pool'
GROUPS = {'AI': ('✦','AI 与前沿'), '芯片': ('▦','芯片与算力'), '软件更新': ('↗','产品与软件'), '产品发布': ('↗','产品与软件'), '行业事件': ('◎','产业观察'), '其他科技': ('＋','更多科技动态')}


def excerpt(text, limit=150):
    """Keep a short verbatim passage; ellipsis explicitly marks a clipped excerpt."""
    text=' '.join(text.split())
    if len(text)<=limit:return text
    if text.isascii():
        part=text[:400].rsplit(' ',1)[0]
        return part+'…'
    return text[:limit]+'…'


def build_email(issue,records):
    attempted=any(r.get('calls') for r in records)
    shown=([r for r in records if r['result']] if attempted or issue.get('pool_edition') else records)[:20]
    cutoff=datetime.fromisoformat(issue['collection_cutoff'])
    date_label=cutoff.strftime('%Y.%m.%d')
    weekday='星期'+'一二三四五六日'[cutoff.weekday()]
    source_count=len({r['article']['source'] for r in shown})
    generated=sum(bool(r['result']) for r in shown)
    is_sample=issue['mode']=='historical_quality_sample'
    # Reading time is based on the displayed text, not a product promise.
    est_chars=sum(len((r['result'] or {}).get('summary',excerpt(r['article']['text']))) for r in shown)
    minutes=max(1,round(est_chars/350))
    state='离线原文摘录 · 尚未调用 DeepSeek' if generated==0 else f'{generated} 条模型初稿 · 尚待人工核对'
    caution='测试邮件，仅供指定邮箱审阅。包含历史样本，不代表今日24小时新闻。未经逐条人工事实审阅。' if is_sample else '测试邮件，仅供指定邮箱审阅。未经逐条人工事实审阅。'
    mode='版式与多来源样本' if is_sample else ('最近24小时 · 新选题测试加刊' if issue['mode']=='current_24h_sample' else '最近24小时早报')
    toc=[];groups=OrderedDict();plain=[f'【测试】每日科技早报｜{date_label}',caution,state,f'截止：{cutoff.strftime("%m月%d日 %H:%M")} 上海时间',f'本期 {len(shown)} 条 / {source_count} 个来源 / 约 {minutes} 分钟','今日速览']
    for i,r in enumerate(shown,1):
        a=r['article'];g=r['result'];title=(g or {}).get('title',a['title'])
        icon,label=('✦','今日重点') if i<=5 else ('＋','精编短讯')
        groups.setdefault((icon,label),[]).append((i,r))
        # Original external URL works in mail clients; avoid relying on fragment links.
        toc.append(f'<tr><td width="28" valign="top" style="width:28px;padding:7px 0;color:#829177;font-size:12px;font-weight:700">{i:02}</td><td style="padding:6px 0;font-size:14px;line-height:1.65"><a href="{e(a["url"],quote=True)}" style="color:#20251f;text-decoration:none">{e(title)}</a></td></tr>')
        plain.append(f'{i:02}. {title}')
    content=[]
    for (icon,label),items in groups.items():
        content.append(f'<tr><td class="pad" style="padding:34px 36px 12px"><span style="display:inline-block;background:#d7f783;padding:5px 12px;font-size:13px;font-weight:800;letter-spacing:1px">{icon} {label}</span></td></tr>')
        for i,r in items:
            a=r['article'];g=r['result'];title=(g or {}).get('title',a['title']);summary=((g or {}).get('short_summary') if i>5 else None) or (g or {}).get('summary',excerpt(a['text']))
            pub=datetime.fromisoformat(a['published_at'])
            notice='AI 初稿，待人工核对' if g else ('海外原文摘录，待中文精编' if a.get('language','zh-CN' if a['source']=='ithome' else 'en')=='en' else '原文摘录，待 AI 精编')
            if r.get('delayed_generation'):notice+=' · 延后生成'
            if a.get('update_review_required'):notice+=' · 更新待审'
            points=''.join('<p style="margin:8px 0;font-size:14px;line-height:1.8;color:#4d574c">• '+e(x)+'</p>' for x in ((g or {}).get('points',[]) if i<=5 else []))
            why=('<p style="margin:14px 0 0;padding:12px 14px;border-left:3px solid #a6ca58;background:#f6f9ee;font-size:14px;line-height:1.8"><strong>为什么值得关注</strong><br>'+e(g['why'])+'</p>') if g and g.get('why') and i<=5 else ''
            content.append(f'''<tr><td class="pad" style="padding:18px 36px 25px">
              <p style="margin:0 0 10px;font-size:11px;letter-spacing:1px;color:#73816b;font-weight:700">{i:02} / {e(label)}</p>
              <h2 style="margin:0 0 14px;font-size:22px;line-height:1.5;font-weight:800;letter-spacing:-.3px"><a href="{e(a['url'],quote=True)}" style="color:#111b12;text-decoration:none">{e(title)}</a></h2>
              <p style="margin:0;font-size:16px;line-height:1.95;color:#353f35;overflow-wrap:anywhere">{e(summary)}</p>{points}{why}
              <p style="margin:17px 0 0;font-size:11px;color:#768071;line-height:1.8">{e(a['source_name'])} · {pub.strftime('%m.%d %H:%M')}（上海时间）<br><span style="color:#8a6542">{e(notice)}</span>　<a href="{e(a['url'],quote=True)}" style="color:#526b32;text-decoration:underline">阅读原文 ↗</a></p>
              <div style="margin-top:25px;border-bottom:1px solid #e8eae3"></div>
            </td></tr>''')
            plain.extend(['',f'{i:02} / {label}',title,summary,*((g or {}).get('points',[]) if i<=5 else []),(g or {}).get('why','') if i<=5 else '',f"{a['source_name']} / {pub.strftime('%Y-%m-%d %H:%M')} 上海时间",a['url'],notice])
    leads=[] if attempted else issue.get('discovery_leads',[])
    if leads:
        content.append('<tr><td class="pad" style="padding:20px 36px 10px"><h2 style="font-size:16px;margin:0">海外选题雷达</h2><p style="margin:8px 0;font-size:12px;color:#7b8374;line-height:1.8">以下是待核实的发现线索，不计入本期精选。尚未拿到足够正文，不生成 AI 摘要。</p></td></tr>')
        plain.extend(['','海外选题雷达：仅线索，不计精选；正文不足，未生成摘要。'])
        for a in leads:
            label='HN 投稿时间；原文时间未确认' if a.get('published_time_kind')=='hn_submission' else 'RSS 文章发布时间'
            pub=datetime.fromisoformat(a['published_at']).strftime('%m.%d %H:%M')
            title=e(a['title']);url=e(a['url'],quote=True)
            discussion=(' · <a href="'+e(a['discussion_url'],quote=True)+'" style="color:#61784a">HN 讨论</a>') if a.get('discussion_url') else ''
            content.append('<tr><td class="pad" style="padding:10px 36px"><p style="font-size:14px;line-height:1.7;margin:0"><a href="'+url+'" style="color:#354130;text-decoration:none">'+title+'</a></p><p style="font-size:11px;color:#88907e;line-height:1.8;margin:6px 0 0">'+e(a['source_name']+' · '+pub+'（上海时间） · '+label)+discussion+'</p></td></tr>')
            plain.extend([a['source_name']+' / '+a['title'],pub+' 上海时间 / '+label,a['url']])
    health=(issue.get('source_health') or {}).get('sources',[])
    healthy=sum(bool(x.get('ok')) for x in health)
    discovery=sum(x.get('discovery_only',0) for x in health)
    coverage=f'采集状态：{healthy}/{len(health)} 路可用；{discovery} 条仅供发现线索，不据此补写正文。' if health else '采集范围有限，来源健康详情见内部审阅记录。'
    plain.extend(['',coverage,'来源范围有限，企业自述未经独立核实。模型处理及后续分发用途条件仍需核实。','当前仅允许发送到已指定的测试邮箱；请勿转发为正式简报。'])
    doc=f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>【测试】每日科技早报</title>
<style>@media only screen and (max-width:520px){{.outer{{padding:0!important}}.pad{{padding-left:23px!important;padding-right:23px!important}}.hero{{font-size:34px!important}}.card{{border:0!important}}}}</style></head>
<body style="margin:0;background:#edf0e9;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#172016;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">【测试】{e(mode)}，{len(shown)}条科技动态。{e(state)}。</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#edf0e9"><tr><td class="outer" align="center" style="padding:28px 12px">
<table role="presentation" class="card" width="680" cellspacing="0" cellpadding="0" style="width:100%;max-width:680px;background:#fff;border:1px solid #e1e6dc;border-collapse:collapse">
<tr><td class="pad" style="padding:25px 36px 0;border-top:7px solid #182719"><table role="presentation" width="100%"><tr><td style="font-size:11px;font-weight:800;letter-spacing:2px">EVERYDAY TECH NEWS</td><td align="right" style="font-size:11px;color:#65715d">{date_label} · {weekday}</td></tr></table></td></tr>
<tr><td class="pad" style="padding:34px 36px 26px"><p style="margin:0 0 16px"><span style="background:#d7f783;padding:6px 10px;font-size:11px;font-weight:800;letter-spacing:1px">MORNING BRIEF / 测试刊</span></p><h1 class="hero" style="margin:0;font-size:42px;line-height:1.25;letter-spacing:-1.5px;font-weight:900">早上好，<br>科技世界有新消息。</h1><p style="margin:20px 0 0;color:#66715e;font-size:13px;line-height:1.8">{len(shown)} 条科技动态　/　{source_count} 个来源　/　约 {minutes} 分钟</p></td></tr>
<tr><td class="pad" style="padding:0 36px 26px"><table role="presentation" width="100%" style="background:#f6f7f1;border-left:3px solid #b8d66b"><tr><td style="padding:12px 15px;font-size:12px;line-height:1.8;color:#637054"><strong>【测试】{e(mode)}</strong><br>{e(caution)}<br>{e(state)}<br>采集截止：{cutoff.strftime('%m月%d日 %H:%M')}（上海时间）</td></tr></table></td></tr>
<tr><td class="pad" style="padding:0 36px 22px"><div style="border-top:2px solid #1a2718;padding-top:18px"><h2 style="font-size:15px;margin:0 0 12px">今日速览 <span style="font-size:10px;font-weight:400;letter-spacing:1px;color:#89917e">/ AT A GLANCE</span></h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">{''.join(toc)}</table></div></td></tr>
{''.join(content)}
<tr><td class="pad" style="padding:8px 36px 32px"><p style="font-size:12px;line-height:1.9;color:#7b8374;margin:0">{e(coverage)}<br>来源范围有限，企业自述未经独立核实。<br>模型处理与后续分发用途条件仍需核实。</p></td></tr>
<tr><td class="pad" style="padding:24px 36px;background:#172719;color:#dce4d4;font-size:11px;line-height:1.9"><strong style="color:#e5f3c6;letter-spacing:1px">EVERYDAY TECH NEWS · 内部试刊</strong><br>测试邮件，仅供指定邮箱审阅。请勿作为正式简报转发。<br>版式版本 {LAYOUT_VERSION} · 未达到可收费标准</td></tr>
</table></td></tr></table></body></html>'''
    return doc,'\n\n'.join(x for x in plain if x)
