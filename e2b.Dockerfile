# You can use most Debian-based base images
FROM ubuntu:22.04

# Install dependencies and customize sandbox
# e2b.Dockerfile
# E2B requires this base image:
    FROM e2bdev/code-interpreter:latest

    # Basics + build tools + OpenSSL (needed by Prisma), Git, curl, unzip, vim (optional)
    USER root
    RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
      ca-certificates curl git build-essential openssl \
      python3 make g++ pkg-config jq unzip vim \
      && rm -rf /var/lib/apt/lists/*
    
    # Node toolchain: ensure Node 20+ is available, plus package managers
    # (The base usually has Node, but we ensure versions and add pnpm & yarn)
    RUN corepack enable && corepack prepare pnpm@latest --activate && corepack prepare yarn@1.22.22 --activate
    
    # Shopify CLI (Node-based) + useful globals
    # Note: Shopify CLI requires Node 20.10+ and git ≥ 2.28. :contentReference[oaicite:1]{index=1}
    RUN npm i -g @shopify/cli@latest @shopify/theme@latest
    
    # Prisma CLI. You’ll usually run it via npx inside projects,
    # but global is handy in a bare sandbox too.
    RUN npm i -g prisma@latest
    
    # Optional: Cloudflare tunnel for stable public URL during dev
    # (ngrok also works if you prefer). You can auth it at runtime.
    RUN curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb \
      && apt-get update && apt-get install -y /tmp/cf.deb || true && rm -f /tmp/cf.deb
    
    # Quality-of-life: print versions when the sandbox starts
    RUN printf '#!/usr/bin/env bash\n\
    set -e\n\
    echo \"Node: $(node -v)\"; echo \"npm: $(npm -v)\"; echo \"pnpm: $(pnpm -v 2>/dev/null || true)\"; echo \"yarn: $(yarn -v)\"; \n\
    echo \"git: $(git --version)\"; echo \"openssl: $(openssl version)\"; \n\
    echo \"shopify: $(shopify version || true)\"; echo \"prisma: $(prisma -v || true)\"; \n\
    # keep a light-weight process running if you want to auto-start something later\n\
    tail -f /dev/null\n' > /usr/local/bin/sbx-start.sh && chmod +x /usr/local/bin/sbx-start.sh
    
    # Non-root dev user (optional; E2B often runs as root)
    # RUN useradd -ms /bin/bash dev && usermod -aG sudo dev
    # USER dev
    
    # Default working directory
    WORKDIR /workspace
    