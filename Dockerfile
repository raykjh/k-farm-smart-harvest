FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
# Explicit source roots: no .env, database, provider cache, recording or backup.
COPY app ./app
COPY components ./components
COPY lib ./lib
COPY prisma ./prisma
COPY scripts ./scripts
COPY data ./data
COPY tests ./tests
COPY e2e ./e2e
COPY solver ./solver
COPY instrumentation.ts proxy.ts next-env.d.ts postcss.config.mjs tsconfig.json ./
ENV NEXT_TELEMETRY_DISABLED=1 AI_MODE=demo KFARM_PRODUCTION_WORKER=0 KFARM_PRODUCTION_AI=0 KFARM_LABOR_WORKER=0 KFARM_SMS_WORKER=0
RUN DATABASE_URL=postgresql://build:unused@127.0.0.1:5432/build pnpm build
RUN mkdir -p /app/.data && chown -R node:node /app
USER node
ENV NODE_ENV=production
EXPOSE 3100
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3100"]
