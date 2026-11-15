FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY index.html app.js style.css server.js vercel.json ./
COPY api ./api
COPY lib ./lib
COPY vendor ./vendor
USER node
EXPOSE 3000
CMD ["node", "server.js"]
