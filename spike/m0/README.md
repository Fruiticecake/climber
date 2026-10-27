# M0 验证：大模型能不能给出技巧型抱石爬法

设计文档见 [../../docs/superpowers/specs/2026-10-26-climber-demo-design.md](../../docs/superpowers/specs/2026-10-26-climber-demo-design.md) 第 14 节。

## 做什么

读取 `routes/` 下手写的线路数据 → 用 `config/techniques.yaml` 组装提示词 → 调用 `config/models.yaml` 里选定的模型 → 用规则校验每个候选，不通过就带着违规原因重试（最多 2 次）→ 在 `reports/` 下生成对比报告，由你判断爬法质量。

## 运行

```bash
npm install
npm test                                   # 单元测试，不花钱
npm run m0                                 # 只用 mock，不花钱
npm run m0 -- --models claude-haiku-5-5    # 真实调用，先用最便宜的
npm run m0 -- --models claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5,deepseek --routes a-sidepull-twist
npm run preview                            # 用 reports/ 里最新一次运行生成 2D 动画预览
npm run preview -- --log reports/m0-xxx.json --route d-gym-blue-tag-yellow --model deepseek
```

真实调用前，把 `.env.example` 复制为 `.env` 并填入对应的 Key。`--candidates` 可以调整每次要几个候选（默认 2）。

每次运行在 `reports/` 下写一份 Markdown 报告和一份同名 JSON。`npm run preview` 读 JSON，生成 `reports/preview-<线路>-<模型>.html`，是单个文件，直接用浏览器打开。线路有 `photo` 并且照片文件存在时用照片做背景，否则按坐标画墙面。

## 目录

| 路径 | 说明 |
|---|---|
| `routes/*.json` | 线路数据。现在的三条是 Claude 构造的样例，请换成你爬过的真实线路 |
| `config/techniques.yaml` | 技巧词典初稿，待你审核 |
| `config/models.yaml` | 可选模型和单价；DeepSeek 的模型名、地址和价格请按官网填写 |
| `fixtures/mock/*.json` | mock 的剧本回复，由 Claude Code 手写 |
| `src/verify.ts` | 规则校验器，阈值常量在文件开头 |
| `src/prompt.ts` | 提示词 |

## 写一条真实线路

坐标单位 cm，原点在墙面左下角，y 轴向上。岩点给中心和半径；`role` 必须包含至少一个 `start-hand` 和一个 `top`；`type`、`pullDirDeg`（0 往下拉，90 往右拉，180 反提，270 往左拉）是可选的。可以照着 `routes/a-sidepull-twist.json` 改。

可选的 `photo` 只给预览用，不会交给模型：照片像素 x = `originX` + x × `pxPerCm`，y = `originY` − y × `pxPerCm`。参考 `routes/d-gym-blue-tag-yellow.json`。
