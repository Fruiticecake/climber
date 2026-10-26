import type { Beta, BetaStep, FootTech } from './schema.js'
import type { Pose } from './types.js'

export interface Frame {
  pose: Pose
  /** 每只脚当前用的脚法，用来判断挂脚、旗式等状态 */
  footTech: { LF: FootTech | null; RF: FootTech | null }
  /** 产生这一帧的步骤；起始姿态为 null */
  step: BetaStep | null
  /** 步骤编号，从 1 开始；起始姿态为 0 */
  index: number
}

/** 从起始姿态依次执行每一步，得到每一步之后的姿态序列（第 0 帧是起始姿态） */
export function simulate(beta: Beta): Frame[] {
  const start: Frame = {
    pose: { ...beta.startPose },
    footTech: { ...beta.startFeet },
    step: null,
    index: 0,
  }
  return beta.steps.reduce<Frame[]>(
    (frames, step, i) => {
      const prev = frames[frames.length - 1]!
      const pose: Pose = { ...prev.pose, [step.limb]: step.to }
      const footTech =
        step.limb === 'LF' || step.limb === 'RF'
          ? { ...prev.footTech, [step.limb]: step.to === null && step.foot !== 'flag' ? 'smear' : step.foot }
          : prev.footTech
      return [...frames, { pose, footTech, step, index: i + 1 }]
    },
    [start],
  )
}
