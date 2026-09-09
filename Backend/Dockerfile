FROM node:22-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY backend/src ./src
COPY Frontend/src ./public
USER node
ENV NODE_ENV=production FRONTEND_DIR=/app/public
EXPOSE 8080
CMD ["node", "src/server.js"]
