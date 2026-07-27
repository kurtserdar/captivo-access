# ---- build ----
FROM golang:1.23-alpine AS build
WORKDIR /src

# See dataplane/Dockerfile for the full explanation. Short version: the repo-root
# go.work lists connector, dataplane, and tunnel as workspace modules. This image
# only needs connector + the shared tunnel module, so we do NOT copy go.work —
# doing so would make `go build` try to resolve every `use` entry (including
# ./dataplane, which we haven't copied) and fail. connector/go.mod already has
#   replace github.com/kurtserdar/captivo-access/tunnel => ../tunnel
# so with no go.work in the build context, `go build` runs in plain single-module
# mode and resolves that replace against the tunnel/ directory copied below.
COPY tunnel ./tunnel
COPY connector ./connector
RUN cd connector && CGO_ENABLED=0 go build -o /out/connector .

# ---- run ----
FROM alpine:3.20
RUN mkdir -p /data && adduser -D -H -u 10001 connector && chown connector /data
COPY --from=build /out/connector /usr/local/bin/connector
USER connector
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/connector"]
