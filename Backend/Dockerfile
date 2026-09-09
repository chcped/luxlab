FROM node:22-alpine
WORKDIR /app
COPY Backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY Backend/src ./src
COPY Frontend/src ./public
USER node
ENV NODE_ENV=production FRONTEND_DIR=/app/public
EXPOSE 8080
CMD ["node", "src/server.js"]
