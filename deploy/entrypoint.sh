#!/bin/sh
# 容器启动：准备 SSH 部署密钥 → 首次 clone 素材仓库 → 启动服务器模式
set -e

if [ -d /run/ssh ]; then
  mkdir -p /root/.ssh && cp /run/ssh/* /root/.ssh/ 2>/dev/null || true
  chmod 700 /root/.ssh && chmod 600 /root/.ssh/* 2>/dev/null || true
fi
ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null || true

if [ ! -d "$PSL_DATA_DIR/.git" ]; then
  echo "首次启动：clone $PSL_REPO → $PSL_DATA_DIR"
  git clone "$PSL_REPO" "$PSL_DATA_DIR"
fi
mkdir -p "$PSL_PRIVATE_DIR"

[ $# -eq 0 ] && set -- serve
exec node /app/bin/psl.js "$@" --server
