# HTML 幻灯片规范

## 基本结构

- 画布固定 **1920 × 1080**（16:9），由 `library/themes/theme.css` 控制；主题通过 `<body class="theme-dark">` 或 `theme-light` 切换，**页面里不要写死颜色**，使用 CSS 变量：
  `--bg --surface --surface-2 --line --text --text-2 --muted --accent --accent-2 --accent-soft`
- 一页 = 一个根元素，不允许嵌套 `<section>`：
  ```html
  <section class="slide layout-<版式>" data-layout="<版式>">
    …
  </section>
  ```
- deck 文件（用于 `psl ingest-html`）是完整 HTML，`<title>` 为 deck 标题，`<body>` 内依次放多个 `<section class="slide">`：
  ```html
  <!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>零售-代发长尾经营</title>
  <link rel="stylesheet" href="<root>/library/themes/theme.css"></head>
  <body class="theme-dark"> <section class="slide …">…</section> … </body></html>
  ```
- 每页的标题用 `<h1>`（封面/章节）或 `<h2>`（内容页），系统据此提取页面标题。
- 所有可在网页中直接修改的文字加 `data-editable`；可替换的图片加 `data-replaceable`。
- 图片用相对路径（入库时自动复制到该页的 `assets/`）。不要引用外网资源，不要写 `<script>`。

## 版式（`library/templates/*.html` 可直接复制）

| 版式 | class | 适用 |
|---|---|---|
| cover | `layout-cover` | 封面：`.bar` + `.kicker` + `h1` + `.lead` + `.meta` |
| section | `layout-section` | 章节页：`.num` 描边大号数字 + `h1` |
| bullets | `layout-bullets` | 观点要点：`h2` + `ul.points` |
| method | `layout-method` | 方法论：`.steps > .step(.n, h3, p)`，3–5 步 |
| data | `layout-data` | 数据：`.kpis > .kpi(.num > small, .label)` |
| case | `layout-case` | 案例：`.case > .challenge + .result(.kpi)` |
| compare | `layout-compare` | 对比：`.vs > .before + .after` |
| fusion | `layout-fusion` | 融合一页：`.fusion` 网格，`.row-label` + `.row > .cell` |
| image-text | `layout-image-text` | 左文右图：`.grid-2` + `img` |
| image-page | `layout-image-page` | 旧 PPTX 入库页：`h2` 标题 + `.page-image img` |

通用组件：`.kicker`（小标题，黄色）、`.lead`（导语）、`.card`、`.grid-2/3/4`、`.tag`、`.hl`（黄色强调）、`.muted`、`.footer`（页脚两端文字）。

## 写作要求（银行数智化售前）

- 一页一个结论：标题写成结论句（"代发客群：规模大、活跃低、价值待挖掘"），而不是名词。
- 正文每页不超过 6 条要点、每条不超过 30 字；数字用 `.kpi` 突出。
- 客户数据和案例要脱敏，或在页脚注明"示例数据"；出现客户名的页面打标为 `customer-specific`。
- 黄色（`--accent`）只用于强调关键信息，每页不超过 3 处。
