FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080
ENV ADMIN_KEY=admin2026

EXPOSE 8080

CMD ["node", "server/server.js"]
