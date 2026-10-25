# 交接文档 — 售前素材库（银行数智化）

> 给下一个接手的 Agent / 同事看的。读完这份文档就能开工。
> 日期：2026-10-26

## 这是什么

团队共用的售前材料库：把售前 PPT/PDF 按页转成 HTML 入库、AI 自动打标，按客户需要检索拼 deck，
网页里改写/AI 改写，导出 zip 离线包或 PPTX（整页图 + 演讲者备注），并记录每页的使用和修改血缘。
银行数智化方向（条线 / 场景专题 / 内容类型 / 目标客户 / 汇报类型 五维标签）。

## 三条必读

1. `AGENTS.md` — 仓库规则；
2. `.devin/skills/presales-library/SKILL.md` — 所有素材库操作的唯一权威流程（入库、打标、拼 deck、改写、导出、promote、记录）。**不读这个不许动素材库**；
3. `deploy/OPERATIONS.md` — 云端服务器运维、账号管理、换电脑步骤。

## 当前状态（2026-10-26）

| 项 | 状态 |
|---|---|
| 素材库 | **120 页 / 2 个真实 deck**，全部已 AI 打标：常熟农商综合经营（88 页）、嘉兴银行零售财富（32 页） |
| 云端网页 | http://49.232.207.25 （HTTP，腾讯云轻量 2C4G，Docker 部署，5 分钟自动与 GitHub 双向同步） |
| 云端账号 | `ashley`（admin，密码问 Ashley 或 `psl user passwd` 重置） |
| AI 模型 | DeepSeek 已配置：服务器 `.env` + 部署机本机 `psl config llm`。**Key 不在仓库里** |
| Git | `git@github.com:ashley-bq/presales-library.git`（private），main 为唯一分支，工作区干净 |

## 架构速览

- 仓库本身既是**代码**也是**数据**：`app/`（Node 服务+网页）、`bin/psl.js`（CLI）、`library/`（slides/decks/taxonomy/themes）、`events/<user>/<YYYY-MM>.jsonl`（按人分开的使用/修改日志）。
- 每个用户本地跑 `node bin/psl.js serve`（4173，本地模式无需登录）；云端容器跑 `--server`（登录、草稿按人隔离、写串行）。
- 代码根 vs 数据根：`PSL_DATA_DIR` 分开；`psl where` 看当前指向。
- 写路径都过 `app/lib/git.js` 的 `commitAndPush`；草稿 `drafts/` 和导出 `exports/` 只在本机、不进 Git。
- 血缘：`meta.json` 的 `parent_id`/`root_id`；"原创/微调"靠 draft → promote 流程产生，**禁止直接改 `library/slides/`**。

## 明天开工（新电脑 / 新 Agent）

```bash
git clone git@github.com:ashley-bq/presales-library.git
cd presales-library
npm install && npx playwright install chromium   # 首次约 2-5 分钟
node bin/psl.js doctor                          # 自检
node bin/psl.js serve                           # 本地模式 http://localhost:4173
```

- 访问私有库：新机器生成 SSH key 加到 GitHub，或 HTTPS + PAT。
- 本地 AI：`node bin/psl.js config llm --base-url https://api.deepseek.com/v1 --api-key <key> --model deepseek-chat`；不配也能用——网页端 AI 走服务器的 Key。
- 开场白模板见 `deploy/OPERATIONS.md`"换 Agent/电脑时的开场白"一节。

## 待办（按优先级）

1. **校验 AI 打标质量**：抽查已入库 120 页的标签，错的在网页详情里手改；标签体系要扩就改 `library/taxonomy.yaml`。
2. **域名 + HTTPS**：买个域名解析到 49.232.207.25 → 服务器 `.env` 填 `PSL_DOMAIN=` → `docker compose up -d`，Caddy 自动签证书。
3. **给同事开账号**：`sudo docker exec presales-app-1 node /app/bin/psl.js user add <用户名> --name 姓名 --email 邮箱 --password 初始`。
4. **走通一次完整业务流**：上传 → 打标确认 → 拼 deck → AI 改写 → 导出 PPTX → 讲完 promote 微调版 → 看使用排行/版本树。
5. 小坑备忘：macOS 导入 PPTX 用 PowerPoint 渲染首次会弹"授予访问权限"；`npm audit` 有一条 image-size（pptxgenjs 依赖）告警未处理。

## 不要做的事

- 不要改用户的 git 全局配置；不要 force push；不要改别人的 `events/<user>/` 日志。
- 不要把 API Key、密码提交进仓库（`.env`、`.private/`、`deploy/ssh/` 都在 .gitignore）。
- 不要直接编辑已入库页面——走 draft → promote，否则丢血缘。
