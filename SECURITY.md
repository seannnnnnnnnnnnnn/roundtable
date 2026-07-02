# 安全说明

## 数据与密钥

Roundtable 的项目、会话、讨论记录和 Provider 配置默认保存在本机。API Key 不会通过产品接口回传，也不应被提交到 Git。

## 报告安全问题

请不要在公开 Issue 中披露可被利用的漏洞或真实密钥。请通过 GitHub 仓库的私密安全报告功能提交。

## 桌面发布

只有经过 Apple Developer ID 签名并完成 Apple 公证的 macOS 安装包，才应被描述为 Gatekeeper 可直接验证。ad-hoc 构建主要用于开发、测试和开源预览。
