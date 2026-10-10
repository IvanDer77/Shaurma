FROM node:22-alpine AS build
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY backend/migrations ./migrations
COPY backend/assets ./assets
EXPOSE 8080
CMD ["node", "dist/server.js"]
