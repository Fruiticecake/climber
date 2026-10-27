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
  STEEP_MIN_ANGLE_DEG,
  TWIST_REACH_BONUS,
} from './verify.js'

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
- 每个岩点给出中心坐标 (x, y) 和半径 r；role 为 start-hand（起点手点）、start-foot（起点脚点）、top（终点）、normal、foot-only（只能踩脚，手不能抓）。
- type 和 pullDirDeg 是可选信息：pullDirDeg 0 表示往下拉，90 表示往右侧拉，180 表示反提，270 表示往左侧拉。
- 墙角度 angleDeg：负数是正墙（slab），0 是直墙，正数是仰角。请结合墙角度选择技巧。

## 规则（会被程序严格校验）
1. 起始姿态双手在起点手点上；结束时双手都要在 TOP 上停稳（可以并手）。
2. 每一步只移动一个肢体。手必须落在点上；脚可以 to: null，但只能是 smear（踩墙）或 flag（旗式）。踩墙的脚贴在它刚离开的那个点附近，跨度检查按那个点算，不会跟着身体移走。
3. 距离按岩点边缘计算。双手跨度、手脚跨度、双脚跨度都有上限，具体数值见每条线路的"身体限制"。
4. 髋贴墙（hips 为 left-in 或 right-in）时，贴墙一侧的手负责锁定，对侧的手伸展上限放宽到 ${TWIST_REACH_BONUS} 倍；motion 为 deadpoint 或 dyno 时也放宽到 ${TWIST_REACH_BONUS} 倍。
5. 脚不能比双手平均高度高出 ${FOOT_ABOVE_HANDS_TOLERANCE_CM}cm 以上，除非这只脚是 heel-hook 或 toe-hook；但挂脚跟、勾脚尖也不能比较高那只手再高出 ${HOOK_ABOVE_TOP_HAND_MAX_CM}cm 以上（否则身体会倒过来）。
6. 左手不能在右手右边超过 ${CROSS_TOLERANCE_CM}cm（脚同理），有意交叉时在 techniques 里写 "cross"。交叉也有幅度上限（见"身体限制"），超过上限写了 cross 也不行。只在这一步确实交叉时写 cross。
7. 不要回到出现过的姿态，总步数不超过 ${MAX_STEPS}。
8. 手和脚不能同时在同一个点上：手离开之后脚才能踩上去（techniques 含 rock-over 或 mantle 时除外）。
9. 身体不能压得太紧：普通踩点的脚必须比双手平均高度低一定距离（具体数值见"身体限制"），否则身体会被折成一团，真人做不到。挂脚跟、勾脚尖不受限制；techniques 含 rock-over 或 mantle 的那一步、以及它前面紧挨着的上脚那一步允许，之后这只脚不动时继续允许。只标 high-step 不算。
10. 墙角度小于 ${STEEP_MIN_ANGLE_DEG}° 时，挂脚跟、勾脚尖必须挂在身体侧面、并且比双手低（具体数值见"身体限制"），靠侧向拉力把身体拉向墙。不能用挂脚把脚放到手旁边或手上方来绕开第 9 条。墙角度达到 ${STEEP_MIN_ANGLE_DEG}° 的仰角墙上不受这条限制。这条每一步都检查：手移动后挂脚不再在侧面或不再比手低，也算违规，应该先换脚。
11. role 为 foot-only 的点只能踩脚，手不能抓。

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
  // 陡墙上挂脚不限位置，不写这一行
  const hookLimit =
    route.wall.angleDeg < STEEP_MIN_ANGLE_DEG
      ? `\n- 挂脚跟、勾脚尖（这面墙不算陡）：离双手中点水平至少 ${Math.round(limits.hookSideMinCm)}cm，并且比双手平均高度至少低 ${Math.round(limits.hookBelowHandsMinCm)}cm`
      : ''
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
- 普通踩点比双手平均高度至少低 ${Math.round(limits.footBelowHandsMinCm)}cm${hookLimit}
- 有意交叉时：双手最多交叉 ${Math.round(limits.handCrossMaxCm)}cm，双脚最多交叉 ${Math.round(limits.footCrossMaxCm)}cm

## 岩点（编号 | 中心 | 半径 | 角色 | 类型 | 受力方向）
${holds}

请给出 ${candidates} 个候选爬法，按推荐程度排序：第一个是你最推荐的技巧型爬法，其余可以是思路不同的备选。`
}

export function buildFormatErrorFeedback(error: string): string {
  return `上一次的输出无法解析为要求的 JSON：${error}\n请严格按照输出格式，重新输出完整的 JSON（包含全部候选）。`
}

export function buildTruncatedFeedback(): string {
  return '上一次的回复被长度上限截断了，没有输出 JSON。请少做推演：按你目前想到的最可行的方案，直接输出完整的 JSON（包含全部候选），不要再逐步验算每一个距离，程序会负责校验并把问题反馈给你。'
}

export function buildQualityFeedback(label: string, issues: string[]): string {
  return `候选「${label}」通过了全部硬规则，但爬法质量还有问题：\n${issues.map((s) => `- ${s}`).join('\n')}\n\n请在继续满足全部规则的前提下改进这些步骤，重新输出完整的 JSON（包含全部候选）。如果你确信某一步必须这样做，保留它，并在 why 里说明原因。`
}

export function buildViolationFeedback(perCandidate: string[]): string {
  return `你的候选都没有通过校验，问题如下：\n\n${perCandidate.join('\n\n')}\n\n请修正后重新输出完整的 JSON（包含全部候选）。`
}
