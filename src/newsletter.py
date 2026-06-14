import re
from html import escape

from news_filter import filter_news_list, should_filter_news


def is_news_sorted(news_string):
    return "(sorted)" in news_string


def simple_filter_news(matches):
    news_list = [(title, url) for title, url in matches]
    filtered_news = filter_news_list(news_list)
    quality_filtered = [
        (title, url) for title, url in filtered_news if len(title) >= 10
    ]

    if len(quality_filtered) < 25:
        for title, url in news_list:
            if (title, url) in quality_filtered:
                continue
            if not should_filter_news(title):
                quality_filtered.append((title, url))
            if len(quality_filtered) == 25:
                break

    return quality_filtered[:25]


def format_news(news_string):
    matches = re.findall(r"\[(.*?)\]\((.*?)\)", news_string)
    if is_news_sorted(news_string):
        matches = matches[:25]
    else:
        matches = simple_filter_news(matches)

    items = []
    for index, (title, link) in enumerate(matches, start=1):
        items.append(
            """
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                   style="width:100%;border-collapse:collapse;border-top:1px solid #d9ded9">
              <tr>
                <td width="52" valign="top"
                    style="width:52px;padding:18px 0;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;color:#bd4f32">
                  {index:02d}
                </td>
                <td valign="top" style="padding:16px 0">
                  <a href="{link}"
                     style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;font-size:16px;font-weight:700;line-height:1.65;color:#172126;text-decoration:none">
                    {title}
                  </a>
                </td>
              </tr>
            </table>
            """.format(
                index=index,
                link=escape(link, quote=True),
                title=escape(title),
            )
        )
    return "".join(items)


def build_message(
    name,
    formatted_news,
    start_notification="",
    end_notification="",
    end_comment="",
    unsubscribe_url="",
):
    safe_name = escape(name)
    safe_start_notification = escape(start_notification)
    safe_end_notification = escape(end_notification)
    safe_end_comment = escape(end_comment)
    notification = ""
    if safe_start_notification:
        notification = f"""
          <tr>
            <td style="padding:0 36px 28px">
              <div style="border-left:3px solid #bd4f32;background:#f4f0e7;padding:14px 16px;font-size:14px;line-height:1.7;color:#4d5a5e">
                {safe_start_notification}
              </div>
            </td>
          </tr>
        """
    closing = "".join(
        f'<p style="margin:8px 0 0">{value}</p>'
        for value in (safe_end_notification, safe_end_comment)
        if value
    )
    unsubscribe = ""
    if unsubscribe_url:
        safe_unsubscribe_url = escape(unsubscribe_url, quote=True)
        unsubscribe = f"""
          <p style="margin:18px 0 0">
            <a href="{safe_unsubscribe_url}"
               style="display:inline-block;border:1px solid #9ca8a4;padding:8px 14px;color:#4d5a5e;text-decoration:none">
              退订每日科技早报
            </a>
          </p>
        """

    return f"""
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>今日科技早报</title>
  </head>
  <body style="margin:0;padding:0;background:#ece9e0;color:#172126">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">
      今日值得关注的科技新闻，已为你筛选整理。
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
           style="width:100%;border-collapse:collapse;background:#ece9e0">
      <tr>
        <td align="center" style="padding:28px 12px">
          <table role="presentation" width="680" cellspacing="0" cellpadding="0"
                 style="width:100%;max-width:680px;border-collapse:collapse;background:#fffef9;border:1px solid #d1d8d4">
            <tr>
              <td style="padding:34px 36px 30px;border-top:5px solid #bd4f32">
                <p style="margin:0;font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:2px;color:#bd4f32">
                  EVERYDAY TECH NEWS
                </p>
                <h1 style="margin:10px 0 0;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;font-size:30px;line-height:1.25;letter-spacing:-1px;color:#172126">
                  每日科技早报
                </h1>
                <p style="margin:14px 0 0;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;font-size:15px;line-height:1.8;color:#637078">
                  早上好，{safe_name}。以下是今天值得关注的科技动态。
                </p>
              </td>
            </tr>
            {notification}
            <tr>
              <td style="padding:0 36px">
                <p style="margin:0 0 10px;font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#2f6f62">
                  TODAY'S BRIEFING
                </p>
                {formatted_news}
              </td>
            </tr>
            <tr>
              <td style="padding:28px 36px 34px;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.75;color:#637078">
                {closing}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 36px;background:#172126;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;font-size:12px;line-height:1.7;color:#c7ceca">
                <strong style="color:#fffef9">每日科技早报</strong><br>
                每天筛选重要科技新闻，减少信息噪音。
                {unsubscribe}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
""".strip()
