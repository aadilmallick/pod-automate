import { useEffect, useMemo, useState } from 'react'
import FsLightbox from 'fslightbox-react'
import type { ProductType } from './core/interfaces/providers'
import { estimateMockups, estimateProducts } from './core/workflow'
import { productOptions } from './data/catalog'
import { createDevSession, createPromptTemplate, createRun, deletePromptTemplate, getAuthStatus, getDashboardCatalog, getRun, logout, testConnection, updateConnection, updatePromptTemplate, uploadAsset, type DashboardCatalog, type SessionUser } from './client/api'

type View = 'dashboard' | 'workflows' | 'templates' | 'connections' | 'assets' | 'run'
type WizardStep = 'start' | 'source' | 'review' | 'products' | 'destinations' | 'summary'

const navItems: Array<{ id: View; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Overview', icon: '⌂' },
  { id: 'workflows', label: 'Workflows', icon: '⌁' },
  { id: 'templates', label: 'Templates', icon: '▦' },
  { id: 'connections', label: 'Connections', icon: '↗' },
  { id: 'assets', label: 'Asset library', icon: '◉' },
]

const emptyCatalog: DashboardCatalog = { stats: { workflows: 0, assets: 0, readyListings: 0 }, connections: [], runs: [], assets: [], templates: [], promptTemplates: [], listings: [] }

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
  const [selectedProvider, setSelectedProvider] = useState('fal')
  const [selectedModel, setSelectedModel] = useState('')
  const [prompt, setPrompt] = useState('Funny cat designs for people who take their naps seriously')
  const [designCount, setDesignCount] = useState(12)
  const [selectedDesigns, setSelectedDesigns] = useState<string[]>([])
  const [selectedProducts, setSelectedProducts] = useState<ProductType[]>(['tshirt', 'hoodie', 'sweatshirt'])
  const [selectedTemplates, setSelectedTemplates] = useState<DashboardCatalog['templates']>([])
  const [catalog, setCatalog] = useState<DashboardCatalog>(emptyCatalog)
  const [destinations, setDestinations] = useState<string[]>(['etsy', 'download'])
  const [launched, setLaunched] = useState(false)
  const [runId, setRunId] = useState<string | undefined>()
  const [launchError, setLaunchError] = useState<string | undefined>()
  const [authMode, setAuthMode] = useState<'development' | 'google'>('development')
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ id: string; name: string; url: string; previewUrl?: string }>>([])
  const [templateEditor, setTemplateEditor] = useState<{ id?: string; name: string; prompt: string; provider: string; model: string; description: string } | null>(null)
  const [connectionEditor, setConnectionEditor] = useState<DashboardCatalog['connections'][number] | null>(null)
  const [connectionModel, setConnectionModel] = useState('')
  const [connectionEnabled, setConnectionEnabled] = useState(true)
  const [connectionMessage, setConnectionMessage] = useState<string | undefined>()
  const [lightbox, setLightbox] = useState<{ sources: string[]; index: number } | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const config = useMemo(() => ({
    designs: source === 'ai' ? designCount : selectedDesigns.length,
    products: selectedProducts,
    templates: selectedTemplates,
    destinations,
  }), [designCount, destinations, selectedDesigns.length, selectedProducts, selectedTemplates, source])

  const products = estimateProducts(config)
  const mockups = estimateMockups(config)
  const currentStepIndex = wizardSteps.findIndex((step) => step.id === wizardStep)

  useEffect(() => {
    let active = true
    async function loadWorkspace() {
      try {
        let status = await getAuthStatus()
        const signedOut = sessionStorage.getItem('pod_signed_out') === '1'
        if (signedOut) sessionStorage.removeItem('pod_signed_out')
        if (status.mode === 'development' && !status.authenticated && !signedOut) {
          await createDevSession()
          status = await getAuthStatus()
        }
        if (!active) return
        setAuthMode(status.mode)
        setSessionUser(status.user)
        if (status.authenticated) {
          const workspaceCatalog = await getDashboardCatalog()
          if (active) {
            setCatalog(workspaceCatalog)
            setSelectedModel((current) => current || workspaceCatalog.connections.find((connection) => connection.id === 'fal')?.defaultModel || '')
            setSelectedTemplates((current) => current.length ? current : workspaceCatalog.templates)
          }
        }
      } catch (error) {
        if (active) setLaunchError(error instanceof Error ? error.message : 'Unable to load workspace')
      }
    }
    void loadWorkspace()
    return () => { active = false }
  }, [])

  function openWizard() {
    setWizardStep('start')
    setShowWizard(true)
  }

  function openTemplateEditor(template?: DashboardCatalog['promptTemplates'][number]) {
    setTemplateEditor(template ? { id: template.id, name: template.name, prompt: template.prompt, provider: template.provider, model: template.model ?? '', description: template.description ?? '' } : { name: '', prompt: '', provider: 'fal', model: catalog.connections.find((connection) => connection.id === 'fal')?.defaultModel ?? '', description: '' })
  }

  function usePromptTemplate(template: DashboardCatalog['promptTemplates'][number]) {
    setPrompt(template.prompt)
    setSelectedProvider(template.provider)
    setSelectedModel(template.model ?? '')
    setActiveView('dashboard')
    openWizard()
  }

  async function saveTemplate() {
    if (!templateEditor) return
    try {
      if (templateEditor.id) await updatePromptTemplate(templateEditor.id, templateEditor)
      else await createPromptTemplate(templateEditor)
      setCatalog(await getDashboardCatalog())
      setTemplateEditor(null)
    } catch (error) { setLaunchError(error instanceof Error ? error.message : 'Unable to save prompt template') }
  }

  async function removeTemplate() {
    if (!templateEditor?.id) return
    try { await deletePromptTemplate(templateEditor.id); setCatalog(await getDashboardCatalog()); setTemplateEditor(null) } catch (error) { setLaunchError(error instanceof Error ? error.message : 'Unable to delete prompt template') }
  }

  function openConnectionEditor(connection: DashboardCatalog['connections'][number]) {
    setConnectionEditor(connection)
    setConnectionModel(connection.defaultModel)
    setConnectionEnabled(connection.enabled && connection.configured)
    setConnectionMessage(undefined)
  }

  async function saveConnection() {
    if (!connectionEditor) return
    try { await updateConnection(connectionEditor.id, { defaultModel: connectionModel, enabled: connectionEnabled }); setCatalog(await getDashboardCatalog()); setConnectionEditor(null) } catch (error) { setConnectionMessage(error instanceof Error ? error.message : 'Unable to save connection') }
  }

  async function runConnectionTest() {
    if (!connectionEditor) return
    try { const response = await testConnection(connectionEditor.id, connectionModel); setConnectionMessage(response.message) } catch (error) { setConnectionMessage(error instanceof Error ? error.message : 'Connection test failed') }
  }

  function nextStep() {
    const next = wizardSteps[currentStepIndex + 1]
    if (next) setWizardStep(next.id)
  }

  function previousStep() {
    const previous = wizardSteps[currentStepIndex - 1]
    if (previous) setWizardStep(previous.id)
  }

  async function launchWorkflow() {
    setLaunchError(undefined)
    try {
      const response = await createRun({ name: 'Funny cat collection', prompt, count: source === 'ai' ? designCount : selectedDesigns.length, products: selectedProducts, destinations, provider: selectedProvider, model: selectedModel || catalog.connections.find((connection) => connection.id === selectedProvider)?.defaultModel, templates: selectedTemplates, assetIds: source === 'upload' ? selectedDesigns : [] })
      setRunId(response.run.id)
      setLaunched(true)
      setShowWizard(false)
      setActiveView('run')
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : 'Unable to queue workflow')
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return
    try {
      const nextFiles = await Promise.all(Array.from(files).map(async (file) => ({ ...(await uploadAsset(file)), previewUrl: URL.createObjectURL(file) })))
      setUploadedFiles(nextFiles)
      setSelectedDesigns(nextFiles.map((file) => file.id))
      const workspaceCatalog = await getDashboardCatalog()
      setCatalog(workspaceCatalog)
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : 'Unable to upload designs')
    }
  }

  function toggleProduct(id: ProductType) {
    setSelectedProducts((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function toggleTemplate(id: string) {
    setSelectedTemplates((current) => {
      const template = catalog.templates.find((item) => item.id === id)
      if (!template) return current
      return current.some((item) => item.id === id) ? current.filter((item) => item.id !== id) : [...current, template]
    })
  }

  async function signOut() {
    try {
      await logout()
      sessionStorage.setItem('pod_signed_out', '1')
      setSessionUser(null)
      setProfileMenuOpen(false)
      setCatalog(emptyCatalog)
      window.location.reload()
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : 'Unable to sign out')
    }
  }

  const activeCatalog = catalog

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><span>✦</span></div>
          <div><strong>pod automator</strong><small>production workspace</small></div>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">AM</div>
          <div className="workspace-copy"><small>Workspace</small><strong>{sessionUser ? `${sessionUser.name}'s studio` : 'Local workspace'}</strong></div>
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
          <div className="profile-row"><div className="profile-avatar">{sessionUser?.name?.slice(0, 1).toUpperCase() ?? 'A'}</div><div><strong>{sessionUser?.name ?? 'Local workspace'}</strong><small>{sessionUser?.email ?? 'Not signed in'}</small></div><span className="more">•••</span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{activeView === 'dashboard' ? 'Overview' : navItems.find((item) => item.id === activeView)?.label}</strong></div>
          <div className="top-actions"><button className="icon-button" aria-label="Search">⌕</button><button className="icon-button notification" aria-label="Notifications">♧<i /></button>{authMode === 'google' && !sessionUser ? <a className="login-link" href="/api/auth/google">Sign in with Google</a> : <div className="profile-menu-wrap"><button className="top-avatar profile-trigger" aria-label="Open profile menu" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((open) => !open)}>{sessionUser?.name?.slice(0, 2).toUpperCase() ?? 'AM'}</button>{profileMenuOpen && <div className="profile-menu"><div className="profile-menu-user"><strong>{sessionUser?.name ?? 'Local workspace'}</strong><small>{sessionUser?.email ?? 'Not signed in'}</small></div><button onClick={() => void signOut()}>Sign out <span>↗</span></button></div>}</div>}</div>
        </header>

        {activeView === 'dashboard' && <Dashboard catalog={activeCatalog} user={sessionUser} onCreate={openWizard} onAddTemplate={() => openTemplateEditor()} onViewTemplates={() => setActiveView('templates')} onViewHistory={() => setActiveView('workflows')} launched={launched} launchError={launchError} onViewRun={(id) => { if (id) setRunId(id); setActiveView('run') }} onManageConnection={openConnectionEditor} />}
        {activeView === 'workflows' && <Workflows catalog={activeCatalog} onCreate={openWizard} onViewRun={(id) => { setRunId(id); setActiveView('run') }} />}
        {activeView === 'templates' && <Templates catalog={activeCatalog} onCreate={() => openTemplateEditor()} onEdit={openTemplateEditor} onUse={usePromptTemplate} />}
        {activeView === 'connections' && <Connections catalog={activeCatalog} onManage={openConnectionEditor} />}
        {activeView === 'assets' && <Assets catalog={activeCatalog} onCreate={openWizard} onPreview={(index) => { setLightbox({ sources: activeCatalog.assets.map((asset) => asset.url), index }); setLightboxOpen((open) => !open) }} />}
        {activeView === 'run' && <RunMonitor catalog={activeCatalog} onDashboard={() => setActiveView('dashboard')} runId={runId} />}
      </main>

      {showWizard && <WizardModal
        step={wizardStep}
        currentStepIndex={currentStepIndex}
        source={source}
        setSource={setSource}
        selectedProvider={selectedProvider}
        setSelectedProvider={(provider) => { setSelectedProvider(provider); setSelectedModel(catalog.connections.find((connection) => connection.id === provider)?.defaultModel ?? '') }}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        availableConnections={catalog.connections}
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
        availableTemplates={catalog.templates}
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
      {templateEditor && <TemplateEditor template={templateEditor} onChange={setTemplateEditor} onClose={() => setTemplateEditor(null)} onSave={() => void saveTemplate()} onDelete={templateEditor.id ? () => void removeTemplate() : undefined} />}
      {connectionEditor && <ConnectionModal connection={connectionEditor} model={connectionModel} enabled={connectionEnabled} message={connectionMessage} onModel={setConnectionModel} onEnabled={setConnectionEnabled} onClose={() => setConnectionEditor(null)} onSave={() => void saveConnection()} onTest={() => void runConnectionTest()} />}
      {lightbox && <FsLightbox toggler={lightboxOpen} sources={lightbox.sources} slide={lightbox.index + 1} onClose={() => { setLightbox(null); setLightboxOpen(false) }} />}
    </div>
  )
}

function Dashboard({ catalog, user, onCreate, onAddTemplate, onViewTemplates, onViewHistory, launched, launchError, onViewRun, onManageConnection }: { catalog: DashboardCatalog; user: SessionUser | null; onCreate: () => void; onAddTemplate: () => void; onViewTemplates: () => void; onViewHistory: () => void; launched: boolean; launchError?: string; onViewRun: (id?: string) => void; onManageConnection: (connection: DashboardCatalog['connections'][number]) => void }) {
  const latestRun = catalog.runs[0]
  const displayName = user?.name?.split(/\s+/)[0] ?? 'there'
  const pipelineConnections = catalog.connections.filter((connection) => connection.id !== 'storage')
  return <div className="page-wrap">
    {launched && <div className="launch-toast"><span className="pulse-dot" /><strong>Workflow launched.</strong><span>Jobs are queued and will appear in run history.</span></div>}
    {launchError && <div className="launch-toast error-toast"><strong>Could not queue workflow.</strong><span>{launchError}</span></div>}
    <section className="page-heading dashboard-heading">
      <div><div className="eyebrow"><span className="eyebrow-line" /><span>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span></div><h1>Good morning, {displayName}<span className="heading-period">.</span></h1><p>Turn an idea into a ready-to-publish product line.</p></div>
      <button className="primary-button" onClick={onCreate}><span>＋</span> New workflow</button>
    </section>

    <section className="hero-card">
      <div className="hero-copy"><span className="hero-kicker">Production at a glance</span><h2>{latestRun ? `${latestRun.name} is` : 'Your next collection is'}<br /><em>{latestRun ? latestRun.status : 'almost ready'}.</em></h2><p>{latestRun ? `${latestRun.detail}.` : 'Launch a workflow to generate designs, render mockups and prepare listings in the background.'}<br />Your workspace data stays persisted between sessions.</p><button className="dark-button" onClick={latestRun ? () => onViewRun(latestRun.id) : onCreate}>{latestRun ? 'View latest run' : 'Start a workflow'} <span>↗</span></button></div>
      <div className="hero-visual"><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-sticker sticker-top">{latestRun ? `RUN ${latestRun.id.slice(0, 6).toUpperCase()}` : 'NO ACTIVE RUN'} <span>• {latestRun?.status?.toUpperCase() ?? 'READY'}</span></div><div className="hero-art hero-art-one"><span>☾</span><small>CAT NAP<br />CHAMPION</small></div><div className="hero-art hero-art-two"><span>◒</span><small>PRO<br />LOAF</small></div><div className="hero-art hero-art-three"><span>✦</span><small>SNACK<br />SUPERVISOR</small></div><div className="hero-sticker sticker-bottom"><span className="pulse-dot" /> {latestRun ? `${latestRun.progress}% complete` : 'Launch your first run'}</div></div>
    </section>

    <section className="metric-grid">
      <MetricCard label="Active workflows" value={String(catalog.stats.workflows).padStart(2, '0')} note="Saved in this workspace" trend="neutral" icon="⌁" />
      <MetricCard label="Assets processed" value={catalog.stats.assets.toLocaleString()} note="Persisted source and outputs" trend="neutral" icon="◉" />
      <MetricCard label="Ready to publish" value={catalog.stats.readyListings.toLocaleString()} note="Drafts and exports" trend="neutral" icon="↗" />
      <MetricCard label="Time saved" value="—" note="Calculated from completed runs" trend="neutral" icon="◷" />
    </section>

    <div className="content-grid">
      <section className="panel recent-panel"><div className="panel-heading"><div><span className="section-kicker">Production runs</span><h3>Recent workflows</h3></div><button className="text-button" onClick={onViewHistory}>View all <span>→</span></button></div><div className="run-list">{catalog.runs.slice(0, 4).map((run) => <RunRow key={run.id} run={run} onClick={() => onViewRun(run.id)} />)}</div></section>
      <section className="panel pipeline-panel"><div className="panel-heading"><div><span className="section-kicker">Your system</span><h3>Pipeline health</h3></div><span className="healthy-pill"><i /> {pipelineConnections.every((connection) => connection.configured) ? 'All systems healthy' : 'Action needed'}</span></div><div className="pipeline-stack">{pipelineConnections.map((connection, index) => <PipelineRow key={connection.id} label={connection.name} provider={connection.detail} status={connection.configured ? 'Connected' : 'Not connected'} progress={connection.configured ? '100%' : '—'} tone={['violet', 'orange', 'blue'][index % 3]} />)}<PipelineRow label="Asset processing" provider="Sharp · Local" status="Connected" progress="100%" tone="mint" /></div><button className="outline-button full-button" onClick={() => pipelineConnections[0] && onManageConnection(pipelineConnections[0])}>Manage connections <span>→</span></button></section>
    </div>

    <section className="lower-section"><div className="lower-heading"><div><span className="section-kicker">Reusable building blocks</span><h3>Template library</h3></div><button className="text-button" onClick={onViewTemplates}>Browse templates <span>→</span></button></div><div className="template-strip">{catalog.templates.slice(0, 4).map((template, index) => <TemplateCard key={template.id} template={template} index={index} />)}<div className="add-template-card" onClick={onAddTemplate}><span>＋</span><strong>Add a template</strong><small>Make your next run more consistent</small></div></div></section>
  </div>
}

function MetricCard({ label, value, note, trend, icon }: { label: string; value: string; note: string; trend: 'up' | 'neutral'; icon: string }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><b>{icon}</b></div><div className="metric-value">{value}</div><div className={`metric-note ${trend === 'up' ? 'positive' : ''}`}>{trend === 'up' && <span>↗</span>} {note}</div></div>
}

function RunRow({ run, onClick }: { run: { id: string; name: string; detail: string; status: string; progress: number; date: string; accent?: string }; onClick?: () => void }) {
  return <button className="run-row run-row-button" onClick={onClick}><div className="run-symbol" style={{ background: run.accent ?? '#6d5ce7' }}>{run.name.slice(0, 1)}</div><div className="run-name"><strong>{run.name}</strong><small>{run.detail}</small></div><div className="run-progress"><div className="progress-label"><span>{run.status === 'running' ? `${run.progress}% complete` : run.status}</span><small>{run.date}</small></div><div className="progress-track"><span style={{ width: `${run.progress}%`, background: run.accent ?? '#6d5ce7' }} /></div></div><span className="row-action">↗</span></button>
}

function PipelineRow({ label, provider, status, progress, tone }: { label: string; provider: string; status: string; progress: string; tone: string }) {
  return <div className="pipeline-row"><span className={`pipeline-icon ${tone}`}>✦</span><div><strong>{label}</strong><small>{provider}</small></div><div className="pipeline-status"><span>{status}</span><i /></div><b>{progress}</b></div>
}

function TemplateCard({ template, index }: { template: DashboardCatalog['templates'][number]; index: number }) {
  const colors = ['peach', 'lavender', 'mint', 'sky']
  return <div className="template-card"><div className={`template-art ${colors[index]}`}><span>{template.productType === 'tshirt' ? '✦' : template.productType === 'hoodie' ? '◒' : '▤'}</span><small>{template.kind === 'generative' ? 'AI SCENE' : 'STUDIO'}</small></div><div className="template-info"><strong>{template.name}</strong><small>{template.productType.replace('-', ' ')} · {template.kind === 'generative' ? 'Generative' : 'Deterministic'}</small></div><button className="mini-more">•••</button></div>
}

function Workflows({ catalog, onCreate, onViewRun }: { catalog: DashboardCatalog; onCreate: () => void; onViewRun: (id: string) => void }) {
  return <div className="page-wrap"><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> Workspace / run history</div><h1>Run history<span className="heading-period">.</span></h1><p>Open any workflow to inspect live status, jobs, listings and generated results.</p></div><button className="primary-button" onClick={onCreate}><span>＋</span> New workflow</button></section><div className="workflow-feature"><div className="workflow-feature-copy"><span className="hero-kicker">Recommended starting point</span><h2>AI designs →<br /><em>marketplace ready.</em></h2><p>A guided production line with approval checkpoints, reusable mockups and destination-aware exports.</p><button className="dark-button" onClick={onCreate}>Use this workflow <span>→</span></button></div><div className="workflow-nodes">{['Create designs', 'Review selection', 'Fan out products', 'Render templates', 'Publish'].map((node, index) => <div className="workflow-node" key={node}><span>{String(index + 1).padStart(2, '0')}</span><strong>{node}</strong>{index < 4 && <i>↓</i>}</div>)}</div></div><div className="section-heading-row"><h3>Past workflow runs <span>{catalog.runs.length}</span></h3><span className="history-hint">Click a row to view results ↗</span></div><section className="workflow-table">{catalog.runs.length ? catalog.runs.map((run) => <button className="workflow-table-row workflow-table-button" key={run.id} onClick={() => onViewRun(run.id)}><div className="run-symbol" style={{ background: run.accent ?? '#6d5ce7' }}>{run.name.slice(0, 1)}</div><div><strong>{run.name}</strong><small>Started {new Date(run.date).toLocaleString()}</small></div><span className="table-detail">{run.detail}</span><span className={`status-badge ${run.status === 'completed' ? 'ready' : run.status.toLowerCase()}`}>{run.status}</span><span className="row-action">↗</span></button>) : <div className="empty-state"><strong>No workflow runs yet.</strong><small>Launch a workflow and it will appear here.</small></div>}</section></div>
}

function Templates({ catalog, onCreate, onEdit, onUse }: { catalog: DashboardCatalog; onCreate: () => void; onEdit: (template: DashboardCatalog['promptTemplates'][number]) => void; onUse: (template: DashboardCatalog['promptTemplates'][number]) => void }) {
  return <div className="page-wrap"><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> Workspace / AI prompt library</div><h1>Prompt templates<span className="heading-period">.</span></h1><p>Save repeatable image prompts and default providers for your next collection.</p></div><button className="primary-button" onClick={onCreate}><span>＋</span> Add a template</button></section><div className="prompt-template-grid">{catalog.promptTemplates.map((template, index) => <button className="prompt-template-card" key={template.id} onClick={() => onEdit(template)}><div className={`library-art ${['peach', 'lavender', 'mint', 'sky', 'yellow'][index % 5]}`}><span>✦</span><div>{template.provider.toUpperCase()} · {template.model || 'Default model'}</div></div><div className="prompt-template-body"><div><strong>{template.name}</strong><small>{template.description || template.prompt}</small></div><span className="template-card-actions"><span className="edit-chip">Edit ↗</span><span className="use-chip" onClick={(event) => { event.stopPropagation(); onUse(template) }}>Use</span></span></div></button>)}<button className="empty-library-card" onClick={onCreate}><span>＋</span><strong>Create an AI prompt</strong><small>Save a prompt, provider and model together.</small></button></div></div>
}

function Connections({ catalog, onManage }: { catalog: DashboardCatalog; onManage: (connection: DashboardCatalog['connections'][number]) => void }) {
  const connections = catalog.connections.filter((connection) => connection.id !== 'storage').map((connection) => ({ ...connection, status: connection.configured ? 'Connected' : 'Not connected', color: connection.id === 'openrouter' ? 'violet' : connection.id === 'fal' ? 'dark' : connection.id === 'huggingface' ? 'blue' : 'mint', mark: connection.id === 'openrouter' ? '✦' : connection.id === 'fal' ? 'f' : connection.id === 'huggingface' ? 'hf' : '◉' }))
  return <div className="page-wrap"><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> Workspace / connections</div><h1>Connections<span className="heading-period">.</span></h1><p>Providers are configured here, never inside your workflow logic.</p></div><button className="outline-button" onClick={() => connections[0] && onManage(connections[0])}>＋ Manage providers</button></section><div className="connection-grid">{connections.map((connection) => <div className="connection-card" key={connection.name}><div className={`connection-mark ${connection.color}`}>{connection.mark}</div><div className="connection-copy"><strong>{connection.name}</strong><small>{connection.detail}</small><small className="connection-model">Default model · {connection.defaultModel || 'Not applicable'}</small></div><span className={`connection-status ${connection.status === 'Connected' ? 'connected' : 'not-connected'}`}><i /> {connection.status}</span><button className="outline-button small-button" onClick={() => onManage(connection)}>{connection.status === 'Connected' ? 'Manage' : 'Connect'}</button></div>)}</div><div className="principle-card"><div className="principle-mark">⌘</div><div><span className="section-kicker">Interface-first architecture</span><h3>Swap providers without rebuilding your workflows.</h3><p>Choose a default model, verify credentials and keep provider configuration out of your workflow logic.</p></div><div className="code-pills"><span>Default model</span><span>Test connection</span><span>Provider adapter</span></div></div></div>
}

function RunMonitor({ catalog, onDashboard, runId }: { catalog: DashboardCatalog; onDashboard: () => void; runId?: string }) {
  const [liveRun, setLiveRun] = useState<{ status: string; progressPercent: number } | undefined>()
  const [liveCatalog, setLiveCatalog] = useState<DashboardCatalog | undefined>()
  const [liveJobs, setLiveJobs] = useState<Array<{ id: string; stepName: string; status: string; errorLog?: string | null }>>([])
  const [liveListings, setLiveListings] = useState<DashboardCatalog['listings']>([])
  const [liveAssets, setLiveAssets] = useState<Array<{ id: string; name: string; url: string; type: string; contentType: string }>>([])
  useEffect(() => {
    if (!runId) return
    let active = true
    const poll = async () => { try { const [response, updatedCatalog] = await Promise.all([getRun(runId), getDashboardCatalog()]); if (active) { setLiveRun(response.run); setLiveCatalog(updatedCatalog); setLiveJobs(response.jobs); setLiveAssets([...response.assets, ...response.mockups.map((mockup) => ({ id: mockup.id, name: mockup.storagePath.split('/').pop() ?? 'Mockup', url: mockup.url, type: 'mockup', contentType: mockup.storagePath.endsWith('.png') ? 'image/png' : 'image/svg+xml' }))]); setLiveListings(response.listings.map((listing, index) => { const metadata = listing.metadata as { title?: string; tags?: string[] }; return { id: listing.id, title: metadata.title ?? `${listing.marketplace} listing`, type: listing.marketplace, status: listing.status, tags: metadata.tags ?? [], background: ['linear-gradient(135deg, #f5b47e 0%, #ffdcb0 100%)', 'linear-gradient(135deg, #a7c7ff 0%, #dae7ff 100%)'][index % 2], accent: '#45251b', icon: '✦' } })) } } catch { /* API may still be starting */ } }
    void poll()
    const timer = window.setInterval(() => void poll(), 2500)
    return () => { active = false; window.clearInterval(timer) }
  }, [runId])
  const viewCatalog = liveCatalog ?? catalog
  const currentRun = viewCatalog.runs.find((run) => run.id === runId)
  const progress = liveRun?.progressPercent ?? (currentRun?.progress ?? 0)
  const runListings = liveListings
  const isCompleted = liveRun?.status === 'completed'
  return <div className="page-wrap"><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> Run / {currentRun?.name ?? 'production workflow'}</div><h1>{currentRun?.name ?? 'Production'} is moving<span className="heading-period">.</span></h1><p>Every step runs independently. You can leave this page and come back anytime. {liveRun && `Status: ${liveRun.status}.`}</p></div><button className="outline-button" onClick={onDashboard}>← Back to overview</button></section><div className="run-hero"><div><span className="hero-kicker">Run status</span><h2>{progress}% <em>complete</em></h2><p>{viewCatalog.runs.find((run) => run.id === runId)?.detail ?? 'Live run details will appear as the worker processes this workflow.'}</p></div><div className="run-hero-progress"><div className="progress-label"><span>Overall progress</span><strong>{progress}%</strong></div><div className="run-progress-large"><span style={{ width: `${progress}%` }} /></div><small>{liveRun?.status === 'completed' ? 'Completed and ready for review.' : liveRun?.status === 'failed' ? 'The worker reported an error. Review the pipeline below.' : 'Processing in the background.'}</small></div></div><div className="run-layout"><section className="panel job-panel"><div className="panel-heading"><div><span className="section-kicker">Background jobs</span><h3>Pipeline progress</h3></div><span className="healthy-pill"><i /> 28 completed</span></div><div className="job-list">{(liveJobs.length ? liveJobs : (viewCatalog.runs.find((run) => run.id === runId)?.jobs ?? [])).map((job, index) => [job.stepName, job.status, job.status, job.errorLog]).map(([label, detail, state, errorLog], index) => <div className="job-row" key={label}><span className={`job-state ${state}`}>{state === 'complete' || state === 'completed' ? '✓' : state === 'running' ? '⋯' : state === 'failed' ? '!' : String(index + 1).padStart(2, '0')}</span><div><strong>{label}</strong><small>{errorLog || detail}</small></div><span className={`job-label ${state}`}>{state === 'complete' || state === 'completed' ? 'Complete' : state === 'running' ? 'Processing' : state === 'failed' ? 'Failed' : 'Queued'}</span>{state === 'running' && <button className="text-button">Retry</button>}</div>)}</div></section><section className="panel listings-panel"><div className="panel-heading"><div><span className="section-kicker">Preview</span><h3>Listing drafts</h3></div><button className="text-button">Open all →</button></div>{runListings.slice(0, 4).map((listing) => <div className="listing-row" key={listing.id}><div className="listing-art" style={{ background: listing.background, color: listing.accent }}>{listing.icon}</div><div><strong>{listing.title}</strong><small>{listing.type} · {listing.tags.slice(0, 2).join(' · ')}</small></div><span className={`status-badge ${listing.status === 'draft' || listing.status === 'ready' ? 'ready' : 'draft'}`}>{listing.status}</span></div>)}<div className="run-assets"><div className="subheading-row"><div><strong>Generated assets</strong><small>{liveAssets.length} files persisted for this run</small></div>{isCompleted && <a className="dark-button download-button" href={`/api/runs/${runId}/export.zip`} download>Download structured ZIP <span>↓</span></a>}</div><div className="run-asset-grid">{liveAssets.slice(0, 6).map((asset) => <a className="run-asset-card" href={asset.url} target="_blank" rel="noreferrer" key={asset.id}><img src={asset.url} alt={asset.name} /><small>{asset.name}</small></a>)}</div></div></section></div></div>
}

function Assets({ catalog, onCreate, onPreview }: { catalog: DashboardCatalog; onCreate: () => void; onPreview: (index: number) => void }) {
  return <div className="page-wrap"><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> Workspace / asset library</div><h1>Asset library<span className="heading-period">.</span></h1><p>Click any asset for a full-size preview.</p></div><button className="outline-button" onClick={onCreate}>＋ Upload assets</button></section><div className="asset-toolbar"><div className="search-field">⌕ <span>Search assets</span></div><div className="filter-pills"><button className="filter-active">All assets</button><button>Generated</button><button>Uploaded</button><button>Mockups</button></div></div><div className="asset-grid">{catalog.assets.map((asset, index) => <button className="asset-card asset-card-button" key={asset.id} onClick={() => onPreview(index)}><div className="asset-art" style={{ background: asset.background, color: asset.accent }}><img src={asset.url} alt={asset.name} /><small>{asset.name}</small></div><div className="asset-card-meta"><strong>{asset.name}</strong><small>{asset.type} · {asset.contentType}</small><span className="mini-more">⌕</span></div></button>)}</div></div>
}

interface WizardProps {
  step: WizardStep
  currentStepIndex: number
  source: 'ai' | 'upload'
  setSource: (source: 'ai' | 'upload') => void
  selectedProvider: string
  setSelectedProvider: (provider: string) => void
  selectedModel: string
  setSelectedModel: (model: string) => void
  availableConnections: DashboardCatalog['connections']
  prompt: string
  setPrompt: (prompt: string) => void
  designCount: number
  setDesignCount: (count: number) => void
  selectedDesigns: string[]
  setSelectedDesigns: (ids: string[]) => void
  selectedProducts: ProductType[]
  toggleProduct: (id: ProductType) => void
  selectedTemplates: DashboardCatalog['templates']
  availableTemplates: DashboardCatalog['templates']
  toggleTemplate: (id: string) => void
  destinations: string[]
  setDestinations: (destinations: string[]) => void
  products: number
  mockups: number
  onClose: () => void
  setStep: (step: WizardStep) => void
  uploadedFiles: Array<{ id: string; name: string; url: string; previewUrl?: string }>
  onFiles: (files: FileList | null) => void
  onNext: () => void
  onBack: () => void
  onLaunch: () => void
}

function WizardModal(props: WizardProps) {
  const { step, currentStepIndex, source, setSource, selectedProvider, setSelectedProvider, selectedModel, setSelectedModel, availableConnections, prompt, setPrompt, designCount, setDesignCount, selectedDesigns, setSelectedDesigns, uploadedFiles, onFiles, selectedProducts, toggleProduct, selectedTemplates, availableTemplates, toggleTemplate, destinations, setDestinations, products, mockups, onClose, onNext, onBack, onLaunch } = props
  const canContinue = step === 'review' ? (source === 'ai' ? designCount > 0 : selectedDesigns.length > 0) : step === 'products' ? selectedProducts.length > 0 && selectedTemplates.length > 0 : step === 'destinations' ? destinations.length > 0 : true
  const isSummary = step === 'summary'
  return <div className="modal-backdrop"><div className="wizard-shell"><aside className="wizard-sidebar"><button className="close-wizard" onClick={onClose}>× <span>Close</span></button><div className="wizard-brand"><div className="brand-mark"><span>✦</span></div><div><strong>New workflow</strong><small>Build your production line</small></div></div><div className="step-list">{wizardSteps.map((item, index) => <button key={item.id} className={`step-item ${step === item.id ? 'current' : ''} ${index < currentStepIndex ? 'done' : ''}`} onClick={() => index <= currentStepIndex && props.setStep(item.id)}><span className="step-number">{index < currentStepIndex ? '✓' : item.number}</span><span>{item.label}</span></button>)}</div><div className="wizard-aside-note"><span>✧</span><strong>Keep it flexible</strong><p>Every provider, template and destination can be swapped later.</p></div></aside><section className="wizard-main"><div className="wizard-topline"><span>New production workflow</span><span>Step {String(currentStepIndex + 1).padStart(2, '0')} of {wizardSteps.length}</span></div><div className="wizard-progress"><span style={{ width: `${((currentStepIndex + 1) / wizardSteps.length) * 100}%` }} /></div><div className="wizard-content">{step === 'start' && <StartStep />}{step === 'source' && <SourceStep source={source} setSource={setSource} selectedProvider={selectedProvider} setSelectedProvider={setSelectedProvider} selectedModel={selectedModel} setSelectedModel={setSelectedModel} availableConnections={availableConnections} prompt={prompt} setPrompt={setPrompt} designCount={designCount} setDesignCount={setDesignCount} onFiles={onFiles} />}{step === 'review' && <ReviewStep selectedDesigns={selectedDesigns} setSelectedDesigns={setSelectedDesigns} source={source} uploadedFiles={uploadedFiles} />}{step === 'products' && <ProductsStep selectedProducts={selectedProducts} toggleProduct={toggleProduct} availableTemplates={availableTemplates} selectedTemplates={selectedTemplates} toggleTemplate={toggleTemplate} products={products} mockups={mockups} />}{step === 'destinations' && <DestinationsStep destinations={destinations} setDestinations={setDestinations} />}{step === 'summary' && <SummaryStep source={source} selectedProvider={selectedProvider} selectedModel={selectedModel} prompt={prompt} designCount={source === 'ai' ? designCount : selectedDesigns.length} products={products} mockups={mockups} selectedProducts={selectedProducts} destinations={destinations} />}</div><div className="wizard-footer"><button className="back-button" onClick={currentStepIndex === 0 ? onClose : onBack}>{currentStepIndex === 0 ? 'Cancel' : '← Back'}</button>{isSummary ? <button className="primary-button launch-button" onClick={onLaunch}>Launch workflow <span>↗</span></button> : <button className="primary-button" disabled={!canContinue} onClick={onNext}>Continue <span>→</span></button>}</div></section></div></div>
}

function StartStep() { return <div className="wizard-intro"><span className="big-step-mark">01</span><span className="section-kicker">Start with intention</span><h2>What are we<br /><em>making today?</em></h2><p>Build a repeatable production line for your next collection. You can reuse this workflow as many times as you like.</p><div className="start-options"><div className="start-option selected"><div className="option-icon">✦</div><div><strong>Start from scratch</strong><small>Design your production line step by step.</small></div><span className="radio-dot" /></div><div className="start-option"><div className="option-icon muted">↺</div><div><strong>Use an existing workflow</strong><small>Start from one of your saved recipes.</small></div><span className="radio-dot empty" /></div></div></div> }

function SourceStep({ source, setSource, selectedProvider, setSelectedProvider, selectedModel, setSelectedModel, availableConnections, prompt, setPrompt, designCount, setDesignCount, onFiles }: Pick<WizardProps, 'source' | 'setSource' | 'selectedProvider' | 'setSelectedProvider' | 'selectedModel' | 'setSelectedModel' | 'availableConnections' | 'prompt' | 'setPrompt' | 'designCount' | 'setDesignCount' | 'onFiles'>) { return <div className="wizard-form-step"><span className="big-step-mark">02</span><span className="section-kicker">Design source</span><h2>Bring the idea to<br /><em>life.</em></h2><p>Start with a theme and let your configured provider create a consistent collection — or bring your own artwork.</p><div className="source-toggle"><button className={source === 'ai' ? 'selected' : ''} onClick={() => setSource('ai')}><span>✦</span> Generate with AI</button><button className={source === 'upload' ? 'selected' : ''} onClick={() => setSource('upload')}><span>↥</span> Upload existing</button></div>{source === 'ai' ? <div className="form-stack"><label>Collection theme<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label><div className="form-columns"><label>Number of designs<div className="number-control"><button onClick={() => setDesignCount(Math.max(1, designCount - 1))}>−</button><strong>{designCount}</strong><button onClick={() => setDesignCount(Math.min(100, designCount + 1))}>＋</button></div></label><label>Image provider<select value={selectedProvider} onChange={(event) => setSelectedProvider(event.target.value)}>{availableConnections.filter((connection) => connection.id !== 'storage' && connection.enabled && connection.configured).map((connection) => <option value={connection.id} key={connection.id}>{connection.name}</option>)}<option value="mock">Local mock</option></select>{availableConnections.find((connection) => connection.id === selectedProvider)?.models.length ? <select className="model-input" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>{availableConnections.find((connection) => connection.id === selectedProvider)?.models.map((modelOption) => <option value={modelOption} key={modelOption}>{modelOption}</option>)}</select> : <input className="model-input" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} placeholder="Default model" />}</label></div><div className="info-note"><span>✧</span><span>Using <strong>{selectedProvider === 'fal' ? 'Fal.ai · Flux Schnell' : selectedProvider === 'openrouter' ? 'OpenRouter image generation' : selectedProvider === 'huggingface' ? 'Hugging Face · Inference API' : selectedProvider === 'ollama' ? `Ollama · ${selectedModel || 'x/flux2-klein'}` : 'Local mock provider'}</strong>. The provider can be changed later without changing your workflow.</span></div></div> : <div className="upload-zone"><span>↥</span><strong>Drop your designs here</strong><small>PNG, JPG or WEBP · up to 100 files</small><button className="outline-button" onClick={() => document.getElementById('design-upload')?.click()}>Browse files</button><input id="design-upload" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => onFiles(event.target.files)} /></div>}</div> }

function ReviewStep({ selectedDesigns, setSelectedDesigns, source, uploadedFiles }: Pick<WizardProps, 'selectedDesigns' | 'setSelectedDesigns' | 'source' | 'uploadedFiles'>) { const reviewItems = uploadedFiles.map((file, index) => ({ id: file.id, title: file.name, subtitle: `${String(index + 1).padStart(2, '0')} / ${uploadedFiles.length}`, background: `url(${file.previewUrl ?? file.url}) center / cover`, accent: '#fff', icon: '' })); const allSelected = selectedDesigns.length === reviewItems.length; return <div className="wizard-form-step review-step"><div className="step-heading-row"><div><span className="big-step-mark">03</span><span className="section-kicker">Approval checkpoint</span><h2>Choose your<br /><em>strongest ideas.</em></h2><p>{source === 'ai' ? 'Your selected provider will generate the collection when this workflow runs.' : 'Review the designs you uploaded before creating any mockups.'}</p></div><div className="review-count"><strong>{selectedDesigns.length}</strong><small>selected</small></div></div><div className="review-toolbar"><span>Showing {reviewItems.length} designs</span><button onClick={() => setSelectedDesigns(allSelected ? [] : reviewItems.map((design) => design.id))}>{allSelected ? 'Deselect all' : 'Select all'}</button></div><div className="design-review-grid">{reviewItems.map((design) => { const selected = selectedDesigns.includes(design.id); return <button className={`review-design ${selected ? 'selected' : ''}`} key={design.id} onClick={() => setSelectedDesigns(selected ? selectedDesigns.filter((id) => id !== design.id) : [...selectedDesigns, design.id])}><div className="review-art" style={{ background: design.background, color: design.accent }}><span>{design.icon}</span><small>{design.title}</small></div><div className="review-meta"><span>{design.subtitle}</span><i>{selected ? '✓' : ''}</i></div></button> })}</div></div> }

function ProductsStep({ selectedProducts, toggleProduct, availableTemplates, selectedTemplates, toggleTemplate, products, mockups }: Pick<WizardProps, 'selectedProducts' | 'toggleProduct' | 'availableTemplates' | 'selectedTemplates' | 'toggleTemplate' | 'products' | 'mockups'>) { return <div className="wizard-form-step products-step"><span className="big-step-mark">04</span><span className="section-kicker">Fan out the collection</span><h2>Make products,<br /><em>not just images.</em></h2><p>One approved design can become many product variants. Choose the products, then assign intentional mockup templates.</p><div className="product-selector">{productOptions.map((product) => <button className={`product-choice ${selectedProducts.includes(product.id) ? 'selected' : ''}`} key={product.id} onClick={() => toggleProduct(product.id)}><span className="product-emoji" style={{ background: product.color }}>{product.emoji}</span><span><strong>{product.label}</strong><small>{product.description}</small></span><i>{selectedProducts.includes(product.id) ? '✓' : '+'}</i></button>)}</div><div className="selection-summary"><div><strong>{products}</strong><small>product variants</small></div><div className="summary-divider" /><div><strong>{mockups}</strong><small>mockup outputs</small></div><span>per {selectedProducts.length || 0} product types</span></div><div className="template-config"><div className="subheading-row"><div><strong>Mockup templates</strong><small>AI scenes are always template-driven.</small></div><button className="text-button">Manage library →</button></div><div className="template-config-list">{availableTemplates.filter((template) => selectedProducts.includes(template.productType)).map((template) => <button className={`template-config-row ${selectedTemplates.some((item) => item.id === template.id) ? 'selected' : ''}`} key={template.id} onClick={() => toggleTemplate(template.id)}><span className={`template-thumb ${template.kind === 'generative' ? 'ai' : 'deterministic'}`}>{template.kind === 'generative' ? '✦' : '▧'}</span><span><strong>{template.name}</strong><small>{template.productType.replace('-', ' ')} · {template.kind === 'generative' ? 'AI template' : 'Deterministic'}</small></span><b>{selectedTemplates.find((item) => item.id === template.id)?.quantity ?? 0}</b><i>{selectedTemplates.some((item) => item.id === template.id) ? '✓' : '+'}</i></button>)}</div></div></div> }

function DestinationsStep({ destinations, setDestinations }: Pick<WizardProps, 'destinations' | 'setDestinations'>) { const toggle = (id: string) => setDestinations(destinations.includes(id) ? destinations.filter((item) => item !== id) : [...destinations, id]); return <div className="wizard-form-step"><span className="big-step-mark">05</span><span className="section-kicker">Where it goes</span><h2>Choose your<br /><em>destinations.</em></h2><p>Publish when you're ready, or keep a structured export as your source of truth. You can select more than one.</p><div className="destination-list"><DestinationRow id="etsy" selected={destinations.includes('etsy')} onToggle={toggle} icon="e" title="Etsy" detail="Create drafts or publish listings" badge="Connected" tone="orange" /><DestinationRow id="tpublic" selected={destinations.includes('tpublic')} onToggle={toggle} icon="T" title="TeePublic" detail="Product destination adapter" badge="Coming soon" tone="dark" /><DestinationRow id="drive" selected={destinations.includes('drive')} onToggle={toggle} icon="△" title="Google Drive" detail="Sync a copy to your connected folder" badge="Connected" tone="blue" /><DestinationRow id="download" selected={destinations.includes('download')} onToggle={toggle} icon="↓" title="Structured download" detail="Always available as a ZIP export" badge="Included" tone="violet" /></div><div className="storage-note"><span>◉</span><span>Assets are permanently stored in your connected <strong>workspace storage</strong>. Self-hosted deployments can use the local filesystem.</span></div></div> }

function DestinationRow({ id, selected, onToggle, icon, title, detail, badge, tone }: { id: string; selected: boolean; onToggle: (id: string) => void; icon: string; title: string; detail: string; badge: string; tone: string }) { return <button className={`destination-row ${selected ? 'selected' : ''}`} onClick={() => onToggle(id)}><span className={`destination-icon ${tone}`}>{icon}</span><span><strong>{title}</strong><small>{detail}</small></span><em>{badge}</em><i>{selected ? '✓' : '+'}</i></button> }

function SummaryStep({ source, selectedProvider, selectedModel, prompt, designCount, products, mockups, selectedProducts, destinations }: { source: 'ai' | 'upload'; selectedProvider: string; selectedModel: string; prompt: string; designCount: number; products: number; mockups: number; selectedProducts: ProductType[]; destinations: string[] }) { return <div className="wizard-form-step summary-step"><span className="big-step-mark">06</span><span className="section-kicker">Ready when you are</span><h2>Your production line<br /><em>looks good.</em></h2><p>We’ll create the workflow, snapshot this configuration as version 01, and queue each unit of work independently.</p><div className="summary-flow"><div className="flow-block"><span>01</span><strong>{source === 'ai' ? 'Generate designs' : 'Import designs'}</strong><small>{source === 'ai' ? `${designCount} variations · ${selectedProvider === 'fal' ? 'Fal.ai' : selectedProvider === 'openrouter' ? 'OpenRouter' : selectedProvider === 'huggingface' ? 'Hugging Face' : selectedProvider === 'ollama' ? `Ollama (${selectedModel || 'x/flux2-klein'})` : 'Local mock'}` : `${designCount} selected assets`}</small></div><i>→</i><div className="flow-block"><span>02</span><strong>Fan out variants</strong><small>{selectedProducts.length} product types · {products} total</small></div><i>→</i><div className="flow-block"><span>03</span><strong>Render mockups</strong><small>{mockups} template outputs</small></div><i>→</i><div className="flow-block"><span>04</span><strong>Deliver</strong><small>{destinations.length} destinations</small></div></div><div className="summary-prompt"><span>Prompt</span><strong>{source === 'ai' ? `“${prompt}”` : 'Uploaded design collection'}</strong></div><div className="approval-row"><span className="pulse-dot" /><span>Design review checkpoint is enabled</span><span className="approval-policy">Review before mockups</span></div></div> }

type TemplateEditorState = { id?: string; name: string; prompt: string; provider: string; model: string; description: string }

function TemplateEditor({ template, onChange, onClose, onSave, onDelete }: { template: TemplateEditorState; onChange: (template: TemplateEditorState | null) => void; onClose: () => void; onSave: () => void; onDelete?: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="simple-modal"><div className="modal-heading"><div><span className="section-kicker">{template.id ? 'Edit template' : 'New template'}</span><h2>{template.id ? 'Refine your prompt.' : 'Save an AI prompt.'}</h2><p>Keep the prompt, provider and preferred model together for repeatable generations.</p></div><button className="close-modal" onClick={onClose}>×</button></div><div className="modal-form"><label>Template name<input value={template.name} onChange={(event) => onChange({ ...template, name: event.target.value })} placeholder="e.g. Editorial cat collection" /></label><label>Description<input value={template.description} onChange={(event) => onChange({ ...template, description: event.target.value })} placeholder="What this prompt is best for" /></label><label>AI prompt<textarea value={template.prompt} onChange={(event) => onChange({ ...template, prompt: event.target.value })} rows={6} placeholder="Describe the image collection..." /></label><div className="form-columns"><label>Provider<select value={template.provider} onChange={(event) => onChange({ ...template, provider: event.target.value, model: event.target.value === 'ollama' ? 'x/flux2-klein' : event.target.value === 'huggingface' ? 'black-forest-labs/FLUX.2-klein-9B' : template.model })}><option value="fal">Fal.ai</option><option value="openrouter">OpenRouter</option><option value="huggingface">Hugging Face</option><option value="ollama">Ollama</option><option value="mock">Local mock</option></select></label><label>Default model<input value={template.model} onChange={(event) => onChange({ ...template, model: event.target.value })} placeholder="Provider model ID" /></label></div></div><div className="modal-actions">{onDelete && <button className="text-button danger-button" onClick={onDelete}>Delete template</button>}<span /><button className="outline-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!template.name.trim() || !template.prompt.trim()} onClick={onSave}>Save template <span>↗</span></button></div></div></div>
}

function ConnectionModal({ connection, model, enabled, message, onModel, onEnabled, onClose, onSave, onTest }: { connection: DashboardCatalog['connections'][number]; model: string; enabled: boolean; message?: string; onModel: (value: string) => void; onEnabled: (value: boolean) => void; onClose: () => void; onSave: () => void; onTest: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="simple-modal connection-modal"><div className="modal-heading"><div><span className="section-kicker">Connection settings</span><h2>Manage {connection.name}.</h2><p>{connection.detail}. Credentials remain server-side in your environment.</p></div><button className="close-modal" onClick={onClose}>×</button></div><div className="connection-summary"><span className={`connection-mark ${connection.id === 'fal' ? 'dark' : 'violet'}`}>{connection.id === 'fal' ? 'f' : '✦'}</span><div><strong>{connection.name}</strong><small>{connection.configured ? 'Credentials detected in .env' : 'Credentials not detected'}</small></div><span className={`connection-status ${connection.configured ? 'connected' : 'not-connected'}`}><i /> {connection.configured ? 'Connected' : 'Not connected'}</span></div><div className="modal-form"><label>Default model{connection.models.length > 0 ? <select value={model} onChange={(event) => onModel(event.target.value)}>{connection.models.map((modelOption) => <option value={modelOption} key={modelOption}>{modelOption}</option>)}</select> : <input value={model} onChange={(event) => onModel(event.target.value)} placeholder="Provider model ID" />}</label><label className="toggle-label"><span><strong>Available for workflows</strong><small>Allow this provider to appear in the workflow wizard.</small></span><input type="checkbox" checked={enabled} onChange={(event) => onEnabled(event.target.checked)} /></label>{message && <div className="info-note"><span>✧</span><span>{message}</span></div>}</div><div className="modal-actions"><button className="outline-button" onClick={onTest}>Test connection</button><span /><button className="outline-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!model.trim()} onClick={onSave}>Save settings <span>↗</span></button></div></div></div>
}

export { App }
