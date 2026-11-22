#!/bin/sh
# 普通版日志轮转：逐个文件 gzip 归档 + 截断，每个文件保留最近 4 份。
# 用法：etn-logrotate.sh [日志目录]（默认 NAS 普通版 managed/logs）
DIR=${1:-/vol3/1000/Docker/everydaytechnews-ordinary/managed/logs}
[ -d "$DIR" ] || exit 0
TS=$(date +%Y%m%d)
for NAME in commands.log sync.err scheduler.log updater.log; do
  FILE="$DIR/$NAME"
  [ -s "$FILE" ] || continue
  gzip -c "$FILE" > "$FILE.$TS.gz" && : > "$FILE"
  ls -1t "$FILE".*.gz 2>/dev/null | tail -n +5 | while read -r OLD; do rm -f "$OLD"; done
done
