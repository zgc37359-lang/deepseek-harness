# Agent Note：桌面端 Session 导出走 RPC 通道并显示保存路径

Status: implemented

[English](2026-08-18-desktop-session-export-lane.md) | 中文

## 问题

打包桌面应用中 `/export` 命令报 “Session 导出失败 / Failed to fetch”。Web 下载
控制器从 `location.origin` 拉取 `/api/session.export`，但桌面渲染进程没有 HTTP
origin（`dsh://`，origin 为 `null`），回退地址 `http://dsh.internal` 不可达。
即使字节已落地，成功对话框仍写“浏览器正在下载”，也不告诉用户文件在哪。

## 决策

- 宿主：新增 `session.exportZip` RPC，复用 Session 日志导出流水线，返回 ZIP
  字节的 base64 与常规文件名。
- 桌面主进程/preload：`desktop.download.save(filename, base64)` 写入用户
  Downloads 目录；`desktop.download.reveal(path)` 在资源管理器中显示
  （Downloads 之外的路径被拒绝）。
- 客户端控制器：存在桌面桥时导出走 RPC 通道而非 `fetch`，并把保存路径发布到
  下载对话框状态。
- 对话框：桌面成功态显示“已保存到：<path>”与“在文件夹中显示”按钮；Web 部署
  保留浏览器文案。

## 验证

- 单测覆盖桌面 RPC 分支（成功与失败）、对话框中的保存路径与 reveal 动作。
- 打包应用：`/export` 将 `dsh-session-<id>.zip` 写入 Downloads，成功对话框
  显示路径。

## 备选方案

**让桌面宿主提供 HTTP 端点。** 桌面宿主刻意没有 Web 服务；RPC 通道与桥接其余
部分一致。

## 影响

桌面端 Session 导出可用，并以桌面语义确认；Web 部署的控制器与对话框文案不变。
