FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
RUN echo "{\"status\":\"ok\",\"buildTime\":\"$(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')\"}" > /usr/share/nginx/html/health.json
ENV API_UPSTREAM=http://localhost
ENV NGINX_ENVSUBST_FILTER=API_UPSTREAM
EXPOSE 80
