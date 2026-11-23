# Big Flower · 朝花手帖 (`bigflower-today`)

抓取 [Big Flower 到货时间页](https://bigflower.co.jp/touchaku/index.php) 与 [ビックフラワー FC2 仕入れ情報博客](http://bigflowersugi.blog.fc2.com/)，只筛选**切花**，展示今日是否进货、几点到货、实拍到货图片，并支持：

- **硬规则主解析 + Cloudflare Clef 27B 决策质检 + GPT-OSS 120B 免费兜底 + 邮件告警**：
  - 日常 0 成本硬规则秒级解析，由 Cloudflare Workers AI 免费层的 **`@cf/cloudflare/clef`**（27B 决策模型，不收输出 token 费）自动检查是否截断、混入盆栽或列错位；
  - 一旦判定解析异常，立即由 Workers AI 免费层的 **`@cf/openai/gpt-oss-120b`** 自动兜底抽取切花保证网站正常展示，并通过 Cloudflare 原生 `sendEmail` 绑定将诊断原因与原文样本直发 `hanzhangzhai@gmail.com`（前台界面不弹告警横幅）。
- **OpenRouter `deepseek/deepseek-v4.1-flash-1017` 花名清洗与中英文对照**：
  - 经 89 种真实切花盲测优选，日本花市行话与中文花艺圈译名准确；
  - 每次识别后写入 D1，任意用户点「确认落库」或「修改」即永久锁定为词典条目，后续进货直接命中词典不再调 AI。
- **后台定时自动抓取与翻译（Cron）+ 生产环境零公开 AI 入口**：
  - 日本时间周一/三/五 `08:00-12:00` 每 15 分钟自动抓取并翻译词典外的新切花，每日 `18:30` 兜底巡检；
  - 生产环境彻底关闭所有 HTTP 触发 AI 的接口（仅 Cron 内部调用），彻底杜绝外部刷额度；词典确认与编辑保持开放共享。

## 本地运行

1. 安装依赖：

```bash
npm install
```

2. 安全保存 OpenRouter API Key（输入不回显、不留 shell 历史）：

```bash
npm run set-openrouter-key
```

3. 启动本地开发服务：

```bash
npm run dev
```

4. 运行测试与构建检查：

```bash
npm test
npm run typecheck
npm run build
```

## 部署到 Cloudflare（使用 `cf` CLI）

1. 登录 Cloudflare 并创建 D1 数据库：

```bash
cf auth login
cf d1 create bigflower-today-db
```

2. 应用数据库迁移并部署（含 Workers AI、Email Sending 与 Cron 定时任务）：

```bash
cf d1 migrations apply bigflower-today-db
npm run deploy
```

3. 上传 OpenRouter Secret：

```bash
npx wrangler secret put OPENROUTER_API_KEY --name bigflower-today
```
