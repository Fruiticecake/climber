import { stringify } from 'yaml'
import { deriveBody } from './body.js'
import type { Technique } from './config.js'
import { FOOT_TECHS, GRIPS, HIPS, HIPS_TO_WALL, MOTIONS } from './schema.js'
import type { Route } from './types.js'
import {
  CROSS_TOLERANCE_CM,
  FOOT_ABOVE_HANDS_TOLERANCE_CM,
  HOOK_ABOVE_TOP_HAND_MAX_CM,
  limitsFor,
  MAX_STEPS,
  SLAB_MAX_ANGLE_DEG,
  TWIST_REACH_BONUS,
} from './verify.js'

/** 墙角度达到这个值算明显的仰角 */
export const STEEP_MIN_ANGLE_DEG = 15

/** 按墙角度给出技巧方向，避免在正墙上套用仰角的技巧 */
export function wallStyleHint(angleDeg: number): string {
  if (angleDeg < SLAB_MAX_ANGLE_DEG)
    return '这是正墙：以正身站立为主，靠踩墙（smear）、精准踩点、高脚和翻上（rock-over）把重心平移到脚上，手点主要用来保持平衡。扭转、落膝、外侧踩很少需要，除非某一步确实要侧身才能够到，请在 why 里说明原因。'
  if (angleDeg < STEEP_MIN_ANGLE_DEG)
    return '这是直墙：正身和侧身都常用。侧拉点适合扭转、外侧踩；尽量顶胯、直臂挂着，先上脚再上手。'
  return '这是仰角墙：身体容易离墙、甩门。多用挂脚跟、勾脚尖把身体拉向墙面，配合扭转、落膝、顶胯和核心收紧；远点可以考虑定点。'
}

const OUTPUT_EXAMPLE = {
  betas: [
    {
      label: '技巧解',
      summary: '一句话概括这套爬法的思路',
      startPose: { LH: 1, RH: 1, LF: 2, RF: 3 },
      startFeet: { LF: 'front', RF: 'front' },
      steps: [
        {
          limb: 'RF',
          to: 5,
          grip: null,
          foot: 'outside-edge',
          hips: 'right-in',
          hipsToWall: 'close',
          motion: 'static',
          techniques: ['backstep'],
          note: '右脚外侧踩 #5',
          why: '为下一步扭转做准备，让右髋能贴墙',
          commonMistake: '用脚尖正踩，髋转不过去',
        },
      ],
    },
  ],
}

/** 系统提示词：不随线路变化，放在前面便于缓存 */
export function buildSystemPrompt(techniques: Technique[]): string {
  return `你是一位经验丰富的抱石教练，擅长为新手设计"省力、优雅、运用技巧"的爬法，而不是靠蛮力硬拉。

## 坐标系
- 所有坐标都是墙面坐标，单位 cm，原点在墙面左下角，x 向右，y 向上。
- 每个岩点给出中心坐标 (x, y) 和半径 r；role 为 start-hand（起点手点）、start-foot（起点脚点）、top（终点）、normal。
- type 和 pullDirDeg 是可选信息：pullDirDeg 0 表示往下拉，90 表示往右侧拉，180 表示反提，270 表示往左侧拉。
- 墙角度 angleDeg：负数是正墙（slab），0 是直墙，正数是仰角。请结合墙角度选择技巧。

## 规则（会被程序严格校验）
1. 起始姿态双手在起点手点上；结束时双手都要在 TOP 上停稳（可以并手）。
2. 每一步只移动一个肢体。手必须落在点上；脚可以 to: null，但只能是 smear（踩墙）或 flag（旗式）。
3. 距离按岩点边缘计算。双手跨度、手脚跨度、双脚跨度都有上限，具体数值见每条线路的"身体限制"。
4. 髋贴墙（hips 为 left-in 或 right-in）时，贴墙一侧的手负责锁定，对侧的手伸展上限放宽到 ${TWIST_REACH_BONUS} 倍；motion 为 deadpoint 或 dyno 时也放宽到 ${TWIST_REACH_BONUS} 倍。
5. 脚不能比双手平均高度高出 ${FOOT_ABOVE_HANDS_TOLERANCE_CM}cm 以上，除非这只脚是 heel-hook 或 toe-hook；但挂脚跟、勾脚尖也不能比较高那只手再高出 ${HOOK_ABOVE_TOP_HAND_MAX_CM}cm 以上（否则身体会倒过来）。
6. 左手不能在右手右边超过 ${CROSS_TOLERANCE_CM}cm（脚同理），有意交叉时在 techniques 里写 "cross"。
7. 不要回到出现过的姿态，总步数不超过 ${MAX_STEPS}。
8. 手和脚不能同时在同一个点上：手离开之后脚才能踩上去（techniques 含 rock-over 或 mantle 时除外）。

## 爬法要求
- 优先选择省力的身体姿势：手臂尽量伸直挂着，髋贴墙，先上脚再上手。
- 主动使用合适的技巧，每一步说明为什么这样做，以及新手常见的错误。
- techniques 里只能填写下面技巧词典中的 id。

## 技巧词典
${stringify(techniques)}
## 输出格式
只输出一个 JSON 对象，不要输出任何其他文字，也不要用代码块包裹。字段的可选值：
- limb: LH | RH | LF | RF
- grip（手的步骤填写，脚的步骤填 null）: ${GRIPS.join(' | ')}
- foot（脚的步骤填写，手的步骤填 null）: ${FOOT_TECHS.join(' | ')}
- hips: ${HIPS.join(' | ')}
- hipsToWall: ${HIPS_TO_WALL.join(' | ')}
- motion: ${MOTIONS.join(' | ')}
- commonMistake 没有时填 null

示例：
${JSON.stringify(OUTPUT_EXAMPLE, null, 2)}`
}

/** 用户消息：这条线路的具体数据 */
export function buildRoutePrompt(route: Route, candidates: number): string {
  const dims = deriveBody(route.body)
  const limits = limitsFor(route.body)
  const holds = route.holds
    .map((h) =>
      [`#${h.id}`, `(${h.x}, ${h.y})`, `r=${h.r}`, h.role, h.type ?? '-', h.pullDirDeg === undefined ? '-' : `${h.pullDirDeg}°`].join(
        ' | ',
      ),
    )
    .join('\n')
  return `## 线路：${route.name}
${route.description}

## 墙
宽 ${route.wall.widthCm}cm，高 ${route.wall.heightCm}cm，角度 ${route.wall.angleDeg}°
${wallStyleHint(route.wall.angleDeg)}

## 攀爬者
身高 ${route.body.heightCm}cm，臂展 ${route.body.armSpanCm}cm；肩高约 ${Math.round(dims.shoulderHeightCm)}cm，单臂长约 ${Math.round(dims.armLengthCm)}cm。

## 身体限制（边缘距离）
- 双手跨度 ≤ ${Math.round(limits.handSpanCm)}cm
- 任意手到任意脚 ≤ ${Math.round(limits.handFootCm)}cm
- 双脚跨度 ≤ ${Math.round(limits.footSpanCm)}cm

## 岩点（编号 | 中心 | 半径 | 角色 | 类型 | 受力方向）
${holds}

请给出 ${candidates} 个候选爬法，按推荐程度排序：第一个是你最推荐的技巧型爬法，其余可以是思路不同的备选。`
}

export function buildFormatErrorFeedback(error: string): string {
  return `上一次的输出无法解析为要求的 JSON：${error}\n请严格按照输出格式，重新输出完整的 JSON（包含全部候选）。`
}

export function buildQualityFeedback(label: string, issues: string[]): string {
  return `候选「${label}」通过了全部硬规则，但爬法质量还有问题：\n${issues.map((s) => `- ${s}`).join('\n')}\n\n请在继续满足全部规则的前提下改进这些步骤，重新输出完整的 JSON（包含全部候选）。如果你确信某一步必须这样做，保留它，并在 why 里说明原因。`
}

export function buildViolationFeedback(perCandidate: string[]): string {
  return `你的候选都没有通过校验，问题如下：\n\n${perCandidate.join('\n\n')}\n\n请修正后重新输出完整的 JSON（包含全部候选）。`
}
