FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bunx tsc

FROM oven/bun:1
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/bun.lock* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/schema.sql ./
COPY --from=build /app/tsconfig.json ./
COPY --from=build /app/src ./src
EXPOSE 8080
CMD ["bun", "src/server.ts"]
