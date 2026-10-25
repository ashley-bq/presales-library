# 售前素材库服务器镜像：Node + Chromium（Playwright 官方镜像）+ LibreOffice（旧 PPTX 渲染）+ 中文字体
FROM mcr.microsoft.com/playwright:v1.64.0-noble

# 国内服务器构建慢时可传镜像源，如：APT_MIRROR=mirrors.tencentyun.com NPM_MIRROR=https://registry.npmmirror.com
ARG APT_MIRROR=
ARG NPM_MIRROR=

RUN if [ -n "$APT_MIRROR" ]; then sed -i "s|//.*ubuntu.com|//$APT_MIRROR|g" /etc/apt/sources.list.d/ubuntu.sources; fi \
 && apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      git openssh-client libreoffice-impress fonts-noto-cjk fonts-noto-cjk-extra fonts-wqy-microhei \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN if [ -n "$NPM_MIRROR" ]; then npm config set registry "$NPM_MIRROR"; fi \
 && npm ci --omit=dev
COPY . .

ENV PSL_MODE=server \
    PSL_HOST=0.0.0.0 \
    PSL_PORT=4173 \
    PSL_DATA_DIR=/data/repo \
    PSL_PRIVATE_DIR=/data/private \
    NODE_ENV=production

EXPOSE 4173
ENTRYPOINT ["/app/deploy/entrypoint.sh"]
