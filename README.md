# Climber：拍照解抱石线路

> Snap a photo of a bouldering problem and get a technique-focused beta, checked against body-geometry rules and shown as a step-by-step animation. Work in progress.

给新手的抱石学习工具：拍下一条线，系统识别岩点，用大模型生成**运用技巧、省力优雅**的爬法（扭转、落膝、顶胯、挂脚跟……），用规则校验后逐步讲解每个动作为什么这样做，并用动画演示。

## 现在做到哪了

还在验证阶段，代码都在 [`spike/m0/`](spike/m0/)：

- **M0（已完成）**：给定点位数据，大模型（目前主要用 DeepSeek）能给出通过全部硬规则的爬法，每条线约 $0.02～0.06。校验器有 13 条硬规则（R1–R13）和 6 类提示（S1–S6），大多是从模型"钻规则空子"的真实输出里补出来的。
- **2D 动画预览**：`npm run preview` 生成单个 HTML 文件，逐步播放手脚位置和讲解。
- **G0a（进行中）**：用 Kilter Board 的真实线路验证解法。Kilter 板的孔位全球统一，几何是精确的，可以排除拍照测距的误差。
- **架构调整（第 3 版设计）**：实拍测试发现单张照片估不准岩点之间的真实距离，所以改成"每面墙建一次三维模型，照片只负责识别岩点并对齐到模型"。详见[设计文档](docs/superpowers/specs/2026-10-26-climber-demo-design.md)第 3.3、14 节。

## 快速开始

需要 Node.js 24。

```bash
cd spike/m0
npm install
npm test           # 单元测试，不调用模型
npm run m0         # 用手写的 mock 回复跑一遍完整流程，不花钱
npm run preview    # 用上一次运行的结果生成动画预览
```

调用真实模型：把 `spike/m0/.env.example` 复制为 `.env`，填入 `DEEPSEEK_API_KEY` 或 `ANTHROPIC_API_KEY`，然后运行 `npm run m0 -- --models deepseek`。更多用法见 [`spike/m0/README.md`](spike/m0/README.md)。

## 技术栈

TypeScript（Node.js 24）、Zod、Vitest；模型通过可插拔接口接入 Claude（`@anthropic-ai/sdk`）和兼容 OpenAI 接口的服务（DeepSeek 等）。之后计划用 Next.js 做手机网页，three.js 做 3D 动画，Python 几何服务做墙面建模。

## 数据说明

- **Kilter 线路数据不在仓库里**。它来自 Kilter 官方 App，授权不明确。需要的话自己下载 [Hugging Face 上的公开快照](https://huggingface.co/datasets/Vilin97/KilterBoard)（`kilter_splits.sqlite`）到 `spike/m0/data/`，再用 `npm run kilter` 在本地导出线路。只建议用于个人学习和评测。
- **岩馆实拍照片不在仓库里**。`routes/d-gym-blue-tag-yellow.json` 的预览在没有照片时会按坐标画墙面。
- `routes/` 里的 A、B、C 三条是构造的样例线路。

## 许可证

[MIT](LICENSE)
