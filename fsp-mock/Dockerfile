FROM node:22-alpine
WORKDIR /app
COPY fsp-mock/package*.json ./
RUN npm ci --omit=dev
COPY fsp-mock/server.js ./
EXPOSE 8002
CMD ["node", "server.js"]
