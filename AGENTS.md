# AGENTS.md

本仓库是团队共享的售前素材库。处理入库、打标、拼装 deck、改写页面、导出、再入库、使用统计等请求时，
**先阅读并遵循 `.devin/skills/presales-library/SKILL.md`**（页面规范见同目录 `references/slide-spec.md`）。

## 开发命令
- 安装：`npm install && npx playwright install chromium`
- 启动网页：`npm start`（http://localhost:4173）
- 自检：`npm run doctor`
- 命令行：`node bin/psl.js help`
- 重新生成示例旧 PPTX：`npm run samples`

## 约定
- 代码：Node ≥18、ESM、无构建步骤；网页为原生 JS（`app/public/`）。
- 业务逻辑都在 `app/lib/`，CLI（`bin/psl.js`）和服务端（`app/server.js`）只做薄封装，输出 JSON。
- 写操作完成后通过 `app/lib/git.js` 的 `commitAndPush` 同步；不要强推，不要改用户的 git 配置。
- 使用日志按人追加写入 `events/<user>/<YYYY-MM>.jsonl`，不要修改别人的日志文件。
- 不要直接修改 `library/slides/` 中已入库的页面；改动走"草稿 → promote"，以保留"原创/微调"血缘。
