import type { Body } from './types.js'

// 人体比例系数，都是可以按实测数据校准的初始值
export const SHOULDER_WIDTH_RATIO = 0.23
export const SHOULDER_HEIGHT_RATIO = 0.82
export const LEG_LENGTH_RATIO = 0.53

export interface BodyDims {
  shoulderWidthCm: number
  armLengthCm: number
  shoulderHeightCm: number
  legLengthCm: number
}

export function deriveBody(body: Body): BodyDims {
  const shoulderWidthCm = body.heightCm * SHOULDER_WIDTH_RATIO
  return {
    shoulderWidthCm,
    armLengthCm: (body.armSpanCm - shoulderWidthCm) / 2,
    shoulderHeightCm: body.heightCm * SHOULDER_HEIGHT_RATIO,
    legLengthCm: body.heightCm * LEG_LENGTH_RATIO,
  }
}
