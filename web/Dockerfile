FROM node:22-alpine AS build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
COPY design/ /app/design/
COPY contracts/ /app/contracts/
COPY features/ /app/features/
COPY mobile/composeApp/src/commonMain/kotlin/ /app/mobile/composeApp/src/commonMain/kotlin/
RUN npm run build

FROM caddy:2.11.9-alpine
COPY --from=build /app/web/dist /srv
EXPOSE 443
