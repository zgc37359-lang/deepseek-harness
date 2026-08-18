# Agent Note: 桌面打包应用携带扁平化生产 node_modules

Status: implemented

[English](2026-08-17-desktop-flat-production-closure.md) | 中文

## Problem

pnpm 隔离式 `node_modules` 布局会让 `resources/app` 内的裸工作区包和仅 peer 可达的包无法解析：打包后的 main 进程最先以 `@deepseek-ai/cordis-plugin-group` 的 `ERR_MODULE_NOT_FOUND` 失败。`pnpm deploy --legacy --prod` 只部署直接依赖，传递闭包缺失。

## Decision

`apps/desktop/scripts/flatten-deps.mjs` 从 `apps/desktop` 的 dependencies 加 peerDependencies 出发遍历生产依赖图，解引用所有 workspace 符号链接，把每个包的真实目录复制进 `dist-app-flat` 下单一的 hoisted `node_modules`。生成的 app `package.json` 只保留运行时元数据，`dependencies` 为空且不带 `build` 字段。`electron-builder.flat.yml` 将该目录打成 NSIS 安装器与 `latest.yml`。

electron-builder 永远把 `node_modules` 排除在主文件集之外，并由其收集器决定 node_modules 内容，而收集器基于的 pnpm 生产图不含仅 peer 可达的包。因此桌面包把这些包（cordis、cordis-plugin-group、cordis-plugin-loader 及 peer 可达的能力包）声明为真实依赖，使收集器图完整；asar 与扁平闭包逐包一致。构建避免使用 `pnpm exec electron-builder`：pnpm 11 在 exec 前会跑依赖状态检查，无 TTY 时直接中止；构建直接用 Node 调用 electron-builder。

## Verification

`node scripts/flatten-deps.mjs` 产出闭包；打包后的 `app.asar` 与扁平树逐包对比缺失的 `@deepseek-ai/*` 包；打包应用打印 `DESKTOP_SMOKE_OK` 并挂载 runtime；`scripts/perf-smoke.mjs` 在 CI 中把关冷启动与主进程峰值内存。

## Alternatives considered

**工作区外的独立闭包。** 在工作区外构建 hoisted 树需要把所有复制包的 `workspace:^` spec 改写成精确版本，pnpm 才能解析；工作区内闭包保持工作区图为权威。

**返回 false 的 `beforeBuild` hook。** electron-builder 虽标记 node_modules 已外部处理，但 v26 仍从主文件集排除 `node_modules/**`，asar 几乎为空；否决。

**`pnpm deploy --legacy --prod`。** 只部署直接依赖，传递闭包缺失；否决。

## Consequences

桌面包携带可复现的 246 包扁平闭包，无需端口即可启动。代价：需要维护第二条打包路径；原生模块在生产前仍需按 Electron ABI 重建（`npmRebuild: false`）；在配置代码签名证书前安装包保持未签名。传输边界参见[桌面 IPC 面说明](../architecture/2026-08-17-desktop-ipc-surface.md)。
