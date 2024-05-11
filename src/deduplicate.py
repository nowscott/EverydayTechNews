def deduplicate_md_news(filename):
    # 读取文件
    with open(filename, 'r', encoding='utf-8') as file:
        lines = file.readlines()

    # 使用集合去重，同时保持顺序
    seen = set()
    unique_lines = []
    for line in lines:
        if line not in seen:
            unique_lines.append(line)
            seen.add(line)

    # 写回去重后的内容
    with open(filename, 'w', encoding='utf-8') as file:
        file.writelines(unique_lines)

# 示例：使用该函数对特定的Markdown文件去重
deduplicate_md_news('')
