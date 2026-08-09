import { buildGeminiMockupPrompt } from '../core/prompting'
import { config } from './config'
import { generateGeminiMockup } from './gemini-mockup'

type GeminiGenerator = typeof generateGeminiMockup

export async function generateMockupImage(input: { designBuffer: Buffer; designContentType: string; templateName: string; productType: string; includeText: boolean }, options: { provider?: 'gemini'; model?: string; generator?: GeminiGenerator } = {}) {
  const provider = options.provider ?? config.MOCKUP_AI_PROVIDER
  if (provider !== 'gemini') throw new Error(`Unsupported mockup provider: ${provider}`)
  const model = options.model ?? config.GEMINI_MOCKUP_MODEL
  const generated = await (options.generator ?? generateGeminiMockup)({
    prompt: buildGeminiMockupPrompt({ templateName: input.templateName, productType: input.productType, includeText: input.includeText }),
    image: input.designBuffer,
    mimeType: input.designContentType,
    model,
  })
  return { buffer: generated.buffer, contentType: generated.contentType, provider, model }
}
