FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
ARG BUILD_REVISION=unknown
LABEL org.opencontainers.image.revision=$BUILD_REVISION
ENV BUILD_REVISION=$BUILD_REVISION
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.sh /docker-entrypoint-custom.sh
RUN chmod +x /docker-entrypoint-custom.sh
RUN echo "{\"status\":\"ok\",\"buildTime\":\"$(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')\"}" > /usr/share/nginx/html/health.json
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint-custom.sh"]
