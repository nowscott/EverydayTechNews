"""Read-only compatibility oracle; no external calls and no real subscriber delivery."""
from pathlib import Path
import json
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'src'))
import newsletter
import news_sorter
import script

def execute(c):
    op = c['op']
    if op == 'render':
        body = newsletter.format_news(c['markdown'])
        return {'body': body, 'html': newsletter.build_message(c['name'], body, **c.get('notifications', {}), unsubscribe_url=c['unsubscribe'], delivery_date=c['date'])}
    if op == 'sort':
        items = news_sorter.parse_news(c['markdown'])
        scores = {url: news_sorter.FILTERED_SCORE if news_sorter.adjust_value_based_on_title(title) is not None else c['values'].get(url, news_sorter.FAILED_SCORE) for title, url in items}
        rows = news_sorter.sort_news_by_value(items, scores)
        return {'items': rows, 'markdown': news_sorter.format_news_to_md(rows)}
    if op == 'grade': return news_sorter.calculate_score(*c['votes'])
    if op == 'parse_grade': return news_sorter.parse_grade_response(c['raw'])
    if op == 'html':
        return [{**n, 'time': n['time'].isoformat()} for n in script.parse_news_html(c['raw'])]
    if op == 'rss':
        return [{**n, 'time': n['time'].isoformat()} for n in script.parse_rss_news(c['raw'])]
    if op == 'similar': return script.is_similar(c['a'], c['b'])
    raise ValueError('unknown oracle operation')

if __name__ == '__main__':
    print(json.dumps([execute(c) for c in json.load(sys.stdin)], ensure_ascii=False))
