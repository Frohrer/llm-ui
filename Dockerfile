# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Install git
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Ensure providers are copied to dist directory
RUN mkdir -p dist/providers && cp -r server/config/providers/* dist/providers/

# Production stage
FROM node:20-slim

WORKDIR /app

# Install git and postgresql-client
RUN apt-get update && apt-get install -y git postgresql-client && rm -rf /var/lib/apt/lists/*

# Copy package files and install ALL dependencies (not just production)
# This is necessary because Vite is used in the server code
COPY package*.json ./
RUN npm ci

# Copy everything needed for the app to run
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/db ./db
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/client/src ./client/src
COPY --from=builder /app/client/index.html ./client/index.html
COPY --from=builder /app/server ./server
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/theme.json ./theme.json
COPY --from=builder /app/vite.config.ts ./vite.config.ts
COPY --from=builder /app/postcss.config.js ./postcss.config.js
COPY --from=builder /app/tailwind.config.ts ./tailwind.config.ts
COPY --from=builder /app/types ./types
COPY --from=builder /app/server/config/providers ./server/config/providers

# Create screenshots directory
RUN mkdir -p /app/public/screenshots && chmod 777 /app/public/screenshots

# Add wait-for-it script
ADD https://raw.githubusercontent.com/vishnubob/wait-for-it/master/wait-for-it.sh /wait-for-it.sh
RUN chmod +x /wait-for-it.sh

# Expose the application port
EXPOSE 5000

# Set environment variables
ENV NODE_ENV=production

# Add entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]