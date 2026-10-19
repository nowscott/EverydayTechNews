"""Small first-party adapters. No arbitrary linked-URL fetching or paywall bypass."""
from datetime import datetime
import json
import re
from urllib.parse import urljoin, urlsplit
import xml.etree.ElementTree as ET

from bs4 import BeautifulSoup
import requests

ATOM = '{http://www.w3.org/2005/Atom}'


def parse_atom(raw, fetched_at):
    import brief as b
    rows = []
    for entry in ET.fromstring(raw).findall(ATOM+'entry')[:100]:
        links = [x.get('href','') for x in entry.findall(ATOM+'link') if x.get('rel','alternate')=='alternate']
        try:
            url=b.canonical(links[0])
            if urlsplit(url).hostname!='www.apple.com' or not urlsplit(url).path.startswith('/newsroom/'):continue
            updated=entry.findtext(ATOM+'updated','')
            published=entry.findtext(ATOM+'published','')
            clock=datetime.fromisoformat(published or updated)
            if clock.tzinfo is None:continue
        except (IndexError,ValueError):continue
        text=b.clean(entry.findtext(ATOM+'content','') or entry.findtext(ATOM+'summary',''))
        rows.append(dict(id=b.digest(url),url=url,source='apple',source_name='Apple Newsroom',
                         title=entry.findtext(ATOM+'title','').strip(),published_raw=published or updated,
                         published_at=clock.astimezone(b.SH).isoformat(),updated_at=updated or None,
                         original_article_published_at=published or None,
                         published_time_kind='atom_publication' if published else 'atom_update_not_publication',
                         fetched_at=fetched_at,event_time=None,text=text,description_clean=text,
                         content_status='discovery_only',content_origin='atom_summary',content_fingerprint=b.digest(text),
                         language='en',rights_status='unconfirmed_model_and_distribution'))
    return rows


def public_article(row, folder):
    """Only Apple/Tesla official article paths; redirects never followed outside allowlist."""
    import brief as b
    url=row['url'];host=urlsplit(url).hostname
    allowed={'apple':('www.apple.com','/newsroom/'),'tesla':('ir.tesla.com','/press-release/')}
    expected,prefix=allowed[row['source']]
    if host!=expected or not urlsplit(url).path.startswith(prefix):raise ValueError('body_url_not_allowlisted')
    response=requests.get(url,timeout=(10,30),allow_redirects=False,
                          headers={'User-Agent':'EverydayTechNews-internal-research/2.0'})
    response.raise_for_status()
    if response.status_code!=200:raise ValueError('article_redirect_or_blocked')
    raw=response.content
    row['body_fetched_at']=b.stamp();row['fetched_at']=row['body_fetched_at']
    path=folder/'feeds'/row['source']/(b.digest(raw.hex())+'.html')
    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
    soup=BeautifulSoup(raw,'html.parser')
    date=None
    meta=soup.select_one('meta[property="article:published_time"],meta[name="datePublished"]')
    if meta:date=meta.get('content')
    def published_in(value):
        if isinstance(value,list):return next((x for x in map(published_in,value) if x),None)
        if not isinstance(value,dict):return None
        return value.get('datePublished') or published_in(value.get('@graph',[]))
    for script in soup.select('script[type="application/ld+json"]'):
        try:date=date or published_in(json.loads(script.get_text()))
        except ValueError:pass
    if not date:
        # A calendar date without a timezone is insufficient for a 24-hour edition.
        row['body_probe_status']='publication_timestamp_unconfirmed';return row
    clock=datetime.fromisoformat(date)
    if clock.tzinfo is None:row['body_probe_status']='publication_timezone_unconfirmed';return row
    node=soup.select_one('.article-body, .pagebody, .wd_body, article')
    if not node:row['body_probe_status']='article_selector_missing';return row
    text=b.clean(str(node));row.update(text=text,content_fingerprint=b.digest(text),
        content_status=b.complete(text),content_origin='official_article_html',
        published_raw=date,published_at=clock.astimezone(b.SH).isoformat(),
        original_article_published_at=clock.astimezone(b.SH).isoformat(),
        published_time_kind='official_article_publication',body_snapshot=str(path),body_probe_status='parsed')
    return row


def parse_tesla(raw,fetched_at):
    """Tesla IR has no verified RSS. Listing dates are not invented as article times."""
    import brief as b
    rows=[];seen=set()
    for a in BeautifulSoup(raw,'html.parser').select('a[href*="/press-release/"]'):
        try:url=b.canonical(urljoin('https://ir.tesla.com',a['href']))
        except ValueError:continue
        title=a.get_text(' ',strip=True)
        if urlsplit(url).hostname!='ir.tesla.com' or url in seen or not title:continue
        seen.add(url)
        rows.append(dict(id=b.digest(url),url=url,source='tesla',source_name='Tesla 投资者关系',title=title,
            published_raw='',published_at=fetched_at,original_article_published_at=None,
            published_time_kind='discovery_time_not_publication',fetched_at=fetched_at,event_time=None,
            text='',description_clean='',content_status='discovery_only',content_fingerprint=b.digest(''),
            content_origin='ir_listing',language='en',rights_status='unconfirmed_model_and_distribution'))
    return rows[:20]


def supplement(rows,folder):
    import brief as b
    for row in rows[:5]:
        # Never fetch every old announcement on every tick. Sparse feeds stay sparse.
        if row['source']=='apple' and (b.now()-datetime.fromisoformat(row['published_at'])).total_seconds()>172800:continue
        try:public_article(row,folder)
        except (requests.RequestException,ValueError,TypeError):row['body_probe_status']='fetch_or_parse_failed'
    return rows
