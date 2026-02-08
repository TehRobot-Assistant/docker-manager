FROM node:20-alpine

LABEL org.opencontainers.image.source="https://github.com/TehRobot-Assistant/game-server-panel"
LABEL org.opencontainers.image.description="Simple web panel to start/stop/restart Docker game servers"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY server.mjs ./
COPY public ./public

EXPOSE 3000

ENV PORT=3000
ENV CONFIG_PATH=/config
ENV ADMIN_PASSWORD=admin

CMD ["node", "server.mjs"]
