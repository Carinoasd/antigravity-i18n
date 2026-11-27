<p align="center"><a href="./README.md">繁體中文</a> | <b>简体中文</b> | <a href="./README.en.md">English</a></p>

# antigravity-i18n

[![CI](https://github.com/Carinoasd/antigravity-i18n/actions/workflows/ci.yml/badge.svg)](https://github.com/Carinoasd/antigravity-i18n/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

跨平台（Linux / macOS / Windows / WSL）的 **Google Antigravity 多语言本地化与外观工具**：支持简体中文（`zh-CN`）、繁体中文（`zh-TW`）、日语（`ja`）、韩语（`ko`）与自定义背景，**不用记命令**，打开图形控制台点一下就好。

## 🚀 最快的方式：直接打开图形控制台

需要 [Node.js 20 以上](https://nodejs.org/)。在终端中运行：

```bash
npx github:Carinoasd/antigravity-i18n
```

浏览器会自动打开本地控制台，可以：

- 一键应用「简体中文 / 繁体中文 / 日语 / 韩语 ＋ 背景面板」
- 只要自定义背景与 `Ctrl+Alt+B` 面板，保持英文界面
- 一键无损还原官方原版
- 应用 5 款内置渐变背景，调整不透明度／模糊／遮罩
- 安装或移除中文 AI 全局规则（零侵入模式）

> 控制台只监听 `127.0.0.1`，每次启动都会生成新的访问 Token，其他电脑或网站都无法操作。点击「关闭控制台」或按 `Ctrl+C` 即可退出。
>
> ⚠️ npm 上名为 `antigravity-i18n` 的包**不是本项目**（属于另一位作者）。请使用上面的 `github:` 写法，或按下方步骤从源码安装。

## 功能

- 🖥️ 支持 Antigravity **App**（桌面版 2.0+，`app.asar`）、**IDE**（编辑器与 Agent 面板）、**CLI**（`agy`）
- 🧩 App 采用**双层机制**：静态翻译主进程菜单／托盘／更新提示，加上**运行时 DOM 注入层**实时翻译动态加载的 React 界面
- 🔒 应用前自动计算 SHA-256、备份原始文件并写入 Manifest，可**一键无损还原**
- 🧪 `--dry-run` 先预览命中字符串数与覆盖率，不修改任何文件
- 🪶 **零侵入模式**：只安装全局规则，让 AI 全程用中文回复，完全不修改安装文件
- 🖼️ **自定义背景**（App）：`bg set` 使用自己的图片，或 `bg preset` 应用 5 款内置纯 CSS 渐变；`--tint` 加上可读性遮罩；换图、换预置都无需重新应用
- 🎛️ **界面内背景面板**（App）：按 **`Ctrl + Alt + B`**（macOS `Cmd + Option + B`）直接在 Antigravity 里选图、换预置、拖动滑块，立即生效、免重启
- 🎨 **仅背景模式**：`--lang none` 保持英文界面，只加上背景与面板
- ✅ 内置 CI 词库校验器（key 一致性、占位符、保护词、繁简用语检查）

> ⚠️ 本项目为社区项目，与 Google 无关。修改应用程序文件有风险，请先用 `--dry-run` 预览，并确认 `restore` 能正常工作。

## 从源码安装

```bash
git clone https://github.com/Carinoasd/antigravity-i18n.git
cd antigravity-i18n
npm install        # 会自动编译
npm link           # 之后即可直接使用 antigravity-i18n 命令
antigravity-i18n   # 不带参数：打开图形控制台
```

不想 `npm link` 的话，也可以直接用 `node dist/cli.js <命令>` 运行。

## 命令行快速开始

```bash
antigravity-i18n status                          # 检测安装与当前状态
antigravity-i18n apply --lang zh-CN --dry-run    # 预览，不修改任何文件
antigravity-i18n apply --lang zh-CN              # 正式应用（请先关闭 Antigravity）
antigravity-i18n apply --lang none --target app  # 只要背景与 Ctrl+Alt+B 面板，保持英文界面
antigravity-i18n restore                         # 还原官方原版
antigravity-i18n rules install --lang zh-CN      # 零侵入：只让 AI 用中文回复
```

## 命令一览

| 命令 | 说明 |
| --- | --- |
| `antigravity-i18n` / `ui [--port <n>] [--no-open]` | 打开本地图形控制台（只监听 `127.0.0.1`）。在 CI 或非交互环境中不带参数运行时，改为显示 `--help`。 |
| `status`（别名 `doctor`） | 检测到的 App / IDE / CLI 路径、汉化状态、挂钩版本、备份、背景与全局规则 |
| `apply --lang <zh-TW\|zh-CN\|none> [--target <app\|ide\|cli\|all>] [--path <目录>] [--dry-run] [--force] [--no-runtime]` | 备份并修补。已应用时默认拒绝重复覆盖，需加 `--force`（始终以原始备份重新翻译）。`none` 为仅背景模式，只适用于 `app`。 |
| `restore [--target ...] [--path <目录>] [--force]` | 校验备份 SHA-256 并逐字节还原 |
| `rules <install\|remove\|status> [--lang ...]` | 管理 `~/.gemini/config/rules/language-zh-*.md`（`trigger: always_on`） |
| `bg set <图片>` / `bg preset <名称>` / `bg presets` / `bg on\|off\|clear\|status` | 自定义背景（`--opacity`、`--blur`、`--size`、`--position`、`--mode overlay\|underlay`、`--tint`） |
| `validate` | CI 用词库校验（exit code 0 / 1） |

## 自定义背景与 `Ctrl+Alt+B` 面板

```bash
antigravity-i18n bg presets                                    # aurora、nebula、sunset、midnight、forest
antigravity-i18n bg preset midnight --opacity 0.3 --tint "rgba(0,0,0,0.25)"
antigravity-i18n bg set ~/Pictures/wallpaper.jpg --opacity 0.2 --blur 4
```

- 背景由 App 主进程挂钩在每次窗口加载时读取，**换背景无需重新应用**，重新打开或刷新窗口即可。
- 在 Antigravity 里按 **`Ctrl + Alt + B`**（macOS `Cmd + Option + B`）打开界面内面板；进入「设置 → 外观（Appearance）」时右下角也会出现「背景设置」小按钮。面板中的设置（含选择的图片）保存在应用本地的 **IndexedDB**，优先于 CLI 的 `background.json`；点击「重置」即回到 CLI 设置。
- 图片支持 PNG / JPEG / WebP / GIF，上限 **10 MB**。`--tint` 只接受安全的 CSS 颜色（`#hex`、`rgb()`、`rgba()`、`hsl()`、`hsla()`、`transparent`、`black`、`white`、`none`）。
- 背景图层为 `pointer-events: none`，不会挡住点击；代码、编辑器、终端、输入框与 AI 回复正文都不会被翻译。
- **WSL**：设置会同步镜像到 Windows 用户目录（`C:\Users\<你>\.antigravity-i18n`），让 Windows 版 Antigravity 读得到。

升级本工具后，请执行一次 `antigravity-i18n apply --target app --lang <zh-TW|zh-CN|none> --force` 以更新 App 挂钩（`status` 会提示）。

## 常见问题：`EBUSY` / `EPERM` / `EACCES`

表示 Antigravity 仍在运行（锁住了 `app.asar`），或安装位置需要更高权限。CLI 与控制台都会显示具体步骤：

1. 完全关闭 Antigravity：关闭所有窗口，**并**在托盘／菜单栏的 Antigravity 图标上右键 → Quit
2. Windows：在任务管理器中结束所有 Antigravity 进程；装在 `C:\Program Files` 时请以管理员身份运行终端
3. Linux / macOS 装在系统目录时：改用 `sudo`，或用 `--path` 指向你有写入权限的安装位置
4. 重试——每次应用与还原都会先备份，重试是安全的

## 更多文档

最完整的说明（检测路径、替换规则、运行时注入层原理、数据目录结构）请见 [繁体中文 README](./README.md)。贡献指南与用语规范：[CONTRIBUTING.md](./CONTRIBUTING.md)。AI 编程助手协作规范：[AGENTS.md](./AGENTS.md)。

## 许可证

[MIT](./LICENSE)
