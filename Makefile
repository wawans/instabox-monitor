.PHONY: test vet web-build build build-all docker-local docker-multiarch clean

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
IMAGE ?= ghcr.io/wawans/instabox-monitor:latest

vet:
	go vet ./...

test: vet
	go test -v -race ./...
	pnpm --dir web typecheck

web-build:
	pnpm --dir web install --frozen-lockfile
	pnpm --dir web typecheck
	pnpm --dir web build
	rm -rf internal/webui/dist/*
	cp -r web/dist/* internal/webui/dist/

build: web-build
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=$(VERSION)" -o bin/instabox-monitor ./cmd/server

build-all: web-build
	mkdir -p bin
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w -X main.version=$(VERSION)" -o bin/instabox-monitor-linux-amd64 ./cmd/server
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w -X main.version=$(VERSION)" -o bin/instabox-monitor-linux-arm64 ./cmd/server
	file bin/instabox-monitor-linux-amd64 bin/instabox-monitor-linux-arm64

docker-local:
	docker build --build-arg VERSION=$(VERSION) -t instabox-monitor:local .

docker-multiarch:
	IMAGE=$(IMAGE) VERSION=$(VERSION) ./scripts/build-multiarch.sh

clean:
	rm -rf bin/ web/dist/ internal/webui/dist/*
	touch internal/webui/dist/.gitkeep
