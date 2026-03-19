#!/bin/sh
envsubst '${API_UPSTREAM}' < /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
