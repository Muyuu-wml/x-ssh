# x-ssh

面向 Windows 的现代 SSH 客户端：集中管理服务器、多标签终端、SFTP 文件传输。

**Go + Wails v2 + xterm.js** · 单文件 exe（11.4 MB）· 密码与密钥加密落盘

![version](https://img.shields.io/badge/version-0.1.0-blue)
![platform](https://img.shields.io/badge/platform-windows-lightgrey)

---

## 功能

| 模块 | 说明 |
|---|---|
| **主机管理** | 分组（可嵌套）、搜索、标签。界面内增删改 |
| **认证** | 密码（含 keyboard-interactive）、SSH 私钥（支持 passphrase） |
| **终端** | 多标签并行，每个标签独立 SSH 连接；自动 resize、滚动回看、链接可点 |
| **SFTP** | 双栏（本地 ↔ 远程）、盘符选择、进目录、新建/重命名/删除、拖拽上传下载（带进度） |
| **安全** | 敏感字段 AES-256-GCM 加密落盘；主密钥存 Windows 凭据管理器；主机密钥 TOFU 校验 |

**暂不支持**：跳板机、端口转发、云同步、团队协作、Snippets、自动补全、本地终端、Mosh、Serial。

## 快速开始

```bash
# 环境：Go 1.25+ / Node 18+ / Wails CLI（建议固定 v2.11.0）
go install github.com/wailsapp/wails/v2/cmd/wails@v2.11.0

wails dev        # 开发模式（前端热重载）
wails build      # 产出 x-ssh.exe（项目根目录）+ build/bin/x-ssh.exe
```

双击项目根目录下的 `x-ssh.exe` 即可使用（`wails build` 会自动把产物复制过来，
见 `scripts/postbuild.ps1`）。

## 数据在哪

```
%AppData%\x-ssh\
├── profile.json      主机与分组（敏感字段是 enc:v1:… 密文）
├── known_hosts.json  已信任的主机指纹
└── master.key        仅当系统凭据管理器不可用时才出现
```

`profile.json` 里没有明文密码，但它**不是可以随便分享或单独备份的文件**：
主机地址、用户名、分组名等仍是明文，而且主密钥默认不在这个文件里（在系统凭据
管理器），复制到另一台机器通常解不开。项目设计、任务和验证记录统一维护在
Notion 的 `项目 / x-ssh` 页面。

## 项目结构

```
main.go              Wails 窗口 + 前端资源 embed
app.go               绑定层（32 个方法）
internal/
  model/             Host / Group / Profile / FileEntry
  vault/             AES-256-GCM + 主密钥管理
  store/             profile.json 持久化（独占加密边界）
  sshx/              拨号、认证、主机密钥、PTY 会话、会话管理
  sftpx/             SFTP 浏览、传输、进度
  localfs/           本地文件系统（SFTP 左栏）
frontend/
  index.html         应用骨架
  src/main.js        状态与渲染
  src/style.css      深色主题
  wailsjs/           自动生成的绑定（勿手改）
scripts/              图标准备与构建产物复制
```

## 已知限制

- **未在真实服务器上端到端验证过**（开发机没有 sshd）——第一次连真机请留意
- 主机密钥首次连接**静默信任**，没有确认弹窗
- 主机编辑器会**回显密码**（为了支持编辑）
- 仅 Windows 验证过；`build/` 下有 macOS/Linux 模板但未测试

项目资料与后续验收记录见 Notion 的 `项目 / x-ssh` 页面。

## 许可

私有项目。
