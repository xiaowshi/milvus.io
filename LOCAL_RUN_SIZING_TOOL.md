# 本地启动 Milvus Sizing Tool

目标页面:

```text
http://127.0.0.1:8000/tools/sizing
```

这个页面是 `milvus.io` 站点里的 Next.js 页面，不需要单独后端计算服务；公式在前端代码里直接执行。

## 标准启动步骤

在仓库根目录执行:

```bash
cd /Users/SIPSS0779/Documents/workspace/repos/github/milvus.io
```

### 1. 准备 Node 和 pnpm

项目在 `package.json` 里声明的是 `pnpm@10.33.0`。

如果机器上已经有 Node 20 和 `corepack`:

```bash
corepack enable
corepack prepare pnpm@10.33.0 --activate
```

如果机器上还没有 Node，可以先装一个 Node 20，再继续下面步骤。

### 2. 拉子模块

```bash
git submodule update --init --recursive
```

必须保证这两个目录里有内容:

- `src/blogs`
- `src/docs`

因为启动前会执行 `scripts/migrateAssets.js`，它会直接读取:

- `src/blogs/blog/assets`
- `src/docs/*/assets`

### 3. 准备环境变量文件

```bash
cp .env.production .env.development
```

### 4. 如果没有内网 stats 接口，先放一个本地兜底文件

当前布局代码会静态导入 `global-stats.json`。如果本地访问不到 `.env.development` 里的内网地址，`next.config.js` 取数失败时不会自动生成这个文件，页面会报 `500`.

本地开发可以直接放一个兜底文件:

```bash
printf '{"pipInstall":0,"milvusStars":0}\n' > global-stats.json
```

### 5. 安装依赖

```bash
pnpm install
```

### 6. 启动前端开发服务

如果只是看 sizing 页面，用这个命令就够了:

```bash
pnpm run dev:fe
```

它实际会先跑:

```bash
node scripts/migrateAssets.js
next dev -p 8000
```

如果你还需要 i18n watcher，再用完整命令:

```bash
pnpm dev
```

### 7. 打开页面

```text
http://127.0.0.1:8000/tools/sizing
```

## 这台机器上实际跑通的方式

这台机器最开始没有系统级 `node` / `pnpm`，所以用了一个临时 Node 运行时。

### 1. 下载临时 Node 20

```bash
cd /Users/SIPSS0779/Documents/workspace/repos/github/milvus.io

BASE=$(curl -fsSL https://nodejs.org/dist/latest-v20.x/SHASUMS256.txt | awk '/darwin-arm64.tar.gz$/ {print $2; exit}')
rm -rf /private/tmp/node-latest-v20
mkdir -p /private/tmp/node-latest-v20
curl -fsSL -o "/private/tmp/${BASE}" "https://nodejs.org/dist/latest-v20.x/${BASE}"
tar -xzf "/private/tmp/${BASE}" -C /private/tmp/node-latest-v20 --strip-components=1
```

### 2. 临时把 Node 放进 PATH

```bash
export PATH=/private/tmp/node-latest-v20/bin:$PATH
export COREPACK_HOME=/private/tmp/corepack-home
export PNPM_HOME=/private/tmp/pnpm-home
export PNPM_STORE_DIR=/private/tmp/pnpm-store
export npm_config_cache=/private/tmp/npm-cache
```

### 3. 安装依赖并启动

```bash
corepack pnpm install
node scripts/migrateAssets.js
./node_modules/.bin/next dev -H 127.0.0.1 -p 8000
```

## 验证

启动后可直接检查:

```bash
curl -I http://127.0.0.1:8000/tools/sizing
```

预期返回:

```text
HTTP/1.1 200 OK
```

## 停止服务

前台运行时，直接 `Ctrl+C`。

如果是后台运行，可以先查 PID:

```bash
lsof -t -iTCP:8000 -sTCP:LISTEN
```

再停止:

```bash
kill <PID>
```

## 常见问题

### 1. `global-stats.json` not found

症状:

```text
Module not found: Can't resolve '../../../global-stats.json'
```

处理:

```bash
printf '{"pipInstall":0,"milvusStars":0}\n' > global-stats.json
```

### 2. `src/docs` 或 `src/blogs` 为空，`migrateAssets.js` 失败

先确认子模块已经初始化:

```bash
git submodule update --init --recursive
```

如果 `src/docs` 目录状态异常，重新拉一份内容仓库:

```bash
mv src/docs /private/tmp/milvusio-src-docs-broken-$(date +%s)
git clone --depth 1 https://github.com/milvus-io/web-content.git src/docs
```

### 3. 本地只想看 sizing 页面，不想多起 watcher

用:

```bash
pnpm run dev:fe
```

不要用:

```bash
pnpm dev
```

后者会额外启动 `i18n:watch`。
