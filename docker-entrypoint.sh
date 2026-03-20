#!/bin/sh
# 生成调试信息 JSON（暴露 API_UPSTREAM 等运行时配置）
cat > /usr/share/nginx/html/debug-env.json <<EOF
{
  "API_UPSTREAM": "${API_UPSTREAM}",
  "buildTime": "$(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')",
  "hostname": "$(hostname)"
}
EOF

# 调用 nginx 官方 entrypoint（处理 templates 机制）
exec /docker-entrypoint.sh nginx -g 'daemon off;'
