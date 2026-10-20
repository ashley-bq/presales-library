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

## 网页功能
| 页面 | 功能 |
|---|---|
| 素材库 | 搜索（需求/客户/关键词）、左侧多维筛选（条线/场景专题/内容类型/目标客户/汇报类型/客户/原创或微调/来源 deck），卡片显示使用次数；点卡片查看大图、改标签（可新增标签值）、版本树与修改记录 |
| 购物模式 | 勾选页面进入右侧购物车，拖拽排序，填写 deck 名和客户，选黑底/白底 → 生成草稿 |
| 草稿编辑器 | 页面拖拽排序、从素材库插入、按版式新建页；点击文字直接编辑、点击图片替换；"复制 AI 改写指令"交给 Agent；导出 zip（离线 HTML 播放器，← → 翻页，F 全屏）/ PPTX（每页整图 + 备注）；"效果好，入库" |
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
