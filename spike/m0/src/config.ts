import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { RouteSchema } from './schema.js'
import type { Route } from './types.js'

export const TechniqueSchema = z.object({
  id: z.string(),
  name: z.string(),
  when: z.string(),
  body: z.string(),
  mistake: z.string(),
})
export type Technique = z.infer<typeof TechniqueSchema>

export const ModelConfigSchema = z.object({
  id: z.string(),
  provider: z.enum(['anthropic', 'openai-compat', 'mock']),
  model: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  serverFallbacks: z.boolean().optional(),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().optional(),
  price: z.object({ input: z.number(), output: z.number() }).optional(),
})
export type ModelConfig = z.infer<typeof ModelConfigSchema>

function readYaml(file: string): unknown {
  return parse(fs.readFileSync(file, 'utf8'))
}

export function loadTechniques(file: string): Technique[] {
  return z.array(TechniqueSchema).parse(readYaml(file))
}

export function loadModels(file: string): ModelConfig[] {
  return z.object({ models: z.array(ModelConfigSchema) }).parse(readYaml(file)).models
}

export function loadRoutes(dir: string): Route[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const parsed = RouteSchema.safeParse(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
      if (!parsed.success) throw new Error(`线路文件 ${f} 格式不对：${parsed.error.message}`)
      return parsed.data
    })
}
