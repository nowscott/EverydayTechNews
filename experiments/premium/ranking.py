"""Explainable cross-source editorial scoring, independent of IT之家 votes."""
from collections import Counter
from datetime import datetime
import re

VERSION='editorial-6'
PRIMARY={'mit_ai','deepmind','google_research','huggingface','nvidia','github','cloudflare','microsoft_foundry','apple','tesla','nasa','apple_developer','nasa_blogs'}
AI=r'(?<![A-Za-z])ai(?![A-Za-z])|\b(?:llm|agents?|chatgpt|openai|anthropic|claude|copilot|foundry|deepseek|gemini|gpt[- ]?\d|transformer|clef|qwen|llama|mistral|multimodal|embeddings?|diffusion|foundation models?|neural networks?)\b|人工智能|大模型|智能体|生成式|机器学习|模型训练|推理模型'
CHIPS=r'\b(?:gpu|cpu|nvidia|geforce|dlss|semiconductor|chips?|hbm|cuda|esp32|firmware)\b|芯片|算力|半导体|显卡|存储芯片|量子计算'
SOFTWARE=r'\b(?:release|runner|update|gateway|license|security|vulnerability|open.source|developer|software|api|python|linux|windows|parser|combinators?|compiler|programming|browser|database|databases|framework|encryption|javascript|typescript|rust)\b|更新|软件|开源|漏洞|开发者'
INTERESTS = {
    'AI': AI,
    'Apple': r'(?<![A-Za-z0-9])(?:apple|iphone|ipad|macbook|macos|ios|watchos|visionos|airpods|imac|homepod|mac\s+(?:mini|studio|pro)|vision\s+pro)(?![A-Za-z0-9])|苹果',
    'NVIDIA': r'(?<![A-Za-z0-9])(?:nvidia|geforce|cuda|rtx|blackwell|rubin)(?![A-Za-z0-9])|英伟达',
    'Tesla': r'(?<![A-Za-z0-9])(?:tesla|cybertruck|cybercab|fsd)(?![A-Za-z0-9])|特斯拉',
    'SpaceX': r'(?<![A-Za-z0-9])(?:spacex|starlink|starship|falcon)(?![A-Za-z0-9])|星舰|星链',
}
BROAD = r'\b(?:robot|robotics|automotive|satellite|space|rocket|electric vehicle|battery|hardware|smartphone)\b|机器人|智能汽车|自动驾驶|商业航天|卫星|火箭|手机|电池|产品|系统|汽车|航天'

def preferences():
    import json
    from pathlib import Path
    return json.loads(Path(__file__).with_name('editorial.json').read_text())

def evaluate(a,cutoff):
    title=a['title'];body=a['text'];signals=[]
    config=preferences()
    interests=[name for name,pattern in INTERESTS.items() if re.search(pattern,title,re.I)]
    if interests or re.search('|'.join([AI,CHIPS,SOFTWARE,BROAD]),title,re.I):
        relevance=30;signals.append('科技领域直接相关')
    elif re.search('|'.join([AI,CHIPS,SOFTWARE,BROAD]),body,re.I):
        relevance=12;signals.append('仅正文涉及科技，关联弱')
    else:relevance=5;signals.append('科技关联弱')
    interest_bonus=max([config['interest_weights'].get(x,0) for x in interests] or [0])
    impact=4
    for pattern,value,reason in [
        (r'安全|漏洞|修复|security|vulnerabilit|deprecat|shutdown|停用|关停',18,'安全、修复或服务变化'),
        (r'研究|报告|监管|收购|融资|research|study|report|regulat|acqui',16,'研究或行业事件'),
        (r'诉讼|指控|调查|litigation|lawsuit|allegation|investigation',16,'法律或行业风险，仍需保留指控/未证实限定'),
        (r'运营时间|全天候|自动驾驶|robotaxi|\bfsd\b|self.driving|driverless|launch mission|发射任务',16,'运营或核心能力变化'),
        (r'发布|推出|上线|正式|开源|launch|release|available|introduc|new in|arrive',14,'发布或可用性变化'),
        (r'测试|预览|计划|传闻|preview|beta|plan|rumou?r',8,'测试或未落定进展'),
    ]:
        if re.search(pattern,title,re.I):impact=max(impact,value);signals.append(reason)
    age=max(0,(cutoff-datetime.fromisoformat(a['published_at'])).total_seconds()/3600)
    freshness=round(15*max(0,1-age/48),2)
    # RSS transport format and English character count are not evidence quality.
    # IT之家/MacRumors descriptions can contain as much evidence as encoded feeds.
    evidence=13
    provenance=8 if a['source'] in PRIMARY else 5
    penalty=0
    if re.search(r'优惠|好价|促销|广告|秒杀|红包|sponsored|deals|giveaway',title,re.I):penalty=45;signals.append('营销选题降权')
    elif re.search(r'配色|主题壁纸|表盘|抽奖|促销|获奖|award|celebrat',title,re.I):penalty=16;signals.append('装饰/宣传内容降权')
    if re.search(r'战地|Gears of War|游戏皮肤|主题壁纸|表盘',title,re.I):penalty+=24;signals.append('非核心AI的游戏/外观更新降权')
    if re.search(r'关注.{0,20}(账号|账户)|follow(?:s|ed|ing)? .{0,30}(?:account|tesla)|banana|香蕉|趣闻',title,re.I):penalty+=24;signals.append('社交关注或趣闻，信息增量低')
    if re.search(r'(?:supercharg|充电站|超充).{0,60}(?:open|启用|开业|投票)|(?:open|启用|开业).{0,60}(?:supercharg|充电站|超充)',title,re.I):penalty+=20;signals.append('局部设施动态降权')
    if re.search(r'预购.{0,20}(?:送达|交付)|(?:delivery|shipping) dates?.{0,20}(?:up|earl)|moving up.{0,30}(?:delivery|shipping)',title,re.I):penalty+=14;signals.append('局部订单时间调整降权')
    if re.search(r'传闻|rumou?r|merger clues|hints?.{0,20}merger',title,re.I):penalty+=10;signals.append('未证实传闻降权')
    if re.search(r'候选版本|候选版|release candidate|\brc\b',title,re.I) and not re.search(r'安全|漏洞|重大|security|vulnerab|breaking',title,re.I):penalty+=12;signals.append('常规候选版本降权')
    if a.get('content_status')!='usable_excerpt':evidence=0;penalty+=100;signals.append('正文不足，禁止生成')
    score=round(max(0,min(100,relevance+impact+freshness+evidence+provenance+interest_bonus-penalty)),2)
    return dict(version=VERSION,score=score,interests=interests,config=config,breakdown=dict(relevance=relevance,impact=impact,freshness=freshness,evidence_amount=evidence,source_proximity=provenance,interest_bonus=interest_bonus,penalty=-penalty),signals=signals,note='启发式选题分，不是事实正确率；企业自述仍需归因')

def choose(candidates,cutoff,sample=False,target=None):
    for a in candidates:a['ranking']=evaluate(a,cutoff)
    minimum=40 if sample else 58
    target=target or preferences()['edition_maximum']
    sources=Counter();topics=Counter();interests=Counter();selected=[];rejected=[]
    pending=sorted(candidates,key=lambda a:(a['ranking']['score'],a['published_at'],a['id']),reverse=True)
    while pending and len(selected)<target:
        # Diversity can only decide between candidates within three score points.
        best=max(x['ranking']['score'] for x in pending)
        close=[x for x in pending if x['ranking']['score']>=best-3]
        a=min(close,key=lambda a:(sources[a['source']]+topics[a.get('topic')]+min([interests[x] for x in a['ranking']['interests']] or [0]),-a['ranking']['score'],-datetime.fromisoformat(a['published_at']).timestamp()))
        pending.remove(a)
        reason=None
        if a['ranking']['score']<minimum:reason='editorial_score_below_threshold'
        if reason:
            rejected.append(dict(id=a['id'],title=a['title'],reason=reason,ranking=a['ranking']));continue
        a['ranking']['selection_order']=len(selected)+1
        a['ranking']['diversity_adjustment']=0
        selected.append(a);sources[a['source']]+=1;topics[a.get('topic')]+=1
        interests.update(a['ranking']['interests'])
    rejected.extend(dict(id=a['id'],title=a['title'],reason='edition_capacity',ranking=a['ranking']) for a in pending)
    return selected,rejected
