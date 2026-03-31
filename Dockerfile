FROM node:20-slim

WORKDIR /app

# Install build deps for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files first for Docker layer caching
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy app files
COPY server.js ./
COPY seo-geo-audit-tool.html ./
COPY admin.html ./
COPY db-adapter.js ./
COPY init-db.sql ./
COPY .env.example ./

# Create data directory
RUN mkdir -p /data

# Default env
ENV NODE_ENV=production
ENV PORT=8765
ENV DB_PATH=/data/restaurank.db

EXPOSE 8765

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:8765/auth/registration-mode',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
