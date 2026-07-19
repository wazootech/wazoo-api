FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/schema.sql ./
COPY --from=build /app/tsconfig.json ./
COPY --from=build /app/src ./src
EXPOSE 8080
CMD ["node", "--import", "tsx", "src/server.ts"]
