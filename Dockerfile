FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@12.11.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec tsc

FROM oven/bun:1
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/schema.sql ./
COPY --from=build /app/tsconfig.json ./
COPY --from=build /app/src ./src
EXPOSE 8080
CMD ["bun", "src/server.ts"]
