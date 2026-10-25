# 线上部署与运维

## 现状（2026-10-26）

- **访问地址**：http://49.232.207.25 （HTTP；配域名后改 HTTPS）
- **服务器**：腾讯云轻量应用服务器，2核4G，Ubuntu 24.04 + Docker 29
- **登录账号**：`ashley`（admin）。密码问管理员或登录服务器用 `psl user passwd` 重置
- **素材库**：已通过 GitHub `ashley-bq/presales-library` 同步；当前为空，等待导入真实材料
- **AI**：DeepSeek（`deepseek-chat`），Key 在服务器 `.env`（不在 Git 里）

## 服务器管理

```bash
# 登录（私钥在最初部署的 Mac：~/.ssh/psl-server）
ssh -i ~/.ssh/psl-server ubuntu@49.232.207.25

# 部署目录 ~/presales；数据在 deploy/data/（repo=素材库 clone，private=账号会话）
cd ~/presales
sudo docker compose ps            # 状态
sudo docker compose logs -f app   # 日志
sudo docker compose restart app   # 重启
sudo docker compose up -d --build # 更新代码后重建

# 账号管理
sudo docker exec presales-app-1 node /app/bin/psl.js user list
sudo docker exec presales-app-1 node /app/bin/psl.js user add <用户名> --name 姓名 --email 邮箱 --password 初始密码
sudo docker exec presales-app-1 node /app/bin/psl.js user passwd <用户名> --password 新密码

# 强制与 GitHub 同步（平时每 5 分钟自动 pull/push）
sudo docker exec presales-app-1 node /app/bin/psl.js sync
```

代码更新流程：本地改完 push 到 GitHub → 服务器 `git pull`（在 ~/presales 目录）→ `docker compose up -d --build`。
`deploy/data/` 是持久数据，重建容器不丢。

## 换一台电脑继续工作

**只用网页**（最快）：浏览器打开 http://49.232.207.25 登录即可，不用装任何东西。上传素材、AI 打标、拼 deck、AI 改写、导出全在网页里。

**要用 Agent（Devin / Claude Code）**：
1. 装 Node ≥18 和 Git；
2. `git clone git@github.com:ashley-bq/presales-library.git`（本机 GitHub 需有权限）；
3. 进目录跑 `node bin/psl.js install-skill`，skill 随仓库自带；
4. 本地模式 `node bin/psl.js serve`，或直接让 Agent 按 `.devin/skills/presales-library/SKILL.md` 操作。

**要 SSH 管服务器**（新电脑没有私钥时）：
1. 新电脑生成公钥：`ssh-keygen -t ed25519`，复制 `~/.ssh/id_ed25519.pub` 内容；
2. 腾讯云控制台 → 轻量应用服务器 → 免密登录网页终端，执行：
   `echo "<公钥>" >> ~/.ssh/authorized_keys`
3. 之后新电脑即可 `ssh ubuntu@49.232.207.25`。

## 待办

- [ ] 配域名 → Caddy 自动签发 HTTPS（`.env` 里填 `PSL_DOMAIN=` 后 `docker compose up -d`）
- [ ] 给同事开账号
- [ ] 上传真实素材验证 AI 打标质量
