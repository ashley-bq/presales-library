---
name: presales-library
description: 售前素材库：把售前材料按页入库并打标，按客户需求检索拼装 deck、改写某页、导出 zip/PPTX，记录每页的使用与修改（银行数智化）。当用户提到入库、打标、拼 deck、给某客户做材料、改某页、导出、讲完入库、使用统计、版本历史时使用。
argument-hint: "[入库 <文件> | 拼装 <需求> | 改写草稿 <draftId> 第 N 页：<要求> | 导出 <draftId> | 统计]"
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# 售前素材库（presales-library）

团队共享的售前素材库：每一页是一个 HTML 片段（`<section class="slide">`），存放在共享 Git 仓库里；
每个人在本机有一份完整副本，网页和本 skill 共用同一个命令行工具 `psl`，写操作会自动 commit + push。

## 0. 定位工具

1. 优先直接运行 `psl …`。
2. 找不到 `psl` 时，读取 `~/.presales-library.json` 中的 `root`，运行 `node "<root>/bin/psl.js" …`。
3. 都没有时：本 skill 文件位于 `<root>/.devin/skills/presales-library/SKILL.md`，据此推出 root。

所有命令输出 JSON。遇到错误先运行 `psl doctor`，按其中 `fix` 字段提示用户（Git 身份、SSH、Chromium 等）。
**不要**修改用户的 git 配置；身份未设置时请用户自己执行 `git config --global user.name/user.email`。

## 1. 入库 + AI 打标

- HTML deck：`psl ingest-html <file.html> --title "标题" [--customer 客户] [--theme dark|light] --slug <英文短名>`
  - 新做的 deck 必须遵循 `references/slide-spec.md`（每页一个 `<section class="slide">`，可编辑文字加 `data-editable`）。
- 旧 PPTX：`psl import-pptx <file.pptx> --title "标题" --slug <英文短名>`
  - 主标题会转成 HTML 文字，整页渲染成一张图（Mac 用 PowerPoint，首次会弹"授予访问权限"，请提醒用户点允许；Windows 用 PowerPoint COM；否则用 LibreOffice）。
- PDF：`psl import-pdf <file.pdf> …`；图片：`psl import-images a.png b.jpg … --title "标题"`（多张合成一个 deck）；或用 `psl ingest <文件>` 按扩展名自动选择。
- 用户也可以在网页右上角"上传素材"里直接拖拽上传（支持 AI 自动打标）。
- `--slug` 用 2–4 个英文/拼音单词（如 `retail-payroll`），用于生成页面 id。
- 若已配置 AI 模型（`psl config llm` 显示 `enabled: true`），可直接 `psl ai-tag <id…>` 自动打标，然后检查结果、必要时用 `psl tag` 修正；否则按下面的步骤自己打标。
- 入库输出中的 `untagged` 列出新页的标题和全文。**由你来打标**：
  1. `psl taxonomy` 查看标签体系（条线 / 场景专题 / 内容类型 / 目标客户 / 汇报类型）。
  2. 为每页写 JSON（可以使用新值，会自动加入标签体系，但优先复用已有值）：
     ```json
     { "<slideId>": { "tags": { "条线": ["零售"], "场景专题": ["代发"], "内容类型": ["方法论"], "目标客户": ["股份行"], "汇报类型": ["交流"] },
                      "customer": "", "scope": "universal" } }
     ```
     - 出现具体客户名、客户数据的页面：`customer` 填客户名，`scope` 为 `customer-specific`；通用页为 `universal`。
     - 内容类型参考：封面目录 / 方法论 / 举例 / 融合一页（一页讲清全貌）/ 案例 / 数据洞察 / 产品介绍。
  3. 写到临时文件后运行 `psl tag --file <tags.json>`（会自动同步）。
- 随时可用 `psl untagged` 找出待打标页。

## 2. 拼装 deck（购物车）

用户说"给 XX 行拼一个代发交流的 deck"时：
1. 拆出检索条件，用 `psl search <关键词…> [--filter '{"条线":["零售"],"目标客户":["股份行"]}'] --limit 30` 检索；可多次检索不同角度（封面、方法论、案例、数据）。
2. 按讲述逻辑（封面 → 洞察/痛点 → 方法论 → 方案/融合一页 → 案例 → 总结）给出页面清单表格（序号、标题、id、来源、用过几次），**先请用户确认**。
3. 确认后创建草稿：`psl draft create --name "<deck 名>" --customer "<客户>" --theme dark|light --slides id1,id2,…`
4. 告诉用户草稿 id，并提示打开网页（`psl serve --open`，地址 http://localhost:4173/#/draft/<draftId>）拖拽排序、直接改字换图。

缺页时：`psl draft insert <draftId> --layout <cover|section|bullets|method|data|case|compare|fusion|image-text> --pos <下标>`，再按第 3 节改写该页。

## 3. 改写某页（AI 改写）

用户会粘贴网页上"复制给 Agent"的内容，形如 `改写草稿 <draftId> 第 N 页（key=…，文件 drafts/<draftId>/slides/<key>/slide.html）：<要求>`。
（用户也可以直接在网页里点"AI 改写"，由服务器调用配置好的模型完成。）

**每次 AI 改写都必须留下记录**，按以下顺序：
1. `psl draft checkpoint <draftId> <key>`（打检查点，输出 `html_file`）；读取该文件以及 `library/themes/theme.css`、`references/slide-spec.md`。
2. 编辑这个 slide.html：保持唯一的根元素 `<section class="slide …" data-layout="…">`，保留 `data-editable` / `data-replaceable` 标记，只用主题里的 class 和 CSS 变量，图片放同目录 `assets/`。
3. 改完立即记录：`psl draft log-edit <draftId> <key> --instruction "<用户的改写要求>" --by "<你的名字，如 Devin>"`。
   这会写入使用日志（谁、什么要求、改前改后标题、增删的文字），在网页的版本树和该页的"AI 改写记录"中可见，也可在网页上撤销。
4. 不要改 draft.json 里的 `source_id`/`base_hash`/`ai_edits`（系统靠它判断"微调"和记录修改）。
5. 网页会自动刷新；告诉用户改了什么。
- 如果已配置模型且用户只想快速改一页，也可以用 `psl ai-rewrite <draftId> <key> --instruction "要求"`（同样会记录）。
- 只改草稿，**不要**直接改 `library/slides/` 下的页面。

## 4. 导出与"讲完再入库"

- 导出：`psl export <draftId> [--formats zip,pptx]` → 文件在 `exports/<draftId>/`。导出会记一次"使用"，并把每页的修改摘要写入使用日志。
- 讲完效果好：`psl promote <draftId> [--keys k1,k2] --note "效果说明"` → 改过的页成为"微调"新页（`parent_id` 指向原页），新建页成为"原创"。
  之后对输出中 `tagged:false` 的新页按第 1 节打标。

## 5. 统计与追溯

- `psl stats`：页面使用排行（导出次数、使用人、讲给哪些客户、被临时修改次数）和客户案例热度。
- `psl history <slideId>`：版本树（原创 → 微调）、每次临时修改的记录，以及每次 AI 改写（`ai_edits`：要求、模型、改动）。
- `psl show <slideId>`：元数据、HTML 文件路径、版本树。
- 用中文简洁汇总给用户，必要时用表格。

## 6. 同步与排错

- `psl sync`：拉取别人更新并推送本地积压的提交。冲突或推送失败时，把 JSON 中的 `error` 告诉用户，不要强推（`--force`）、不要改写历史。
- 草稿（`drafts/`）和导出文件（`exports/`）只在本机，不进仓库；素材、标签、使用日志（`events/<用户>/`）进仓库。
