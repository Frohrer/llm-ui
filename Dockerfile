# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-slim

WORKDIR /app

# Copy package files and install ALL dependencies (not just production)
# This is necessary because Vite is used in the server code
COPY package*.json ./
RUN npm ci

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/db ./db
COPY --from=builder /app/client/index.html ./client/index.html
COPY --from=builder /app/server/config ./server/config
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

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