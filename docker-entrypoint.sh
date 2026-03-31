#!/bin/sh
set -e

# ============================================================
# docker-entrypoint.sh
# 动态生成 Nginx API failover 配置（与 web/ 保持一致）
#
# 环境变量格式：
#   APP_API_1_URL=http://api:80
#   APP_API_2_URL=https://api-backup.example.com
# ============================================================

TEMPLATE="/etc/nginx/templates/default.conf.template"
OUTPUT="/etc/nginx/conf.d/default.conf"

generate_failover_chain() {
  ENV_PREFIX="$1"
  LOC_PATH="$2"
  BACKUP_NAME="$3"

  TOTAL=0
  i=1
  while true; do
    eval "url=\${${ENV_PREFIX}_${i}_URL}"
    [ -z "$url" ] && break
    TOTAL=$((TOTAL + 1))
    i=$((i + 1))
  done

  if [ "$TOTAL" -eq 0 ]; then
    echo "[entrypoint] WARNING: No ${ENV_PREFIX}_N_URL configured, skipping ${LOC_PATH}"
    return
  fi

  echo "[entrypoint] Found $TOTAL ${LOC_PATH} backend(s)"

  i=1
  while [ "$i" -le "$TOTAL" ]; do
    eval "url=\${${ENV_PREFIX}_${i}_URL}"
    eval "host=\${${ENV_PREFIX}_${i}_HOST}"
    [ -z "$host" ] && host=$(echo "$url" | sed 's|https\?://||;s|/.*||;s|:.*||')
    echo "[entrypoint]   Backend $i: $url (Host: $host)"
    NEXT_IDX=$((i + 1))

    if [ "$i" -eq 1 ]; then
      BLOCK="
    location ${LOC_PATH} {
        proxy_pass ${url}/;
        proxy_ssl_server_name on;
        proxy_set_header Host ${host};
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;"
      [ "$TOTAL" -gt 1 ] && BLOCK="${BLOCK}
        proxy_intercept_errors on;
        error_page 502 503 504 = @${BACKUP_NAME}_${NEXT_IDX};"
      BLOCK="${BLOCK}
    }"
    else
      BLOCK="
    location @${BACKUP_NAME}_${i} {
        rewrite ^${LOC_PATH}(.*)\$ /\$1 break;
        proxy_pass ${url};
        proxy_ssl_server_name on;
        proxy_set_header Host ${host};
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;"
      [ "$NEXT_IDX" -le "$TOTAL" ] && BLOCK="${BLOCK}
        proxy_intercept_errors on;
        error_page 502 503 504 = @${BACKUP_NAME}_${NEXT_IDX};"
      BLOCK="${BLOCK}
    }"
    fi
    CHAIN_RESULT="${CHAIN_RESULT}${BLOCK}"
    i=$((i + 1))
  done
}

# --- 1. 生成 API failover 链 ---
CHAIN_RESULT=""
generate_failover_chain "APP_API" "/api/" "api_backup"
API_LOCATIONS="$CHAIN_RESULT"

# --- 2. 复制模板 ---
cp "$TEMPLATE" "$OUTPUT"

# --- 3. 注入动态 location 块 ---
if [ -n "$API_LOCATIONS" ]; then
  LOC_FILE=$(mktemp)
  printf '%s' "$API_LOCATIONS" > "$LOC_FILE"
  awk -v file="$LOC_FILE" -v marker="# __API_LOCATIONS__" '
    $0 ~ marker {
      while ((getline line < file) > 0) print line
      close(file)
      next
    }
    { print }
  ' "$OUTPUT" > "${OUTPUT}.tmp"
  mv "${OUTPUT}.tmp" "$OUTPUT"
  rm -f "$LOC_FILE"
fi

echo "[entrypoint] Nginx config generated at $OUTPUT"

# --- 4. 生成调试信息 ---
API_LIST=""
i=1
while true; do
  eval "url=\${APP_API_${i}_URL}"
  [ -z "$url" ] && break
  [ -n "$API_LIST" ] && API_LIST="${API_LIST}, "
  API_LIST="${API_LIST}\"APP_API_${i}_URL\": \"${url}\""
  i=$((i + 1))
done
cat > /usr/share/nginx/html/debug-env.json <<EOF
{
  ${API_LIST},
  "buildTime": "$(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')",
  "hostname": "$(hostname)"
}
EOF

# --- 5. 启动 nginx ---
exec nginx -g 'daemon off;'
