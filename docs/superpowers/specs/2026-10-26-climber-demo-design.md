# Climber Demo 设计文档：拍照解抱石线路

- 日期：2026-10-26
- 状态：待审阅
- 范围：Web Demo（手机浏览器），用于验证主链路，并作为作品集项目

## 1. 目标与范围

### 1.1 一句话目标

用户在岩馆拍下一面抱石墙，点选一条线的颜色，系统识别出这条线的所有岩点；用户标出起点和 TOP 后，系统生成一套**运用技巧、省力优雅**的爬法，用 3D 胶囊人演示，并逐步讲解每个动作为什么这样做，帮助新手提升技巧。

### 1.2 本版包含

1. 拍照或上传照片，在本地缩到长边 1024 像素
2. 点选取色识别同色岩点，可调颜色容差，可手动增删点位
3. 标注起点手点（1～2 个）、起点脚点（可选）、TOP；可选标注岩点类型和受力方向
4. 输入身高（臂展可选，默认等于身高），拖动、缩放半透明人形对齐起点来确定比例尺
5. 解法生成：可插拔大模型给出 2～3 个候选 → 规则校验 → 带违规原因重试 → 规则搜索兜底 → 按优雅度排序
6. three.js 胶囊人动画：播放、暂停、逐步查看、拖动旋转视角
7. 每一步的讲解：动作、技巧、为什么、新手常见错误
8. 路线数据存在本地（`localStorage`），可以导出和导入 JSON

### 1.3 本版不做（YAGNI）

账号体系、社区、云端存储、视频上传与姿态提取、全自动颜色聚类、物理仿真、训练专用模型、导入真实人物模型。

### 1.4 成功标准

- 在中端手机上，从拍照到出现动画的全流程可以走通
- 识别：合成测试图上点位数量和中心位置准确；真实照片经过少量手动修正即可用
- 解法：评测集上，硬规则通过率和优雅度可以量化，并能在不同模型之间对比
- 没有 API Key 时，整条链路也能用算法模式跑通

## 2. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 框架 | Next.js（App Router）+ TypeScript | 前后端在同一个仓库，`/api/solve` 和页面一起部署到 Vercel |
| 视觉 | 自己写的轻量算法（HSV 阈值、形态学运算、连通区域） | 需求简单；避免加载约 8MB 的 OpenCV.js；纯函数，方便测试 |
| 3D | three.js | 胶囊人加平面墙，能表达扭转、落膝、顶胯 |
| 校验 | Zod | 校验模型输出的 JSON 和接口入参 |
| 模型 | 可插拔：Anthropic 官方 SDK `@anthropic-ai/sdk`、OpenAI 兼容接口（DeepSeek 等）、Mock | 控制成本，方便对比效果 |
| 配置 | YAML（`yaml` 包） | 技巧词典和评分权重由用户手工调整，YAML 比 JSON 好写 |
| 测试 | Vitest、Playwright | 单元测试、集成测试、手机视口 E2E |

## 3. 架构

### 3.1 主链路

```
拍照 → 识别 → 编辑标注 → 定比例 → 解法生成 → 3D 动画 + 讲解
```

### 3.2 目录结构

```
src/
├── app/
│   ├── page.tsx                  # 分步向导式页面
│   └── api/solve/route.ts        # 解法接口：调用模型 → 校验 → 重试 → 兜底
├── features/                     # UI，按步骤划分
│   ├── capture/                  # 拍照、上传、缩放
│   ├── detect/                   # 点选取色、容差滑块、灰化其他颜色
│   ├── editor/                   # 增删点位、标角色、标类型和受力方向箭头
│   ├── calibrate/                # 身高臂展输入、人形拖动缩放
│   └── player/                   # three.js 场景、播放控制、讲解面板
├── lib/                          # 纯函数，不依赖 DOM，前后端共用
│   ├── vision/                   # rgbToHsv, colorMask, morphology, connectedComponents, detectHolds
│   ├── body/                     # 由身高臂展推导身体尺寸
│   ├── beta/
│   │   ├── types.ts              # Hold, Pose, BetaStep 等
│   │   ├── simulate.ts           # BetaStep[] → Pose[]
│   │   ├── verify.ts             # 硬规则和软规则
│   │   ├── score.ts              # 优雅度评分
│   │   ├── search.ts             # A* 兜底搜索
│   │   ├── violations.ts         # 违规原因渲染成中文
│   │   └── narrate.ts            # 兜底步骤的模板讲解
│   ├── solver/
│   │   ├── provider.ts           # SolverProvider 接口
│   │   ├── anthropic.ts
│   │   ├── openai-compat.ts
│   │   ├── mock.ts
│   │   ├── prompt.ts             # 组装提示词，包括技巧词典
│   │   ├── schema.ts             # 模型输出的 Zod schema
│   │   └── orchestrate.ts        # 候选 → 校验 → 重试 → 兜底 → 排序
│   └── ik/                       # 双骨骼 IK、姿态插值
config/
├── techniques.yaml               # 技巧词典（用户维护）
├── scoring.yaml                  # 优雅度权重（用户维护）
└── models.yaml                   # 前端可选的模型白名单
eval/
├── routes/                       # 评测集：照片、标注、参考爬法
└── run-eval.ts                   # 手动运行，输出各模型对比表
```

依赖方向：`features → lib`、`app/api → lib`，`lib` 不依赖 `features`，也不依赖 React。

## 4. 识别（`lib/vision`）

1. 解码照片，把长边缩到 1024 像素，得到 `ImageData`
2. 用户点一下某个岩点，取点击处 5×5 区域的 HSV 中位数作为参考色
3. 掩膜条件：色相差 ≤ `hueTol`（默认 12°，可用滑块调），饱和度 ≥ `minSat`，亮度在 `[minVal, maxVal]` 之间
4. 形态学处理：先开运算（3×3）去掉噪点，再闭运算（5×5）填补镁粉造成的空洞
5. 连通区域标记（两遍扫描加并查集），过滤掉面积不在 `[minArea, maxArea]` 之间的区域（按图片面积比例设定）
6. 输出 `DetectedHold { id, cx, cy, bbox, areaPx, radiusPx }`；其他颜色的像素显示为灰色
7. 用户可以点击删除误识别的点，也可以长按空白处手动加点

## 5. 比例尺与身体模型（`features/calibrate`、`lib/body`）

- 用户输入身高 H（必填）和臂展（可选，默认等于 H）
- 在照片上叠一个按 H 绘制的半透明人形，用户拖动、缩放它，让手和脚对齐起点手点和地面
- 人形的像素高度 ÷ H 得到 `pxPerCm`，所有点位换算成厘米坐标（原点在地面左侧，y 轴向上）
- 身体尺寸推导（比例系数是命名常量，见 `lib/body/constants.ts`）：

| 推导值 | 公式 |
|---|---|
| 肩宽 | 0.23H |
| 单臂长 | (臂展 − 肩宽) / 2 |
| 肩高 | 0.82H |
| 腿长（髋到脚底） | 0.53H |

## 6. 数据结构（`lib/beta/types.ts`）

```ts
type Limb = 'LH' | 'RH' | 'LF' | 'RF'

interface Hold {
  id: number
  x: number; y: number; r: number            // 单位 cm
  role: 'start-hand' | 'start-foot' | 'top' | 'normal'
  type?: 'jug' | 'crimp' | 'sloper' | 'pinch' | 'pocket' | 'volume'
  pullDirDeg?: number                        // 受力方向：0° 往下拉，90° 侧拉，180° 反提
}

interface Body { heightCm: number; armSpanCm: number }

type Pose = Record<Limb, number | null>      // 点位 id；脚为 null 表示踩墙或悬空

type Grip = 'pull' | 'side-pull' | 'undercling' | 'gaston' | 'pinch' | 'push'
type FootTech = 'front' | 'inside-edge' | 'outside-edge' | 'heel-hook' | 'toe-hook' | 'smear' | 'flag'

interface BetaStep {
  limb: Limb
  to: number | null                          // 只有 smear 和 flag 可以是 null
  grip?: Grip                                // 手的步骤
  foot?: FootTech                            // 脚的步骤
  hips: 'square' | 'left-in' | 'right-in'
  hipsToWall: 'close' | 'normal' | 'far'
  motion: 'static' | 'deadpoint' | 'dyno'
  techniques: string[]                       // 对应 techniques.yaml 里的 id
  note: string                               // 这一步做什么
  why: string                                // 为什么这样做
  commonMistake?: string                     // 新手常见错误
}

interface Beta {
  label: string                              // 比如"技巧解""稳妥解"
  startPose: Pose
  steps: BetaStep[]
  source: 'model' | 'hybrid' | 'fallback' | 'user'
}
```

约束：每一步只移动一个肢体；`simulate(startPose, steps)` 生成 `Pose[]`，校验器和动画都消费它。

## 7. 解法生成

### 7.1 SolverProvider 接口

```ts
interface SolverInput {
  holds: Hold[]; body: Body; startPose: Pose
  image?: { base64: string; mediaType: 'image/jpeg' }  // 只有模型支持看图时才发送
  techniques: TechniqueEntry[]
  candidates: number                         // 默认 3
}
interface SolverProvider {
  readonly id: string
  readonly supportsVision: boolean
  solve(input: SolverInput, history: ConversationTurn[]): Promise<SolverOutput>
}
interface SolverOutput {
  rawTurn: ConversationTurn                  // 原样保留，重试时追加到对话里
  betas: unknown                             // 由 schema.ts 用 Zod 解析
  usage: { inputTokens: number; outputTokens: number; estimatedUsd: number }
}
```

实现：

| Provider | 说明 |
|---|---|
| `AnthropicProvider` | 官方 SDK；默认模型 `claude-opus-5-5`，可通过配置换成 `claude-sonnet-5-5`、`claude-haiku-5-5`；用流式请求加 `finalMessage()`；自适应思考；开启服务端 `fallbacks: "default"`；重试时把 `response.content` 整块原样追加 |
| `OpenAICompatProvider` | 通过 `baseURL` 适配 DeepSeek 等兼容 OpenAI 接口的服务；`supportsVision` 按模型配置 |
| `MockProvider` | 从 `eval/` 或测试样例读取预设回复，零成本；可以按剧本返回合法、违规或格式错误的回复 |

配置（环境变量，只在服务端读取）：`SOLVER_PROVIDER`、`SOLVER_MODEL`、`SOLVER_BASE_URL`、`SOLVER_API_KEY`、`SOLVER_DAILY_LIMIT`。前端只能从 `config/models.yaml` 的白名单里选择模型 id，不能传入 URL 或 Key。

### 7.2 输入降级

一律发送文字版点位数据（编号、归一化坐标、半径、角色、类型、受力方向）。模型支持看图时，额外附上标了编号的照片，并要求模型补充判断岩点类型和受力方向。不支持看图的模型照样可以出解法。

### 7.3 编排流程（`orchestrate.ts`）

```
第 1 次调用（要求 N 个候选）
  → Zod 解析 → 每个候选 simulate + verify
  → 有候选通过硬规则？
       是 → 按优雅度排序，返回
       否 → 取违规最少的候选，把违规原因追加到对话里 → 重试（最多 MAX_RETRIES = 2）
  → 重试用完仍不通过
       → 从模型最后一个合法姿态开始 A* 搜索补完 → source: 'hybrid'
       → 补不上 → 从起点开始完整 A* 搜索 → source: 'fallback'
       → 仍然无解 → 返回无解，附带卡住的步骤和点位
```

接口：`POST /api/solve`，请求体为 `{ modelId, holds, body, startPose, image? }`，返回 `{ betas: Beta[], attempts, usage, warnings }`。

### 7.4 成本控制

- 缓存：以 `hash(holds, body, startPose, modelId)` 为键缓存结果，命中时不调用模型
- 每日调用上限 `SOLVER_DAILY_LIMIT`；超过后自动改用算法模式
- 每次调用记录 token 用量和估算费用，界面上显示本次费用
- 兜底步骤的讲解用本地模板生成，不额外调用模型

## 8. 校验器（`lib/beta/verify.ts`）

距离一律从岩点边缘算起（中心距离减去 r）。所有阈值都是命名常量。

### 8.1 硬规则（不通过会触发重试）

| 编号 | 规则 | 条件 |
|---|---|---|
| R1 | 引用合法 | 点位 id 都存在；起始姿态双手在起点手点上；结束时双手都在 TOP 上 |
| R2 | 双手跨度 | 两手距离 ≤ 臂展 × 0.95 |
| R3 | 手脚跨度 | 任意手到任意脚的距离 ≤ (肩高 + 单臂长) × 0.95 |
| R4 | 双脚跨度 | 两脚距离 ≤ 0.9H |
| R5 | 支撑 | 移动任何肢体时，剩下的肢体里至少有一只手在点上 |
| R6 | 脚不高过手 | 脚不高于两手平均高度 20cm 以上，除非这一步是 `heel-hook` 或 `toe-hook` |
| R7 | 交叉 | 左手在右手右边超过 15cm（脚同理），而这一步没有标 `cross` |
| R8 | 防死循环 | 没有重复的姿态；总步数 ≤ 40 |
| R9 | 用力方向 | `side-pull`、`undercling`、`gaston` 的用力方向和岩点 `pullDirDeg` 偏差 ≤ 60°（岩点没有标方向时跳过） |
| R10 | 旗式平衡 | `flag` 的那只脚在重心另一侧，起平衡作用（代替 R5 对这只脚的要求） |

技巧带来的放宽：`hips` 是 `left-in` 或 `right-in` 时，对应那一侧手的 R2、R3 上限 × 1.1；`motion` 是 `dyno` 或 `deadpoint` 时，R2、R3 上限 × 1.1。

### 8.2 软规则（只提示）

S1 无脚移动（campus）；S2 重心偏出支撑范围，有甩门风险；S3 动态或定点步骤，提示"需要发力"。

### 8.3 违规原因格式

```ts
interface Violation {
  step: number; rule: string; limbs: Limb[]; holds: number[]
  actualCm?: number; limitCm?: number
}
```

渲染示例：第 4 步：右手移到 #12 后，左手（#7）和右手（#12）相距 196cm，超过最大双手跨度 162cm。第 1～3 步合法，请保留，从第 4 步开始重新规划。

每次最多发送 5 条，按步骤排序，并明确告诉模型哪些步骤是合法的、需要保留。

## 9. 优雅度评分（`lib/beta/score.ts`，权重在 `config/scoring.yaml`）

| 维度 | 加分 | 扣分 |
|---|---|---|
| 省力 | 手臂伸直挂着、髋贴墙（`hipsToWall: close`） | 长时间屈臂锁定、`far` |
| 用脚 | 先上脚再上手、脚点精准 | 无脚移动、频繁换脚 |
| 技巧匹配 | 侧向受力的点配扭转；反提配高脚；圆包配低重心 | 侧向受力的点用正身硬拉 |
| 流畅 | 步数少、重心轨迹平滑 | 来回换手、重复调整 |

```yaml
# config/scoring.yaml（示例，用户维护）
weights:
  efficiency: 0.30
  footwork: 0.25
  techniqueFit: 0.30
  flow: 0.15
penalties:
  campusMove: 2.0
  bentArmHoldSteps: 0.5
  squareOnSidePull: 1.5
```

总分归一化到 0～100。界面默认展示得分最高的通过硬规则的候选，同时可以切换到"稳妥解"对比。

## 10. 技巧词典（`config/techniques.yaml`，用户维护）

```yaml
- id: twist-lock
  name: 扭转（侧身）
  when: 下一个手点在侧上方，或者当前手是侧拉
  body: 同侧髋转向墙，肩贴墙，另一只手伸出去
  mistake: 正对墙面硬拉，手臂很快就累
  verifierHints: { hips: [left-in, right-in] }
```

初版收录以下条目，触发条件由用户审核：扭转、落膝、旗式（内旗、外旗、后旗）、挂脚跟、勾脚尖、侧拉、反提、推撑（Gaston）、捏、并手、换脚、定点、动态、顶胯（贴墙）、高脚翻上（rock-over）、踩墙（smear）、撑上 TOP（mantle）。

词典同时用于：提示词里的技巧约束、校验器的放宽依据、讲解文案，以及以后的学习模块。

## 11. 动画（`features/player`、`lib/ik`）

- 场景：墙是平面 z = 0，岩点按厘米坐标放置成小圆盘，用识别时的颜色
- 胶囊人：躯干、上臂、前臂、大腿、小腿用胶囊体表示，头用球体，尺寸来自 `lib/body`
- 每个 `Pose` 是一个关键帧：手脚末端钉在点位上；髋的位置和朝向由 `hips`、`hipsToWall` 决定；肩跟随躯干；四肢用双骨骼 IK 求解，膝盖和手肘的弯曲方向随技巧调整（落膝时膝盖内扣）
- 两帧之间：先移动的肢体走弧线，躯干平滑插值；`dyno` 时躯干先下沉再上冲
- 交互：播放、暂停、上一步、下一步；单指拖动旋转视角，双指缩放；默认正面视角，提供"侧面"快捷按钮，方便看顶胯和扭转
- 当前步骤的点位和肢体高亮，讲解面板同步显示 `note`、`why`、`commonMistake`
- 不支持 WebGL 时，降级为逐步显示的 2D 关键帧图

## 12. 错误处理

| 阶段 | 问题 | 处理 |
|---|---|---|
| 拍照 | 太大或解码失败（如 HEIC） | `createImageBitmap` 解码并缩小；失败时提示换图 |
| 识别 | 0 个点或超过 60 个点 | 显示容差滑块，并给拍摄建议 |
| 编辑 | 缺起点或 TOP | 禁用"生成解法"按钮，并说明缺什么 |
| 定比例 | 没填身高，或人形没对齐 | 不能进入下一步 |
| 模型 | 超时（流式，总共 60 秒） | 算一次失败，进入重试 |
| 模型 | 429 或 5xx | SDK 自带重试 2 次，之后算一次失败 |
| 模型 | JSON 格式不对 | Zod 失败算一次失败，带格式错误原因重试 |
| 模型 | 拒答 | 服务端 fallback 换模型；仍然失败走兜底 |
| 模型 | 没有 Key 或超过额度 | 改用算法模式，界面顶部提示 |
| 兜底 | 无解 | 提示卡在第几步，高亮相关点位 |
| 动画 | 不支持 WebGL | 2D 关键帧图 |

隐私：照片不在服务端保存，只转发给所选的模型服务商。服务端日志只记录服务商、模型、token 用量、费用估算、尝试次数和违规规则编号。

## 13. 测试

| 层 | 工具 | 内容 |
|---|---|---|
| 单元测试 | Vitest | 视觉（合成图：灰底加彩色圆，断言点数和中心位置）；身体尺寸推导；每条硬规则的正反例，包括技巧放宽；评分；A* 有解和无解两种情况；违规原因渲染；Zod schema；IK 末端误差 |
| 集成测试 | Vitest 加 MockProvider | `/api/solve` 的剧本：一次通过；违规后修好；三次都违规转 hybrid 或 fallback；格式错误；缓存命中；超过每日上限 |
| 端到端测试 | Playwright（手机视口） | 上传样例 → 取色 → 标起点和 TOP → 定比例 → 生成解法（Mock）→ 3D 画布存在，可以逐步切换 |
| 模型评测 | `eval/run-eval.ts`，手动运行 | 5～10 条真实线路加参考爬法；输出各模型的硬规则通过率、优雅度、与参考爬法的接近程度、费用 |

覆盖率目标：`lib/` ≥ 80%。3D 渲染效果人工检查。

## 14. 建议的实现顺序

1. 项目脚手架（Next.js、TypeScript、Vitest），以及 `lib/beta/types.ts`
2. `lib/vision` 和识别页（点选取色、容差、灰化、增删点位）
3. 标注编辑器和比例尺校准
4. `lib/body`、`simulate`、`verify`、`score`、`search`（先完成纯算法模式的闭环）
5. three.js 胶囊人和播放器（先用算法模式的结果驱动）
6. `SolverProvider`：先做 Mock，再做 Anthropic、OpenAI 兼容接口，最后接上 `orchestrate` 和 `/api/solve`
7. 技巧词典和评分配置的初稿，交给用户审阅
8. 评测集和对比脚本

## 15. 待确认事项

1. 用户提到的技巧"顶息"具体是指哪个动作（目前按顶胯或定点理解）
2. 技巧词典初稿的触发条件，需要用户审核
3. 规则阈值（0.95、0.9H、20cm、15cm、60°、× 1.1）是根据常见人体比例设定的初始值，需要用户结合自己的实测数据校准
4. 评测集的照片和参考爬法，由用户在岩馆采集（正对岩壁拍摄，整条线完整入画）
