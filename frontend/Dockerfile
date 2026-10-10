# Контекст сборки — корень репозитория: нужны docs/validation, docs/training и docs/brand (графики, брендбук, логотипы)
FROM node:22-alpine AS build
WORKDIR /repo
COPY frontend/package*.json frontend/
RUN cd frontend && npm ci
COPY frontend frontend
COPY docs/validation docs/validation
COPY docs/training docs/training
COPY docs/brand docs/brand
RUN cd frontend && npm run build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
EXPOSE 80
