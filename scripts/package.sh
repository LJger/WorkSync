#!/usr/bin/env bash
# 生成服务器部署包：只含构建产物、锁定的依赖清单和部署说明，不含 node_modules、.env 与数据库。
# SQLite 驱动与平台相关，依赖需在服务器上用 npm ci --omit=dev 安装。
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./package.json').version")
revision=$(git describe --always --dirty 2>/dev/null || echo unknown)
name="worksync-$version-$revision"
stage="release/$name"

# 清空旧产物，避免已删除的源码残留在 dist 中。
rm -rf dist "$stage" "release/$name.tar.gz"
npm run build

mkdir -p "$stage/deploy"
cp -R dist "$stage/dist"
find "$stage/dist" -name '*.map' -delete
cp package.json package-lock.json .env.example README.md "$stage/"
cp deploy/worksync.service "$stage/deploy/"
tar -czf "release/$name.tar.gz" -C release "$name"
rm -rf "$stage"

echo "部署包已生成：release/$name.tar.gz"
