import type { Beta, BetaStep, FootTech } from './schema.js'
import type { Pose } from './types.js'

export interface Frame {
  pose: Pose
  /** 每只脚当前用的脚法，用来判断挂脚、旗式等状态 */
  footTech: { LF: FootTech | null; RF: FootTech | null }
  /** 踩墙的脚贴在它离开的那个点附近：记下这个点，用来算跨度 */
  smearAt: { LF: number | null; RF: number | null }
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
    smearAt: { LF: null, RF: null },
    step: null,
    index: 0,
  }
  return beta.steps.reduce<Frame[]>(
    (frames, step, i) => {
      const prev = frames[frames.length - 1]!
      const pose: Pose = { ...prev.pose, [step.limb]: step.to }
      if (step.limb !== 'LF' && step.limb !== 'RF') return [...frames, { ...prev, pose, step, index: i + 1 }]

      const smearing = step.to === null && step.foot !== 'flag'
      const footTech = { ...prev.footTech, [step.limb]: smearing ? 'smear' : step.foot }
      // 连续踩墙时保留最早离开的那个点；踩回点上或改成旗式时清掉
      const anchor = smearing ? (prev.pose[step.limb] ?? prev.smearAt[step.limb]) : null
      const smearAt = { ...prev.smearAt, [step.limb]: anchor }
      return [...frames, { pose, footTech, smearAt, step, index: i + 1 }]
    },
    [start],
  )
}
