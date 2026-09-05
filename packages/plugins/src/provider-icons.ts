import {
  siAlibabacloud,
  siAnthropic,
  siClaude,
  siCloudflare,
  siDeepseek,
  siGithubcopilot,
  siGoogle,
  siGooglegemini,
  siHuggingface,
  siKimi,
  siMinimax,
  siMistralai,
  siMoonshotai,
  siNvidia,
  siOpencode,
  siOpenrouter,
  siQwen,
  siVercel,
  siXiaomi,
} from 'simple-icons'
import { siOpenai, siXai } from './vendored-icons'

export type ProviderBrandIcon = {
  path: string
  /** Brand color as a CSS color. Dark brand marks use a light neutral so they read on dark surfaces. */
  color: string
}

type IconSource = { path: string; hex: string }

const LIGHT_NEUTRAL = '#e5e5e7'

function brand(icon: IconSource, color?: string): ProviderBrandIcon {
  if (color) return { path: icon.path, color }
  const luminance = relativeLuminance(icon.hex)
  return { path: icon.path, color: luminance < 0.08 ? LIGHT_NEUTRAL : `#${icon.hex}` }
}

function relativeLuminance(hex: string) {
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Brand marks keyed by model provider id (as reported by the agent runtime). */
export const PROVIDER_BRAND_ICONS: Record<string, ProviderBrandIcon> = {
  openai: brand(siOpenai),
  'openai-codex': brand(siOpenai),
  'azure-openai-responses': brand(siOpenai),
  anthropic: brand(siAnthropic, `#${siClaude.hex}`),
  'github-copilot': brand(siGithubcopilot),
  google: brand(siGoogle),
  'google-vertex': brand(siGooglegemini),
  openrouter: brand(siOpenrouter),
  opencode: brand(siOpencode),
  'opencode-go': brand(siOpencode),
  'vercel-ai-gateway': brand(siVercel),
  xai: brand(siXai),
  mistral: brand(siMistralai),
  deepseek: brand(siDeepseek),
  huggingface: brand(siHuggingface),
  minimax: brand(siMinimax),
  'minimax-cn': brand(siMinimax),
  moonshotai: brand(siMoonshotai),
  'moonshotai-cn': brand(siMoonshotai),
  'kimi-coding': brand(siKimi),
  nvidia: brand(siNvidia),
  'cloudflare-ai-gateway': brand(siCloudflare),
  'cloudflare-workers-ai': brand(siCloudflare),
  'qwen-token-plan': brand(siQwen),
  'qwen-token-plan-cn': brand(siQwen),
  'qwen-token-plan-individual': brand(siQwen),
  'ant-ling': brand(siAlibabacloud),
  xiaomi: brand(siXiaomi),
  'xiaomi-token-plan-ams': brand(siXiaomi),
  'xiaomi-token-plan-cn': brand(siXiaomi),
  'xiaomi-token-plan-sgp': brand(siXiaomi),
}

export function providerBrandIcon(providerId: string): ProviderBrandIcon | undefined {
  return PROVIDER_BRAND_ICONS[providerId]
}

/**
 * Providers pinned to the top of provider lists, in this order. Everything else
 * follows alphabetically by display name.
 */
export const FEATURED_PROVIDER_IDS = [
  'openai',
  'anthropic',
  'github-copilot',
  'google',
  'openrouter',
  'opencode-go',
  'opencode',
  'vercel-ai-gateway',
] as const

export function sortProviders<T extends { id: string; name: string }>(providers: T[]): T[] {
  const rank = new Map<string, number>(FEATURED_PROVIDER_IDS.map((id, index) => [id, index]))
  return [...providers].sort((left, right) => {
    const leftRank = rank.get(left.id) ?? Number.POSITIVE_INFINITY
    const rightRank = rank.get(right.id) ?? Number.POSITIVE_INFINITY
    if (leftRank !== rightRank) return leftRank - rightRank
    return left.name.localeCompare(right.name)
  })
}

/** Short descriptions shown under provider names in the settings list. */
export const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  openai: 'GPT and o-series models with an API key or your ChatGPT account',
  'openai-codex': 'Codex models through your ChatGPT subscription',
  anthropic: 'Direct access to Claude models, including Pro and Max plans',
  'github-copilot': 'Models included with your GitHub Copilot subscription',
  google: 'Gemini models with an AI Studio key',
  'google-vertex': 'Gemini and partner models through Google Cloud Vertex AI',
  openrouter: 'One key for Claude, GPT, Gemini and hundreds more',
  opencode: 'Curated, tested models from the OpenCode team',
  'opencode-go': 'Affordable open models on the OpenCode Go plan',
  'vercel-ai-gateway': 'Route to any model through the Vercel AI Gateway',
  xai: 'Grok models via the xAI API',
  mistral: 'Mistral and Codestral models via La Plateforme',
  groq: 'Ultra-fast inference for open models',
  deepseek: 'DeepSeek chat and reasoning models',
  together: 'Open models hosted on Together AI',
  fireworks: 'Fast inference for open models on Fireworks',
  cerebras: 'Wafer-scale inference for open models',
  huggingface: 'Open models via Hugging Face Inference',
  'amazon-bedrock': 'Claude, Llama and more through your AWS account',
  'azure-openai-responses': 'OpenAI models hosted in your Azure subscription',
  minimax: 'MiniMax text models',
  moonshotai: 'Kimi models from Moonshot AI',
  'kimi-coding': 'Kimi models on the coding plan',
  nvidia: 'Models hosted on NVIDIA NIM',
  baseten: 'Models deployed on Baseten',
  'cloudflare-ai-gateway': 'Route any provider through Cloudflare AI Gateway',
  'cloudflare-workers-ai': 'Open models on Cloudflare Workers AI',
  zai: 'GLM models from Z.AI',
}
