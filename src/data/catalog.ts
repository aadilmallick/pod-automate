import type { ProductType } from '../core/interfaces/providers'
import type { MockupTemplateSelection } from '../core/workflow'

export interface ProductOption {
  id: ProductType
  label: string
  description: string
  emoji: string
  color: string
}

export const productOptions: ProductOption[] = [
  { id: 'tshirt', label: 'T-shirt', description: 'Everyday cotton apparel', emoji: '✦', color: '#e7f0ff' },
  { id: 'hoodie', label: 'Hoodie', description: 'Heavyweight fleece', emoji: '◒', color: '#efe8ff' },
  { id: 'sweatshirt', label: 'Sweatshirt', description: 'Soft crewneck fit', emoji: '◓', color: '#e5f7ed' },
  { id: 'phone-case', label: 'Phone case', description: 'Protective hard shell', emoji: '▣', color: '#fff0dc' },
  { id: 'wall-art', label: 'Wall art', description: 'Gallery-ready print', emoji: '▤', color: '#ffe6ed' },
]

export const templateCatalog: MockupTemplateSelection[] = [
  { id: 'studio-front', name: 'Studio front', kind: 'deterministic', productType: 'tshirt', quantity: 1 },
  { id: 'street-style', name: 'Street style', kind: 'generative', productType: 'tshirt', quantity: 2 },
  { id: 'hoodie-studio', name: 'Studio front', kind: 'deterministic', productType: 'hoodie', quantity: 1 },
  { id: 'hoodie-coffee', name: 'Coffee shop', kind: 'generative', productType: 'hoodie', quantity: 2 },
  { id: 'crewneck-studio', name: 'Studio front', kind: 'deterministic', productType: 'sweatshirt', quantity: 1 },
  { id: 'crewneck-coffee', name: 'Coffee shop', kind: 'generative', productType: 'sweatshirt', quantity: 1 },
  { id: 'phone-hand', name: 'In hand', kind: 'deterministic', productType: 'phone-case', quantity: 1 },
  { id: 'wall-living', name: 'Living room', kind: 'generative', productType: 'wall-art', quantity: 2 },
]

export const designArt = [
  { id: 'design-01', title: 'Cat nap champion', subtitle: '01 / 12', background: 'linear-gradient(135deg, #f5b47e 0%, #ffdcb0 100%)', accent: '#45251b', icon: '☾' },
  { id: 'design-02', title: 'Professional loaf', subtitle: '02 / 12', background: 'linear-gradient(135deg, #a7c7ff 0%, #dae7ff 100%)', accent: '#1b315f', icon: '◒' },
  { id: 'design-03', title: 'Snack supervisor', subtitle: '03 / 12', background: 'linear-gradient(135deg, #b4e8c6 0%, #e1f8e7 100%)', accent: '#19412b', icon: '✦' },
  { id: 'design-04', title: 'No thoughts', subtitle: '04 / 12', background: 'linear-gradient(135deg, #d6b7f1 0%, #f0e2ff 100%)', accent: '#42245d', icon: '○' },
  { id: 'design-05', title: 'Tiny tyrant', subtitle: '05 / 12', background: 'linear-gradient(135deg, #ffafc1 0%, #ffe0e7 100%)', accent: '#641f36', icon: '✹' },
  { id: 'design-06', title: 'Treat inspector', subtitle: '06 / 12', background: 'linear-gradient(135deg, #ffe28c 0%, #fff2c7 100%)', accent: '#57400d', icon: '⌁' },
  { id: 'design-07', title: 'Main character', subtitle: '07 / 12', background: 'linear-gradient(135deg, #8bdedc 0%, #d5f6f3 100%)', accent: '#145451', icon: '✦' },
  { id: 'design-08', title: 'Keyboard cat', subtitle: '08 / 12', background: 'linear-gradient(135deg, #bbc5d6 0%, #ebeff5 100%)', accent: '#303d53', icon: '⌨' },
]

export interface WorkflowRun {
  id: string
  name: string
  detail: string
  status: 'Running' | 'Ready' | 'Draft'
  progress: number
  date: string
  accent: string
}

export const recentRuns: WorkflowRun[] = [
  { id: 'run-01', name: 'Funny cat collection', detail: '12 designs · 3 products · Etsy', status: 'Running', progress: 68, date: 'Today, 10:42 AM', accent: '#6d5ce7' },
  { id: 'run-02', name: 'Developer essentials', detail: '8 designs · 2 products · Local export', status: 'Ready', progress: 100, date: 'Yesterday', accent: '#43aa76' },
  { id: 'run-03', name: 'Botanical series', detail: '24 designs · 1 product · Draft', status: 'Draft', progress: 32, date: 'Aug 01, 2026', accent: '#e99b47' },
]

export const listingItems = [
  { title: 'Cat nap champion tee', type: 'T-shirt', status: 'Draft ready', price: '$24.00', tags: ['cat humor', 'funny tee', 'cozy'], background: designArt[0].background, icon: designArt[0].icon },
  { title: 'Cat nap champion hoodie', type: 'Hoodie', status: 'Draft ready', price: '$48.00', tags: ['cat lover', 'gift idea', 'streetwear'], background: designArt[1].background, icon: designArt[1].icon },
  { title: 'Cat nap champion wall art', type: 'Wall art', status: 'Needs review', price: '$32.00', tags: ['cat print', 'home decor', 'gallery'], background: designArt[3].background, icon: designArt[3].icon },
]
