#!/usr/bin/env bash
set -euo pipefail

IMAGE="${IMAGE:-ghcr.io/wawans/instabox-monitor:latest}"
VERSION="${VERSION:-$(git describe --tags --always --dirty 2>/dev/null || echo dev)}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
PUSH="${PUSH:-0}"

BUILDER_NAME="instabox-multiarch"
if ! docker buildx inspect "${BUILDER_NAME}" >/dev/null 2>&1; then
  docker buildx create --name "${BUILDER_NAME}" --driver docker-container --use
else
  docker buildx use "${BUILDER_NAME}"
fi

ARGS=(
  --platform "${PLATFORMS}"
  --build-arg "VERSION=${VERSION}"
  -t "${IMAGE}"
)

if [[ "${PUSH}" == "1" ]]; then
  ARGS+=(--push)
  echo "Building and pushing multi-arch image ${IMAGE} (${PLATFORMS})..."
else
  echo "Building multi-arch image ${IMAGE} (${PLATFORMS}) without push (set PUSH=1 to push)..."
fi

docker buildx build "${ARGS[@]}" .
