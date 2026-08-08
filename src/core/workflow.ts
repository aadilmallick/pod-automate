import type { ProductType } from './interfaces/providers'

export type ApprovalPolicy = 'auto' | 'review' | 'skip'
export type WorkflowNodeType = 'design-generation' | 'transform' | 'fan-out' | 'mockup' | 'metadata' | 'publish'

export interface WorkflowNode {
  id: string
  type: WorkflowNodeType
  label: string
  provider?: string
  policy: ApprovalPolicy
}

export interface WorkflowDefinition {
  version: number
  nodes: WorkflowNode[]
  edges: Array<{ from: string; to: string }>
}

export interface MockupTemplateSelection {
  id: string
  name: string
  kind: 'deterministic' | 'generative'
  productType: ProductType
  quantity: number
  config?: Record<string, unknown>
}

export interface ProductionConfig {
  designs: number
  products: ProductType[]
  templates: MockupTemplateSelection[]
  destinations: string[]
}

export function estimateProducts(config: ProductionConfig): number {
  return config.designs * config.products.length
}

export function estimateMockups(config: ProductionConfig): number {
  return config.designs * config.products.reduce((total, product) => {
    return total + config.templates
      .filter((template) => template.productType === product)
      .reduce((subtotal, template) => subtotal + template.quantity, 0)
  }, 0)
}

export const defaultWorkflow: WorkflowDefinition = {
  version: 1,
  nodes: [
    { id: 'designs', type: 'design-generation', label: 'Create designs', provider: 'OpenRouter', policy: 'review' },
    { id: 'prepare', type: 'transform', label: 'Prepare artwork', provider: 'Sharp / local', policy: 'auto' },
    { id: 'fanout', type: 'fan-out', label: 'Create product variants', policy: 'auto' },
    { id: 'mockups', type: 'mockup', label: 'Render mockups', provider: 'Template engine', policy: 'review' },
    { id: 'metadata', type: 'metadata', label: 'Write listing metadata', provider: 'OpenRouter', policy: 'auto' },
    { id: 'publish', type: 'publish', label: 'Export and publish', policy: 'review' },
  ],
  edges: [
    { from: 'designs', to: 'prepare' },
    { from: 'prepare', to: 'fanout' },
    { from: 'fanout', to: 'mockups' },
    { from: 'mockups', to: 'metadata' },
    { from: 'metadata', to: 'publish' },
  ],
}
