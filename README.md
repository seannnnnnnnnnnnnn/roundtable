# Roundtable

> 别让一个模型替你下结论。让多个独立立场先把分歧说清楚。

Roundtable 是一款面向内容、商业与决策场景的多 Agent 圆桌讨论工具。你输入一个问题、文案、销售话术或产品想法，系统先补齐关键前提，再让不同 Markdown 角色独立判断、交叉回应、实践取舍，最后输出一份可执行的辩证回答。

它不是让一个 AI 一次性扮演正方、反方和裁判。每个角色拥有独立的 Markdown 设定、目标函数与判断边界，讨论过程真实分步运行，修改角色设定会直接改变讨论结果。

## 为什么使用 Roundtable

- **先问对问题，再开始回答**：上下文引导 Agent 动态补齐会改变判断方向的条件。
- **真实多角色讨论**：独立首发、交叉回应、关键分歧与实践取舍分别运行。
- **价值冲突可见**：不默认做道德裁判，也不把最终答案压成没有选择的中庸结论。
- **三层阅读路径**：10 秒看结论，1 分钟看分歧，需要时再展开完整记录。
- **角色可以选择和修改**：每轮开桌前都能确认参与角色及其 Markdown。
- **数据留在本机**：项目、会话、角色输出和 API 配置保存在用户自己的 Mac。
- **在线更新有明确退路**：桌面版从 GitHub Releases 检查新版本；正式签名版后台下载并重启安装，社区签名版直接打开对应下载页。

## 适合谁

- 需要判断选题、文案和小红书笔记是否成立的内容团队
- 需要检验销售话术、产品功能和商业想法的创业者
- 希望看清不同目标函数、风险承担者和行动代价的决策者
- 希望通过 Markdown 塑造专业 Agent，而不是接受默认模型人格的 AI 使用者

## macOS 安装

前往 [Releases](https://github.com/seannnnnnnnnnnnnn/roundtable/releases) 下载与你的 Mac 匹配的版本：

- Apple 芯片（M1/M2/M3/M4）：`arm64`
- Intel 芯片：`x64`

打开 DMG，将 Roundtable 拖入“应用程序”即可。

> 当前公开构建在未配置 Apple Developer ID 时会使用 ad-hoc 签名。首次打开如果被 macOS 拦截，请在 Finder 中右键 Roundtable →“打开”。仓库已支持 Developer ID 签名与 Apple 公证；维护者配置对应 GitHub Secrets 后，正式发布包即可正常通过 Gatekeeper。

## 使用方式

1. 打开左下角“设置”。
2. 填写 OpenAI-compatible API 地址、模型名和 API Key。
3. 新建项目和会话，输入需要讨论的问题。
4. 回答最多三个关键上下文问题。
5. 选择并确认本轮角色，开始圆桌。
6. 先阅读压缩结论，再按需展开分歧和完整记录。

Roundtable 支持 OpenAI-compatible Chat Completions API。API Key 只保存在本机用户目录，不会提交到仓库。

## 本地开发

要求：Node.js 22+、npm 10+。

```bash
git clone https://github.com/seannnnnnnnnnnnnn/roundtable.git
cd roundtable
npm install
npm run dev
```

Web 开发地址：

- 前端：`http://127.0.0.1:5174`
- API：`http://127.0.0.1:8787`

启动桌面开发版：

```bash
npm run desktop:dev
```

生成 macOS 安装包：

```bash
npm run desktop:dist
```

产物位于 `release/`。

## 自动更新与发布

桌面版使用 GitHub Releases 作为更新源：

- 应用启动 5 秒后自动检查
- 此后每 6 小时检查一次
- Developer ID 正式签名版在后台下载，完成后提示“立即重启并更新”
- 社区签名版发现新版本后打开公开下载页，避免签名校验失败导致更新中断
- 也可以从 macOS 菜单或软件设置手动检查

推送版本标签会触发 GitHub Actions：

```bash
npm version patch
git push origin main --follow-tags
```

正式签名与公证需要在仓库 Secrets 中配置：

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

也支持 App Store Connect API Key：`APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`。

## 验证

```bash
npm run check
npm test
npm run build
npm run build:server
```

macOS 包发布前还应执行：

```bash
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/Roundtable.app"
spctl -a -vvv -t exec "release/mac-arm64/Roundtable.app"
```

只有配置 Developer ID 并完成 Apple 公证后，`spctl` 才会显示通过。

## 技术栈

React、TypeScript、Fastify、SQLite、Electron、electron-builder、electron-updater。

## 开源协议

[MIT License](LICENSE)
