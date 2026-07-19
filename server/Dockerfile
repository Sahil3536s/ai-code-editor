# Dockerfile for CodeAnywhere backend
FROM node:20-slim

# Install system dependencies and the Docker CLI
# This allows the containerized Node app to run "docker" commands on the host daemon via the mounted socket.
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    lsb-release \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
      $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update && apt-get install -y docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency files first for caching
COPY package*.json ./
RUN npm ci --only=production

# Copy server code
COPY . .

EXPOSE 3001

CMD ["node", "index.js"]
