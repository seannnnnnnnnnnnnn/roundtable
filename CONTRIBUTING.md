# 参与贡献

感谢你参与 Roundtable。

## 开发流程

1. Fork 仓库并创建功能分支。
2. 运行 `npm install`。
3. 修改代码并补充相应测试。
4. 提交前运行：

```bash
npm run check
npm test
npm run build
npm run build:server
```

5. 提交 Pull Request，说明问题、改动和验证方式。

## 角色 Markdown

底层角色位于 `server/prompts/roles/`。角色改动应保持：

- 明确的任务、目标函数与判断边界
- 支持者和反对者的独立立场
- 不默认进行道德裁判
- 不让综合输出引入讨论中没有出现的新事实
- 前台摘要遵守表达压缩规则

请勿在 Issue、日志或示例中提交 API Key、私人讨论数据或其他敏感信息。
