import { useMemo, useState } from 'react'
import type { ProductType } from './core/interfaces/providers'
import { estimateMockups, estimateProducts } from './core/workflow'
import { designArt, listingItems, productOptions, recentRuns, templateCatalog } from './data/catalog'

type View = 'dashboard' | 'workflows' | 'templates' | 'connections' | 'assets' | 'run'
type WizardStep = 'start' | 'source' | 'review' | 'products' | 'destinations' | 'summary'

const navItems: Array<{ id: View; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Overview', icon: '⌂' },
  { id: 'workflows', label: 'Workflows', icon: '⌁' },
  { id: 'templates', label: 'Templates', icon: '▦' },
  { id: 'connections', label: 'Connections', icon: '↗' },
  { id: 'assets', label: 'Asset library', icon: '◉' },
]

const wizardSteps: Array<{ id: WizardStep; label: string; number: string }> = [
  { id: 'start', label: 'Start', number: '01' },
  { id: 'source', label: 'Design source', number: '02' },
  { id: 'review', label: 'Review designs', number: '03' },
  { id: 'products', label: 'Products & mockups', number: '04' },
  { id: 'destinations', label: 'Destinations', number: '05' },
  { id: 'summary', label: 'Review & run', number: '06' },
]

function App() {
  const [activeView, setActiveView] = useState<View>('dashboard')
  const [wizardStep, setWizardStep] = useState<WizardStep>('start')
  const [showWizard, setShowWizard] = useState(false)
  const [source, setSource] = useState<'ai' | 'upload'>('ai')
  const [prompt, setPrompt] = useState('Funny cat designs for people who take their naps seriously')
  const [designCount, setDesignCount] = useState(12)
  const [selectedDesigns, setSelectedDesigns] = useState<string[]>(designArt.slice(0, 6).map((design) => design.id))
  const [selectedProducts, setSelectedProducts] = useState<ProductType[]>(['tshirt', 'hoodie', 'sweatshirt'])
  const [selectedTemplates, setSelectedTemplates] = useState(templateCatalog.slice(0, 5))
  const [destinations, setDestinations] = useState<string[]>(['etsy', 'download'])
  const [launched, setLaunched] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ id: string; name: string; url: string }>>([])

  const config = useMemo(() => ({
    designs: source === 'ai' ? designCount : selectedDesigns.length,
    products: selectedProducts,
    templates: selectedTemplates,
    destinations,
  }), [designCount, destinations, selectedDesigns.length, selectedProducts, selectedTemplates, source])

  const products = estimateProducts(config)
  const mockups = estimateMockups(config)
  const currentStepIndex = wizardSteps.findIndex((step) => step.id === wizardStep)

  function openWizard() {
    setWizardStep('start')
    setShowWizard(true)
  }

  function nextStep() {
    const next = wizardSteps[currentStepIndex + 1]
    if (next) setWizardStep(next.id)
  }

  function previousStep() {
    const previous = wizardSteps[currentStepIndex - 1]
    if (previous) setWizardStep(previous.id)
  }

  function launchWorkflow() {
    setLaunched(true)
    setShowWizard(false)
    setActiveView('run')
  }

  function handleFiles(files: FileList | null) {
    if (!files) return
    const nextFiles = Array.from(files).map((file, index) => ({ id: `upload-${index}-${file.name}`, name: file.name, url: URL.createObjectURL(file) }))
    setUploadedFiles(nextFiles)
    setSelectedDesigns(nextFiles.map((file) => file.id))
  }

  function toggleProduct(id: ProductType) {
    setSelectedProducts((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function toggleTemplate(id: string) {
    setSelectedTemplates((current) => {
      const template = templateCatalog.find((item) => item.id === id)
      if (!template) return current
      return current.some((item) => item.id === id) ? current.filter((item) => item.id !== id) : [...current, template]
    })
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><span>✦</span></div>
          <div><strong>pod automator</strong><small>production workspace</small></div>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">AM</div>
          <div className="workspace-copy"><small>Workspace</small><strong>Aadil's studio</strong></div>
          <span className="chevron">⌄</span>
        </div>

        <nav className="main-nav" aria-label="Main navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map((item) => (
            <button key={item.id} className={`nav-item ${activeView === item.id ? 'active' : ''}`} onClick={() => setActiveView(item.id)}>
              <span className="nav-icon">{item.icon}</span><span>{item.label}</span>
              {item.id === 'connections' && <span className="nav-dot" />}
            </button>
          ))}
          <p className="nav-label nav-label-spaced">Operations</p>
          <button className="nav-item" onClick={() => setActiveView('workflows')}><span className="nav-icon">↺</span><span>Run history</span><span className="nav-count">3</span></button>
          <button className="nav-item" onClick={() => setActiveView('connections')}><span className="nav-icon">⚙</span><span>Settings</span></button>
        </nav>

        <div className="sidebar-bottom">
          <div className="usage-card">
            <div className="usage-top"><span>Workspace usage</span><strong>24%</strong></div>
            <div className="usage-bar"><span /></div>
            <small>1,204 of 5,000 assets this month</small>
          </div>
          <div className="profile-row"><div className="profile-avatar">A</div><div><strong>Aadil Mallick</strong><small>Personal workspace</small></div><span className="more">•••</span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{activeView === 'dashboard' ? 'Overview' : navItems.find((item) => item.id === activeView)?.label}</strong></div>
          <div className="top-actions"><button className="icon-button" aria-label="Search">⌕</button><button className="icon-button notification" aria-label="Notifications">♧<i /></button><div className="top-avatar">AM</div></div>
        </header>

        {activeView === 'dashboard' && <Dashboard        onCreate={openWizard} launched={launched} onViewRun={() => setActiveView('run')} />}
        {activeView === 'workflows' && <Workflows onCreate={openWizard} />}
        {activeView === 'templates' && <Templates onCreate={openWizard} />}
        {activeView === 'connections' && <Connections />}
        {activeView === 'assets' && <Assets />}
        {activeView === 'run' && <RunMonitor onDashboard={() => setActiveView('dashboard')} />}
      </main>

      {showWizard && <WizardModal
        step={wizardStep}
        currentStepIndex={currentStepIndex}
        source={source}
        setSource={setSource}
        prompt={prompt}
        setPrompt={setPrompt}
        designCount={designCount}
        setDesignCount={setDesignCount}
        selectedDesigns={selectedDesigns}
        setSelectedDesigns={setSelectedDesigns}
        uploadedFiles={uploadedFiles}
        onFiles={handleFiles}
        selectedProducts={selectedProducts}
        toggleProduct={toggleProduct}
        selectedTemplates={selectedTemplates}
        toggleTemplate={toggleTemplate}
        destinations={destinations}
        setDestinations={setDestinations}
        products={products}
        mockups={mockups}
        onClose={() => setShowWizard(false)}
        setStep={setWizardStep}
        onNext={nextStep}
        onBack={previousStep}
        onLaunch={launchWorkflow}
      />}
    </div>
  )
}

function Dashboard({ onCreate, launched, onViewRun }: { onCreate: () => void; launched: boolean; onViewRun: () => void }) {
  return <div className="page-wrap">
    {launched && <div className="launch-toast"><span className="pulse-dot" /><strong>Workflow launched.</strong><span>Jobs are queued and will appear in run history.</span></div>}
    <section className="page-heading dashboard-heading">
      <div><div className="eyebrow"><span className="eyebrow-line" /> Tuesday, August 11, 2026</div><h1>Good morning, Aadil<span className="heading-period">.</span></h1><p>Turn an idea into a ready-to-publish product line.</p></div>
      <button className="primary-button" onClick={onCreate}><span>＋</span> New workflow</button>
    </section>

    <section className="hero-card">
      <div className="hero-copy"><span className="hero-kicker">Production at a glance</span><h2>Your next collection is<br /><em>almost ready.</em></h2><p>“Funny cat collection” is processing in the background.<br />We'll let you know when your listings are ready to review.</p><button className="dark-button" onClick={onViewRun}>View active run <span>↗</span></button></div>
      <div className="hero-visual"><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-sticker sticker-top">RUN 04 <span>• LIVE</span></div><div className="hero-art hero-art-one"><span>☾</span><small>CAT NAP<br />CHAMPION</small></div><div className="hero-art hero-art-two"><span>◒</span><small>PRO<br />LOAF</small></div><div className="hero-art hero-art-three"><span>✦</span><small>SNACK<br />SUPERVISOR</small></div><div className="hero-sticker sticker-bottom"><span className="pulse-dot" /> 8 / 12 designs approved</div></div>
    </section>

    <section className="metric-grid">
      <MetricCard label="Active workflows" value="03" note="+2 this month" trend="up" icon="⌁" />
      <MetricCard label="Assets processed" value="1,204" note="+18.4% vs. last month" trend="up" icon="◉" />
      <MetricCard label="Ready to publish" value="186" note="Across 3 destinations" trend="neutral" icon="↗" />
      <MetricCard label="Time saved" value="42h" note="This month" trend="neutral" icon="◷" />
    </section>

    <div className="content-grid">
      <section className="panel recent-panel"><div className="panel-heading"><div><span className="section-kicker">Production runs</span><h3>Recent workflows</h3></div><button className="text-button" onClick={onCreate}>View all <span>→</span></button></div><div className="run-list">{recentRuns.map((run) => <RunRow key={run.id} run={run} />)}</div></section>
      <section className="panel pipeline-panel"><div className="panel-heading"><div><span className="section-kicker">Your system</span><h3>Pipeline health</h3></div><span className="healthy-pill"><i /> All systems healthy</span></div><div className="pipeline-stack"><PipelineRow label="Design generation" provider="OpenRouter · Nano Banana" status="Connected" progress="100%" tone="violet" /><PipelineRow label="Asset processing" provider="Sharp · Local" status="Connected" progress="100%" tone="mint" /><PipelineRow label="Mockup templates" provider="7 templates ready" status="Ready" progress="100%" tone="orange" /><PipelineRow label="Publishing" provider="Etsy · Google Drive" status="Connected" progress="100%" tone="blue" /></div><button className="outline-button full-button">Manage connections <span>→</span></button></section>
    </div>

    <section className="lower-section"><div className="lower-heading"><div><span className="section-kicker">Reusable building blocks</span><h3>Template library</h3></div><button className="text-button">Browse templates <span>→</span></button></div><div className="template-strip">{templateCatalog.slice(0, 4).map((template, index) => <TemplateCard key={template.id} template={template} index={index} />)}<div className="add-template-card" onClick={onCreate}><span>＋</span><strong>Add a template</strong><small>Make your next run more consistent</small></div></div></section>
  </div>
}

function MetricCard({ label, value, note, trend, icon }: { label: string; value: string; note: string; trend: 'up' | 'neutral'; icon: string }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><b>{icon}</b></div><div className="metric-value">{value}</div><div className={`metric-note ${trend === 'up' ? 'positive' : ''}`}>{trend === 'up' && <span>↗</span>} {note}</div></div>
}

function RunRow({ run }: { run: typeof recentRuns[number] }) {
  return <div className="run-row"><div className="run-symbol" style={{ background: run.accent }}>{run.name.slice(0, 1)}</div><div className="run-name"><strong>{run.name}</strong><small>{run.detail}</small></div><div className="run-progress"><div className="progress-label"><span>{run.status === 'Running' ? `${run.progress}% complete` : run.status}</span><small>{run.date}</small></div><div className="progress-track"><span style={{ width: `${run.progress}%`, background: run.accent }} /></div></div><button className="row-action">•••</button></div>
}

function PipelineRow({ label, provider, status, progress, tone }: { label: string; provider: string; status: string; progress: string; tone: string }) {
  return <div className="pipeline-row"><span className={`pipeline-icon ${tone}`}>✦</span><div><strong>{label}</strong><small>{provider}</small></div><div className="pipeline-status"><span>{status}</span><i /></div><b>{progress}</b></div>
}

function TemplateCard({ template, index }: { template: typeof templateCatalog[number]; index: number }) {
  const colors = ['peach', 'lavender', 'mint', 'sky']
  return <div className="template-card"><div className={`template-art ${colors[index]}`}><span>{template.productType === 'tshirt' ? '✦' : template.productType === 'hoodie' ? '◒' : '▤'}</span><small>{template.kind === 'generative' ? 'AI SCENE' : 'STUDIO'}</small></div><div className="template-info"><strong>{template.name}</strong><small>{template.productType.replace('-', ' ')} · {template.kind === 'generative' ? 'Generative' : 'Deterministic'}</small></div><button className="mini-more">•••</button></div>
}

function Workflows({ onCreate }: { onCreate: () => void }) {
  return <div className="page-wrap"><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> Workspace / workflows</div><h1>Workflows<span className="heading-period">.</span></h1><p>Reusable recipes for consistent product production.</p></div><button className="primary-button" onClick={onCreate}><span>＋</span> New workflow</button></section><div className="workflow-feature"><div className="workflow-feature-copy"><span className="hero-kicker">Recommended starting point</span><h2>AI designs →<br /><em>marketplace ready.</em></h2><p>A guided production line with approval checkpoints, reusable mockups and destination-aware exports.</p><button className="dark-button" onClick={onCreate}>Use this workflow <span>→</span></button></div><div className="workflow-nodes">{['Create designs', 'Review selection', 'Fan out products', 'Render templates', 'Publish'].map((node, index) => <div className="workflow-node" key={node}><span>{String(index + 1).padStart(2, '0')}</span><strong>{node}</strong>{index < 4 && <i>↓</i>}</div>)}</div></div><div className="section-heading-row"><h3>Saved workflows <span>3</span></h3><button className="outline-button">Sort by recent⌄</button></div><section className="workflow-table">{recentRuns.map((run) => <div className="workflow-table-row" key={run.id}><div className="run-symbol" style={{ background: run.accent }}>{run.name.slice(0, 1)}</div><div><strong>{run.name}</strong><small>Version 04 · Last run {run.date.toLowerCase()}</small></div><span className="table-detail">{run.detail}</span><span className={`status-badge ${run.status.toLowerCase()}`}>{run.status}</span><button className="row-action">•••</button></div>)}</section></div>
}

function Templates({ onCreate }: { onCreate: () => void }) {
  return <div className="page-wrap"><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> Workspace / template library</div><h1>Templates<span className="heading-period">.</span></h1><p>Pre-tested scenes keep every generation intentional.</p></div><button className="primary-button" onClick={onCreate}><span>＋</span> New template</button></section><div className="template-library-grid">{templateCatalog.map((template, index) => <div className="library-card" key={template.id}><div className={`library-art ${['peach', 'lavender', 'mint', 'sky', 'yellow'][index % 5]}`}><span>{template.productType === 'tshirt' ? '✦' : template.productType === 'hoodie' ? '◒' : template.productType === 'wall-art' ? '▤' : '▣'}</span><div>{template.kind === 'generative' ? 'AI TEMPLATE' : 'DETERMINISTIC'}</div></div><div className="library-card-body"><div><strong>{template.name}</strong><small>{template.productType.replace('-', ' ')} · {template.quantity} output{template.quantity > 1 ? 's' : ''}</small></div><button className="mini-more">•••</button></div></div>)}<div className="empty-library-card" onClick={onCreate}><span>＋</span><strong>Create your own</strong><small>Save a prompt, reference and provider together.</small></div></div></div>
}

function Connections() {
  const connections = [{ name: 'OpenRouter', detail: 'Image generation · Nano Banana', status: 'Connected', color: 'violet', mark: '✦' }, { name: 'Etsy', detail: 'Marketplace destination', status: 'Connected', color: 'orange', mark: 'e' }, { name: 'Google Drive', detail: 'Export destination', status: 'Connected', color: 'blue', mark: '△' }, { name: 'Fal.ai', detail: 'Optional transformation provider', status: 'Not connected', color: 'dark', mark: 'f' }]
  return <div className="page-wrap"><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> Workspace / connections</div><h1>Connections<span className="heading-period">.</span></h1><p>Providers are configured here, never inside your workflow logic.</p></div><button className="outline-button">＋ Add provider</button></section><div className="connection-grid">{connections.map((connection) => <div className="connection-card" key={connection.name}><div className={`connection-mark ${connection.color}`}>{connection.mark}</div><div className="connection-copy"><strong>{connection.name}</strong><small>{connection.detail}</small></div><span className={`connection-status ${connection.status === 'Connected' ? 'connected' : 'not-connected'}`}><i /> {connection.status}</span><button className="outline-button small-button">{connection.status === 'Connected' ? 'Manage' : 'Connect'}</button></div>)}</div><div className="principle-card"><div className="principle-mark">⌘</div><div><span className="section-kicker">Interface-first architecture</span><h3>Swap providers without rebuilding your workflows.</h3><p>OpenRouter today, local ComfyUI tomorrow. Your workflow only knows what a capability can do — not who does it.</p></div><div className="code-pills"><span>ImageGenerationProvider</span><span>StorageProvider</span><span>MarketplaceAdapter</span></div></div></div>
}

function RunMonitor({ onDashboard }: { onDashboard: () => void }) {
  return <div className="page-wrap"><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> Run 04 / funny cat collection</div><h1>Production is moving<span className="heading-period">.</span></h1><p>Every step runs independently. You can leave this page and come back anytime.</p></div><button className="outline-button" onClick={onDashboard}>← Back to overview</button></section><div className="run-hero"><div><span className="hero-kicker">Run status</span><h2>68% <em>complete</em></h2><p>8 of 12 designs approved · 24 product variants · 72 mockup outputs planned</p></div><div className="run-hero-progress"><div className="progress-label"><span>Overall progress</span><strong>68%</strong></div><div className="run-progress-large"><span /></div><small>Started today at 10:42 AM · estimated 14 minutes remaining</small></div></div><div className="run-layout"><section className="panel job-panel"><div className="panel-heading"><div><span className="section-kicker">Background jobs</span><h3>Pipeline progress</h3></div><span className="healthy-pill"><i /> 28 completed</span></div><div className="job-list">{[['Design generation','12 / 12','complete'],['Design review checkpoint','8 / 12','complete'],['Product fan-out','24 / 24','complete'],['Mockup rendering','49 / 72','running'],['Listing metadata','0 / 24','queued'],['Marketplace publish','Waiting for review','queued']].map(([label, detail, state], index) => <div className="job-row" key={label}><span className={`job-state ${state}`}>{state === 'complete' ? '✓' : state === 'running' ? '⋯' : String(index + 1).padStart(2, '0')}</span><div><strong>{label}</strong><small>{detail}</small></div><span className={`job-label ${state}`}>{state === 'complete' ? 'Complete' : state === 'running' ? 'Processing' : 'Queued'}</span>{state === 'running' && <button className="text-button">Retry</button>}</div>)}</div></section><section className="panel listings-panel"><div className="panel-heading"><div><span className="section-kicker">Preview</span><h3>Listing drafts</h3></div><button className="text-button">Open all →</button></div>{listingItems.map((listing) => <div className="listing-row" key={listing.title}><div className="listing-art" style={{ background: listing.background, color: '#3c3044' }}>{listing.icon}</div><div><strong>{listing.title}</strong><small>{listing.type} · {listing.price}</small></div><span className={`status-badge ${listing.status === 'Draft ready' ? 'ready' : 'draft'}`}>{listing.status}</span></div>)}<button className="dark-button full-button">Review marketplace listings <span>↗</span></button></section></div></div>
}

function Assets() {
  return <div className="page-wrap"><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> Workspace / asset library</div><h1>Asset library<span className="heading-period">.</span></h1><p>Your source designs, with provenance attached.</p></div><button className="outline-button">＋ Upload assets</button></section><div className="asset-toolbar"><div className="search-field">⌕ <span>Search assets</span></div><div className="filter-pills"><button className="filter-active">All assets</button><button>Generated</button><button>Uploaded</button><button>Mockups</button></div></div><div className="asset-grid">{designArt.map((design) => <div className="asset-card" key={design.id}><div className="asset-art" style={{ background: design.background, color: design.accent }}><span>{design.icon}</span><small>{design.title}</small></div><div className="asset-card-meta"><strong>{design.title}</strong><small>Generated · OpenRouter · PNG</small><button className="mini-more">•••</button></div></div>)}</div></div>
}

interface WizardProps {
  step: WizardStep
  currentStepIndex: number
  source: 'ai' | 'upload'
  setSource: (source: 'ai' | 'upload') => void
  prompt: string
  setPrompt: (prompt: string) => void
  designCount: number
  setDesignCount: (count: number) => void
  selectedDesigns: string[]
  setSelectedDesigns: (ids: string[]) => void
  selectedProducts: ProductType[]
  toggleProduct: (id: ProductType) => void
  selectedTemplates: typeof templateCatalog
  toggleTemplate: (id: string) => void
  destinations: string[]
  setDestinations: (destinations: string[]) => void
  products: number
  mockups: number
  onClose: () => void
  setStep: (step: WizardStep) => void
  uploadedFiles: Array<{ id: string; name: string; url: string }>
  onFiles: (files: FileList | null) => void
  onNext: () => void
  onBack: () => void
  onLaunch: () => void
}

function WizardModal(props: WizardProps) {
  const { step, currentStepIndex, source, setSource, prompt, setPrompt, designCount, setDesignCount, selectedDesigns, setSelectedDesigns, uploadedFiles, onFiles, selectedProducts, toggleProduct, selectedTemplates, toggleTemplate, destinations, setDestinations, products, mockups, onClose, onNext, onBack, onLaunch } = props
  const canContinue = step === 'review' ? selectedDesigns.length > 0 : step === 'products' ? selectedProducts.length > 0 && selectedTemplates.length > 0 : step === 'destinations' ? destinations.length > 0 : true
  const isSummary = step === 'summary'
  return <div className="modal-backdrop"><div className="wizard-shell"><aside className="wizard-sidebar"><button className="close-wizard" onClick={onClose}>× <span>Close</span></button><div className="wizard-brand"><div className="brand-mark"><span>✦</span></div><div><strong>New workflow</strong><small>Build your production line</small></div></div><div className="step-list">{wizardSteps.map((item, index) => <button key={item.id} className={`step-item ${step === item.id ? 'current' : ''} ${index < currentStepIndex ? 'done' : ''}`} onClick={() => index <= currentStepIndex && props.setStep(item.id)}><span className="step-number">{index < currentStepIndex ? '✓' : item.number}</span><span>{item.label}</span></button>)}</div><div className="wizard-aside-note"><span>✧</span><strong>Keep it flexible</strong><p>Every provider, template and destination can be swapped later.</p></div></aside><section className="wizard-main"><div className="wizard-topline"><span>New production workflow</span><span>Step {String(currentStepIndex + 1).padStart(2, '0')} of {wizardSteps.length}</span></div><div className="wizard-progress"><span style={{ width: `${((currentStepIndex + 1) / wizardSteps.length) * 100}%` }} /></div><div className="wizard-content">{step === 'start' && <StartStep />}{step === 'source' && <SourceStep source={source} setSource={setSource} prompt={prompt} setPrompt={setPrompt} designCount={designCount} setDesignCount={setDesignCount} onFiles={onFiles} />}{step === 'review' && <ReviewStep selectedDesigns={selectedDesigns} setSelectedDesigns={setSelectedDesigns} source={source} uploadedFiles={uploadedFiles} />}{step === 'products' && <ProductsStep selectedProducts={selectedProducts} toggleProduct={toggleProduct} selectedTemplates={selectedTemplates} toggleTemplate={toggleTemplate} products={products} mockups={mockups} />}{step === 'destinations' && <DestinationsStep destinations={destinations} setDestinations={setDestinations} />}{step === 'summary' && <SummaryStep source={source} prompt={prompt} designCount={source === 'ai' ? designCount : selectedDesigns.length} products={products} mockups={mockups} selectedProducts={selectedProducts} destinations={destinations} />}</div><div className="wizard-footer"><button className="back-button" onClick={currentStepIndex === 0 ? onClose : onBack}>{currentStepIndex === 0 ? 'Cancel' : '← Back'}</button>{isSummary ? <button className="primary-button launch-button" onClick={onLaunch}>Launch workflow <span>↗</span></button> : <button className="primary-button" disabled={!canContinue} onClick={onNext}>Continue <span>→</span></button>}</div></section></div></div>
}

function StartStep() { return <div className="wizard-intro"><span className="big-step-mark">01</span><span className="section-kicker">Start with intention</span><h2>What are we<br /><em>making today?</em></h2><p>Build a repeatable production line for your next collection. You can reuse this workflow as many times as you like.</p><div className="start-options"><div className="start-option selected"><div className="option-icon">✦</div><div><strong>Start from scratch</strong><small>Design your production line step by step.</small></div><span className="radio-dot" /></div><div className="start-option"><div className="option-icon muted">↺</div><div><strong>Use an existing workflow</strong><small>Start from one of your saved recipes.</small></div><span className="radio-dot empty" /></div></div></div> }

function SourceStep({ source, setSource, prompt, setPrompt, designCount, setDesignCount, onFiles }: Pick<WizardProps, 'source' | 'setSource' | 'prompt' | 'setPrompt' | 'designCount' | 'setDesignCount' | 'onFiles'>) { return <div className="wizard-form-step"><span className="big-step-mark">02</span><span className="section-kicker">Design source</span><h2>Bring the idea to<br /><em>life.</em></h2><p>Start with a theme and let your configured provider create a consistent collection — or bring your own artwork.</p><div className="source-toggle"><button className={source === 'ai' ? 'selected' : ''} onClick={() => setSource('ai')}><span>✦</span> Generate with AI</button><button className={source === 'upload' ? 'selected' : ''} onClick={() => setSource('upload')}><span>↥</span> Upload existing</button></div>{source === 'ai' ? <div className="form-stack"><label>Collection theme<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label><div className="form-columns"><label>Number of designs<div className="number-control"><button onClick={() => setDesignCount(Math.max(1, designCount - 1))}>−</button><strong>{designCount}</strong><button onClick={() => setDesignCount(Math.min(100, designCount + 1))}>＋</button></div></label><label>Image provider<select defaultValue="openrouter"><option>OpenRouter</option><option>Fal.ai</option><option>Local ComfyUI</option></select></label></div><div className="info-note"><span>✧</span><span>Using <strong>OpenRouter · Nano Banana</strong>. The provider can be changed later without changing your workflow.</span></div></div> : <div className="upload-zone"><span>↥</span><strong>Drop your designs here</strong><small>PNG, JPG or WEBP · up to 100 files</small><button className="outline-button" onClick={() => document.getElementById('design-upload')?.click()}>Browse files</button><input id="design-upload" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => onFiles(event.target.files)} /></div>}</div> }

function ReviewStep({ selectedDesigns, setSelectedDesigns, source, uploadedFiles }: Pick<WizardProps, 'selectedDesigns' | 'setSelectedDesigns' | 'source' | 'uploadedFiles'>) { const reviewItems = source === 'upload' && uploadedFiles.length > 0 ? uploadedFiles.map((file, index) => ({ id: file.id, title: file.name, subtitle: `${String(index + 1).padStart(2, '0')} / ${uploadedFiles.length}`, background: `url(${file.url}) center / cover`, accent: '#fff', icon: '' })) : designArt; const allSelected = selectedDesigns.length === reviewItems.length; return <div className="wizard-form-step review-step"><div className="step-heading-row"><div><span className="big-step-mark">03</span><span className="section-kicker">Approval checkpoint</span><h2>Choose your<br /><em>strongest ideas.</em></h2><p>{source === 'ai' ? 'The first pass is ready. Select the designs worth taking into production.' : 'Review the designs you uploaded before creating any mockups.'}</p></div><div className="review-count"><strong>{selectedDesigns.length}</strong><small>selected</small></div></div><div className="review-toolbar"><span>Showing {reviewItems.length} designs</span><button onClick={() => setSelectedDesigns(allSelected ? [] : reviewItems.map((design) => design.id))}>{allSelected ? 'Deselect all' : 'Select all'}</button></div><div className="design-review-grid">{reviewItems.map((design) => { const selected = selectedDesigns.includes(design.id); return <button className={`review-design ${selected ? 'selected' : ''}`} key={design.id} onClick={() => setSelectedDesigns(selected ? selectedDesigns.filter((id) => id !== design.id) : [...selectedDesigns, design.id])}><div className="review-art" style={{ background: design.background, color: design.accent }}><span>{design.icon}</span><small>{design.title}</small></div><div className="review-meta"><span>{design.subtitle}</span><i>{selected ? '✓' : ''}</i></div></button> })}</div></div> }

function ProductsStep({ selectedProducts, toggleProduct, selectedTemplates, toggleTemplate, products, mockups }: Pick<WizardProps, 'selectedProducts' | 'toggleProduct' | 'selectedTemplates' | 'toggleTemplate' | 'products' | 'mockups'>) { return <div className="wizard-form-step products-step"><span className="big-step-mark">04</span><span className="section-kicker">Fan out the collection</span><h2>Make products,<br /><em>not just images.</em></h2><p>One approved design can become many product variants. Choose the products, then assign intentional mockup templates.</p><div className="product-selector">{productOptions.map((product) => <button className={`product-choice ${selectedProducts.includes(product.id) ? 'selected' : ''}`} key={product.id} onClick={() => toggleProduct(product.id)}><span className="product-emoji" style={{ background: product.color }}>{product.emoji}</span><span><strong>{product.label}</strong><small>{product.description}</small></span><i>{selectedProducts.includes(product.id) ? '✓' : '+'}</i></button>)}</div><div className="selection-summary"><div><strong>{products}</strong><small>product variants</small></div><div className="summary-divider" /><div><strong>{mockups}</strong><small>mockup outputs</small></div><span>per {selectedProducts.length || 0} product types</span></div><div className="template-config"><div className="subheading-row"><div><strong>Mockup templates</strong><small>AI scenes are always template-driven.</small></div><button className="text-button">Manage library →</button></div><div className="template-config-list">{templateCatalog.filter((template) => selectedProducts.includes(template.productType)).map((template) => <button className={`template-config-row ${selectedTemplates.some((item) => item.id === template.id) ? 'selected' : ''}`} key={template.id} onClick={() => toggleTemplate(template.id)}><span className={`template-thumb ${template.kind === 'generative' ? 'ai' : 'deterministic'}`}>{template.kind === 'generative' ? '✦' : '▧'}</span><span><strong>{template.name}</strong><small>{template.productType.replace('-', ' ')} · {template.kind === 'generative' ? 'AI template' : 'Deterministic'}</small></span><b>{selectedTemplates.find((item) => item.id === template.id)?.quantity ?? 0}</b><i>{selectedTemplates.some((item) => item.id === template.id) ? '✓' : '+'}</i></button>)}</div></div></div> }

function DestinationsStep({ destinations, setDestinations }: Pick<WizardProps, 'destinations' | 'setDestinations'>) { const toggle = (id: string) => setDestinations(destinations.includes(id) ? destinations.filter((item) => item !== id) : [...destinations, id]); return <div className="wizard-form-step"><span className="big-step-mark">05</span><span className="section-kicker">Where it goes</span><h2>Choose your<br /><em>destinations.</em></h2><p>Publish when you're ready, or keep a structured export as your source of truth. You can select more than one.</p><div className="destination-list"><DestinationRow id="etsy" selected={destinations.includes('etsy')} onToggle={toggle} icon="e" title="Etsy" detail="Create drafts or publish listings" badge="Connected" tone="orange" /><DestinationRow id="tpublic" selected={destinations.includes('tpublic')} onToggle={toggle} icon="T" title="TeePublic" detail="Product destination adapter" badge="Coming soon" tone="dark" /><DestinationRow id="drive" selected={destinations.includes('drive')} onToggle={toggle} icon="△" title="Google Drive" detail="Sync a copy to your connected folder" badge="Connected" tone="blue" /><DestinationRow id="download" selected={destinations.includes('download')} onToggle={toggle} icon="↓" title="Structured download" detail="Always available as a ZIP export" badge="Included" tone="violet" /></div><div className="storage-note"><span>◉</span><span>Assets are permanently stored in your connected <strong>workspace storage</strong>. Self-hosted deployments can use the local filesystem.</span></div></div> }

function DestinationRow({ id, selected, onToggle, icon, title, detail, badge, tone }: { id: string; selected: boolean; onToggle: (id: string) => void; icon: string; title: string; detail: string; badge: string; tone: string }) { return <button className={`destination-row ${selected ? 'selected' : ''}`} onClick={() => onToggle(id)}><span className={`destination-icon ${tone}`}>{icon}</span><span><strong>{title}</strong><small>{detail}</small></span><em>{badge}</em><i>{selected ? '✓' : '+'}</i></button> }

function SummaryStep({ source, prompt, designCount, products, mockups, selectedProducts, destinations }: { source: 'ai' | 'upload'; prompt: string; designCount: number; products: number; mockups: number; selectedProducts: ProductType[]; destinations: string[] }) { return <div className="wizard-form-step summary-step"><span className="big-step-mark">06</span><span className="section-kicker">Ready when you are</span><h2>Your production line<br /><em>looks good.</em></h2><p>We’ll create the workflow, snapshot this configuration as version 01, and queue each unit of work independently.</p><div className="summary-flow"><div className="flow-block"><span>01</span><strong>{source === 'ai' ? 'Generate designs' : 'Import designs'}</strong><small>{source === 'ai' ? `${designCount} variations · OpenRouter` : `${designCount} selected assets`}</small></div><i>→</i><div className="flow-block"><span>02</span><strong>Fan out variants</strong><small>{selectedProducts.length} product types · {products} total</small></div><i>→</i><div className="flow-block"><span>03</span><strong>Render mockups</strong><small>{mockups} template outputs</small></div><i>→</i><div className="flow-block"><span>04</span><strong>Deliver</strong><small>{destinations.length} destinations</small></div></div><div className="summary-prompt"><span>Prompt</span><strong>{source === 'ai' ? `“${prompt}”` : 'Uploaded design collection'}</strong></div><div className="approval-row"><span className="pulse-dot" /><span>Design review checkpoint is enabled</span><span className="approval-policy">Review before mockups</span></div></div> }

export { App }
