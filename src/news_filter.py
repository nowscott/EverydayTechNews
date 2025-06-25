"""新闻过滤工具模块"""

import re

def should_filter_news(title):
    """判断新闻是否应该被过滤掉
    
    Args:
        title (str): 新闻标题
        
    Returns:
        bool: True表示应该过滤掉，False表示保留
    """
    # 过滤掉包含广告、推广等关键词的新闻
    filter_keywords = ['广告', '推广', '赞助', '合作', '活动', '福利', '优惠']
    
    # 检查是否包含过滤关键词
    has_filter_keyword = any(keyword in title for keyword in filter_keywords)
    
    # 使用正则表达式更精确地匹配金额表达
    # 匹配数字+货币单位的模式，但排除大额数字（亿及以上）和文件大小单位
    currency_patterns = [
        r'\d+\s*元',           # 数字+元
        r'\d+\s*万元',         # 数字+万元
        # r'\d+\s*亿元',       # 注释掉亿元，保留包含亿的新闻
        r'\d+\s*千元',         # 数字+千元
        r'\d+\s*美元',         # 数字+美元
        r'\d+\s*万美元',       # 数字+万美元
        r'\d+\s*亿美元',       # 数字+亿美元
        r'\d+\s*千美元',       # 数字+千美元
        r'\$\s*\d+',          # $+数字
        r'\d+\s*日元',         # 数字+日元
        r'\d+\s*万日元',       # 数字+万日元
        r'\d+\s*亿日元',       # 数字+亿日元
        r'\d+\s*千日元',       # 数字+千日元
        r'¥\s*\d+',           # ¥+数字
        r'\d+\s*欧元',         # 数字+欧元
        r'\d+\s*万欧元',       # 数字+万欧元
        r'\d+\s*亿欧元',       # 数字+亿欧元
        r'\d+\s*千欧元',       # 数字+千欧元
        r'€\s*\d+',           # €+数字
        r'\d+\s*英镑',         # 数字+英镑
        r'\d+\s*万英镑',       # 数字+万英镑
        r'\d+\s*亿英镑',       # 数字+亿英镑
        r'\d+\s*千英镑',       # 数字+千英镑
        r'£\s*\d+',           # £+数字
        r'\d+\s*韩元',         # 数字+韩元
        r'\d+\s*万韩元',       # 数字+万韩元
        r'\d+\s*亿韩元',       # 数字+亿韩元
        r'\d+\s*千韩元',       # 数字+千韩元
        r'₩\s*\d+',           # ₩+数字
        r'HK\$\s*\d+',        # HK$+数字
        r'NT\$\s*\d+',        # NT$+数字
        r'A\$\s*\d+',         # A$+数字
        r'C\$\s*\d+',         # C$+数字
        r'S\$\s*\d+',         # S$+数字
        r'R\$\s*\d+',         # R$+数字
        r'MX\$\s*\d+',        # MX$+数字
        r'\d+\s*卢比',         # 数字+卢比
        r'\d+\s*万卢比',       # 数字+万卢比
        r'\d+\s*亿卢比',       # 数字+亿卢比
        r'₹\s*\d+',           # ₹+数字
        r'\d+\s*卢布',         # 数字+卢布
        r'\d+\s*万卢布',       # 数字+万卢布
        r'\d+\s*亿卢布',       # 数字+亿卢布
        r'₽\s*\d+',           # ₽+数字
        r'\d+\s*雷亚尔',       # 数字+雷亚尔
        r'\d+\s*万雷亚尔',     # 数字+万雷亚尔
        r'\d+\s*比索',         # 数字+比索
        r'\d+\s*万比索',       # 数字+万比索
        r'\d+\s*里拉',         # 数字+里拉
        r'\d+\s*万里拉',       # 数字+万里拉
        r'₺\s*\d+',           # ₺+数字
        r'\d+\s*兰特',         # 数字+兰特
        r'\d+\s*万兰特',       # 数字+万兰特
        r'\d+\s*泰铢',         # 数字+泰铢
        r'\d+\s*万泰铢',       # 数字+万泰铢
        r'฿\s*\d+',           # ฿+数字
        r'\d+\s*林吉特',       # 数字+林吉特
        r'\d+\s*万林吉特',     # 数字+万林吉特
        r'RM\s*\d+',          # RM+数字
        r'\d+\s*印尼盾',       # 数字+印尼盾
        r'\d+\s*万印尼盾',     # 数字+万印尼盾
        r'Rp\s*\d+',          # Rp+数字
        r'\d+\s*菲律宾比索',   # 数字+菲律宾比索
        r'\d+\s*万菲律宾比索', # 数字+万菲律宾比索
        r'₱\s*\d+',           # ₱+数字
        r'\d+\s*越南盾',       # 数字+越南盾
        r'\d+\s*万越南盾',     # 数字+万越南盾
        r'₫\s*\d+',           # ₫+数字
    ]
    
    # 检查是否包含真正的金额表达
    has_currency = any(re.search(pattern, title) for pattern in currency_patterns)
    
    # 排除文件大小单位（KB, MB, GB, TB等）
    if has_currency:
        file_size_patterns = [
            r'\d+\s*KB',   # KB
            r'\d+\s*MB',   # MB  
            r'\d+\s*GB',   # GB
            r'\d+\s*TB',   # TB
            r'\d+\s*PB',   # PB
            r'\d+\s*k',    # k (小写)
            r'\d+\s*m',    # m (小写)
            r'\d+\s*g',    # g (小写)
            r'\d+\s*t',    # t (小写)
        ]
        # 如果匹配到文件大小单位，则不认为是金额
        if any(re.search(pattern, title, re.IGNORECASE) for pattern in file_size_patterns):
            has_currency = False
    
    return has_filter_keyword or has_currency

def filter_news_list(news_list, max_count=None):
    """过滤新闻列表
    
    Args:
        news_list (list): 新闻列表，每个元素为(title, url)元组
        max_count (int, optional): 最大返回数量
        
    Returns:
        list: 过滤后的新闻列表
    """
    filtered_news = []
    
    for title, url in news_list:
        if not should_filter_news(title):
            filtered_news.append((title, url))
    
    if max_count is not None:
        return filtered_news[:max_count]
    
    return filtered_news