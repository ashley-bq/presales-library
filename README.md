# 售前汇报素材库（presales-library）

参考飞书售前"HTML 取代 PPT + 素材库购物车"的做法：售前材料按页入库、AI 打标，按客户需求"购物车"式拼装 deck，
在网页或通过 Agent 微调后导出 zip / PPTX，讲完效果好再入库；系统自动记录**每页被谁用过、讲给哪些客户、哪页是原创、哪页是微调**。

- 共享方式：GitHub 私有仓库，每人在本机 clone 一份完整副本；网页和 Agent 的写操作会自动 commit + push。
- 草稿与导出文件只保存在本机；素材、标签、使用日志进仓库。

## 接入指南（新同事，约 10 分钟）

### 1. 获得仓库权限
请管理员在 GitHub 仓库 **Settings → Collaborators** 邀请你的 GitHub 账号，并在邮件里接受邀请。

### 2. 安装软件
- **Git**：Mac 自带（首次在终端运行 `git` 时按提示安装命令行工具）；Windows 下载 https://git-scm.com/download/win
- **Node.js LTS**（18 或更高）：https://nodejs.org
- 旧 PPTX 入库（可选）：Microsoft PowerPoint，或 LibreOffice

### 3. 设置 Git 身份（会显示在使用记录里）
```bash
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

### 4. 配置 SSH 密钥
```bash
ssh-keygen -t ed25519 -C "你的邮箱"        # 一路回车
cat ~/.ssh/id_ed25519.pub                  # Windows：type %USERPROFILE%\.ssh\id_ed25519.pub
```
把输出的整行复制到 GitHub → 右上角头像 → **Settings → SSH and GPG keys → New SSH key**，然后验证：
```bash
ssh -T git@github.com     # 看到 "successfully authenticated" 即成功
```

### 5. 下载并安装
```bash
git clone git@github.com:ashley-bq/presales-library.git
cd presales-library
npm install
npx playwright install chromium     # 用于生成缩略图和 PPTX（约 100MB）
npm run install-skill               # 为 Devin / Claude Code 等 Agent 安装 skill
npm run doctor                      # 自检，全部 ok 即可
```

### 6. 日常使用
- **打开素材库**：Mac 双击 `start.command`，Windows 双击 `start.bat`，或运行 `npm start` → 浏览器打开 http://localhost:4173
- **在 Agent 里**（Devin / Claude Code）：输入 `/presales-library`，或直接说
  - "把 ~/Downloads/某行交流.pptx 入库并打标"
  - "给 XX 银行拼一个代发长尾经营的交流 deck，10 页左右"
  - 粘贴网页上"复制 AI 改写指令"的内容，让 Agent 改写某页
  - "XX 银行那个草稿讲完效果很好，入库"
  - "看看哪些页用得最多" / "这页被谁改过"

## 配置 AI（网页内 AI 改写 / AI 自动打标）
支持任意 **OpenAI 兼容接口**（DeepSeek、通义千问、豆包、OpenAI 等）。Key 只保存在本机 `.private/config.json`（不进仓库），或用环境变量 `PSL_LLM_BASE_URL / PSL_LLM_API_KEY / PSL_LLM_MODEL`：
```bash
node bin/psl.js config llm --base-url https://api.deepseek.com/v1 --api-key sk-xxxx --model deepseek-chat
# 通义：--base-url https://dashscope.aliyuncs.com/compatible-mode/v1 --model qwen-plus
# 豆包：--base-url https://ark.cn-beijing.volces.com/api/v3 --model <接入点ID>
```
配置后重启网页。每次 AI 改写都会写入使用日志（谁、什么要求、模型、改前改后），可在草稿编辑器撤销，并显示在该页的版本树中。

## 云服务器部署（同事用网址 + 账号访问，无需安装）
准备一台 Linux 云服务器（2 核 4G 以上，已装 Docker），以及可选的域名（解析到服务器 IP，自动申请 HTTPS 证书）。
1. **生成部署密钥**，让服务器可以读写 GitHub 仓库：
   ```bash
   git clone git@github.com:ashley-bq/presales-library.git && cd presales-library   # 在服务器上，也可直接上传代码
   mkdir -p deploy/ssh && ssh-keygen -t ed25519 -N "" -C presales-server -f deploy/ssh/id_ed25519
   cat deploy/ssh/id_ed25519.pub
   ```
   把公钥添加到 GitHub 仓库 **Settings → Deploy keys → Add deploy key**，并勾选 **Allow write access**。
2. **配置**：`cp deploy/.env.example .env`，填写 `PSL_DOMAIN`（没有域名就留空）和 AI 模型的 Key。
3. **启动**：`docker compose up -d --build`（首次构建约 5–10 分钟）。
4. **开通账号**（初始密码会打印出来，发给同事）：
   ```bash
   docker compose exec app node bin/psl.js user add zhangsan --name 张三 --email zhangsan@xx.com
   docker compose exec app node bin/psl.js user list
   docker compose exec app node bin/psl.js user passwd zhangsan      # 重置密码
   ```
5. 浏览器访问 `https://你的域名`（或 `http://服务器IP`），用账号登录。
   - 服务器把素材、使用与修改记录推送到 GitHub；本地 Agent（Devin / Claude Code）用户照常 clone 仓库使用，两边通过 GitHub 自动同步（服务器每 5 分钟拉取一次）。
   - 每个人的草稿只有自己可见；提交记录的作者就是登录的账号。
   - 服务器上用 LibreOffice 渲染旧 PPTX（已内置中文字体），效果可能和 PowerPoint 略有差异。
   - 更新代码：`git pull && docker compose up -d --build`。

## 网页功能
| 页面 | 功能 |
|---|---|
| 素材库 | 搜索（需求/客户/关键词）、左侧多维筛选（同一维度内为"或"，不同维度为"且"；卡片上的标签也可点击筛选），卡片显示使用次数；点卡片查看大图、改标签（可新增标签值、AI 打标）、版本树与修改记录（含 AI 改写） |
| 上传素材 | 拖拽上传 PPTX / PDF / 图片（多张图片合成一个 deck），自动入库并用 AI 打标，卡片上标"AI打标"，打开详情确认 |
| 购物模式 | 勾选页面进入右侧购物车，拖拽排序，填写 deck 名和客户，选黑底/白底 → 生成草稿 |
| 草稿编辑器 | 页面拖拽排序、从素材库插入、按版式新建页；点击文字直接编辑、点击图片替换；**AI 改写**（写要求或点快捷要求，可撤销，自动记录）或"复制给 Agent"；导出 zip（离线 HTML 播放器，← → 翻页，F 全屏）/ PPTX（每页整图 + 备注）；"效果好，入库" |
| 使用排行 | 页面使用排行、客户案例热度、最近动态 |

## 命令行
`node bin/psl.js help` 查看全部命令（安装 skill 后也可直接用 `psl`，需把 `~/.local/bin` 加入 PATH）。

## 目录
```
library/slides/<id>/    每页：slide.html、meta.json（标签、来源、血缘）、assets/、thumb.jpg
library/decks/          入库来源记录
library/taxonomy.yaml   标签体系（可在网页中新增）
library/themes/         黄灰主题（黑底 / 白底）
library/templates/      版式模板
events/<用户>/          使用与修改日志（按人分文件，避免冲突）
app/                    本地服务与网页
bin/psl.js              命令行
.devin/skills/presales-library/   Agent skill（SKILL.md + 规范）
```

## 说明
- 使用次数 = 导出次数；导出时会记录每页是否被临时修改及修改摘要（标题、文字、图片）。
- "原创 / 微调"来自系统内的血缘关系（草稿入库时 `parent_id` 指向来源页）。
- 素材存放在 GitHub 私有仓库，请确认符合公司和客户的数据合规要求；如需迁移到内网 GitLab，只需 `git remote set-url origin <新地址>`。
