# syntax=docker/dockerfile:1
# Build pinned upstream sources: the former binary image tags are unavailable.
FROM golang:1.24-alpine AS build
RUN apk add --no-cache git ca-certificates
RUN git clone --depth 1 --branch RELEASE.2025-09-07T16-13-09Z https://github.com/minio/minio.git /src/minio
RUN git clone --depth 1 --branch RELEASE.2025-08-13T08-35-41Z https://github.com/minio/mc.git /src/mc
ENV CGO_ENABLED=0 GOMAXPROCS=2
WORKDIR /src/minio
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -p 2 -trimpath -ldflags="-s -w" -o /out/minio .
WORKDIR /src/mc
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -p 2 -trimpath -ldflags="-s -w" -o /out/mc .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates curl
COPY --from=build /out/minio /out/mc /usr/local/bin/
COPY --from=build /src/minio/LICENSE /licenses/minio-LICENSE
COPY --from=build /src/mc/LICENSE /licenses/mc-LICENSE
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
EXPOSE 9000
ENTRYPOINT ["minio"]
