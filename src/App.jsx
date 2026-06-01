import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react'
import { Routes, Route, Link, useNavigate, useParams, useLocation } from 'react-router-dom'
import { supabase, supabasePublic } from './supabaseClient'
import LandingPage from './components/LandingPage'
import {
  LayoutDashboard, FolderKanban, GanttChart as GanttIcon, LogIn, LogOut,
  Users, Plus, Pencil, Trash2, X, ChevronRight, AlertTriangle,
  CheckCircle2, Clock, Pause, Target, Shield, Eye, ArrowLeft, Save,
  RefreshCw, Search, Menu, AlertCircle, ExternalLink, BarChart3,
  ListChecks, FileWarning, Info, ChevronDown, ChevronUp,
  Upload, Download, FileSpreadsheet, Presentation, Sparkles,
  FileText, UserCog, User, Sun, Moon
} from 'lucide-react'

// Heavy deps lazy-loaded on first use. Pays the download cost once
// per session at click time instead of bloating the main bundle.
const loadXLSX = () => import('xlsx')
const loadPptx = () => import('pptxgenjs').then(m => m.default)
// Dashboard charts are rendered behind a Suspense boundary so the
// recharts vendor (~80 KB gzipped) only ships when the dashboard route
// actually mounts.
const DashboardCharts = React.lazy(() => import('./components/DashboardCharts'))
// Same pattern for ProjectDetail's four chart blocks. Three named exports
// share one chunk so opening a project detail only triggers one network
// fetch for the recharts vendor.
const ProjectDetailChartsLazy = React.lazy(() => import('./components/ProjectDetailCharts').then(m => ({
  default: function ProjectDetailChartsBundle({ kind, ...props }) {
    if (kind === 'dev') return <m.DevStatusPie {...props} />
    if (kind === 'uat') return <m.UatStatusPie {...props} />
    if (kind === 'risk') return <m.RiskBar {...props} />
    return null
  }
})))
const ChartFallback = ({ height = 220 }) => (
  <div className="w-full animate-pulse bg-surface-100 rounded-lg" style={{ height }} />
)

// ─── Toast (lightweight, top-right, auto-dismiss) ───────────
// Self-contained so main.jsx can call it from a global error handler
// before any provider is mounted. Stacks queued messages.
const _toastQueue = []
let _toastNode = null
function ensureToastRoot() {
  if (_toastNode) return _toastNode
  _toastNode = document.createElement('div')
  _toastNode.id = 'app-toast-root'
  _toastNode.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;'
  if (document.body) document.body.appendChild(_toastNode)
  else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(_toastNode))
  return _toastNode
}
export function showToast(message, type = 'info') {
  const root = ensureToastRoot()
  if (!root || !message) return
  const el = document.createElement('div')
  const bg = type === 'error' ? 'rgba(239,68,68,0.95)' : type === 'success' ? 'rgba(16,185,129,0.95)' : type === 'warning' ? 'rgba(245,158,11,0.95)' : 'rgba(30,30,36,0.95)'
  el.style.cssText = `pointer-events:auto;background:${bg};color:#fff;padding:10px 14px;border-radius:10px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;letter-spacing:.01em;box-shadow:0 8px 24px -10px rgba(0,0,0,.6);max-width:360px;line-height:1.4;backdrop-filter:blur(10px);`
  el.textContent = String(message)
  root.appendChild(el)
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300) }, 3000)
}

// ─── Error Boundary ─────────────────────────────────────────
// Catches render-time errors anywhere in the React tree. Replaces the
// previous behaviour of a white screen with no recovery option.
export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('[ErrorBoundary]', error, info) }
  render() {
    if (!this.state.error) return this.props.children
    const msg = (this.state.error && this.state.error.message) || 'Something went wrong'
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#000', color: '#fff', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ maxWidth: '480px', textAlign: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '16px', padding: '32px' }}>
          <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: '36px', lineHeight: 1, marginBottom: '12px' }}>Something broke.</div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.65)', marginBottom: '20px', lineHeight: 1.5, wordBreak: 'break-word' }}>{msg}</div>
          <button onClick={() => window.location.reload()} style={{ background: '#fff', color: '#000', border: 'none', padding: '10px 22px', borderRadius: '999px', fontWeight: 600, fontSize: '13px', cursor: 'pointer', letterSpacing: '.02em' }}>Reload page</button>
        </div>
      </div>
    )
  }
}

// ─── Auth Context ───────────────────────────────────────────
const AuthCtx = createContext(null)
const useAuth = () => useContext(AuthCtx)

// ─── Projects Cache Context ──────────────────────────────────
// Fetches projects ONCE at app level so navigating between pages
// never triggers a redundant Supabase call.
const ProjectsCtx = createContext(null)
const useProjects = () => useContext(ProjectsCtx)

function ProjectsProvider({ children }) {
  const { loading: authLoading, user } = useAuth()
  const [projects, setProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState(null)

  const refreshProjects = useCallback(async () => {
    setProjectsError(null)
    try {
      const { data, error } = await supabasePublic.from('projects').select('*').order('project_number')
      if (error) throw error
      setProjects(data || [])
    } catch (e) {
      console.error('Failed to load projects:', e)
      setProjectsError(e.message || 'Failed to load projects')
    } finally {
      setProjectsLoading(false)
    }
  }, [])

  // Fetch once auth settles. Never resets projectsLoading to true on refetch —
  // we already have old data to show, no need to flash a spinner.
  useEffect(() => {
    if (authLoading) return
    // Hard safety: loading state can never stay stuck past 6s
    const safety = setTimeout(() => setProjectsLoading(false), 6000)
    refreshProjects().finally(() => clearTimeout(safety))
    return () => clearTimeout(safety)
  }, [authLoading, user?.id, refreshProjects])

  return (
    <ProjectsCtx.Provider value={{ projects, projectsLoading, projectsError, refreshProjects }}>
      {children}
    </ProjectsCtx.Provider>
  )
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [profileError, setProfileError] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = async (userId) => {
    if (!userId) { setProfile(null); setProfileError(null); return null }
    // Use supabasePublic to avoid the auth-client lock. Calling supabase.from()
    // inside an onAuthStateChange callback deadlocks because the parent auth
    // operation is still holding the internal GoTrue lock.
    const { data, error } = await supabasePublic.from('profiles').select('role, full_name').eq('id', userId).maybeSingle()
    if (error) {
      setProfileError(error.message || 'Failed to load profile')
      console.error('fetchProfile error:', error)
      return null
    }
    setProfile(data); setProfileError(null)
    return data
  }

  useEffect(() => {
    // Safety fallback — never stay stuck on loading screen
    const timeout = setTimeout(() => setLoading(false), 5000)

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      clearTimeout(timeout)
      setLoading(false)
      // Fire-and-forget profile fetch — keep getSession's then-callback from
      // awaiting another Supabase call while auth internals may still be busy.
      fetchProfile(session?.user?.id ?? null).catch(e => console.error('Auth init profile fetch error:', e))
    }).catch(() => {
      clearTimeout(timeout)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      // Keep this callback synchronous — Supabase holds the GoTrue lock while
      // firing auth state change listeners, and awaiting any Supabase call
      // here would deadlock. Fire-and-forget the profile fetch instead.
      setUser(session?.user ?? null)
      fetchProfile(session?.user?.id ?? null).catch(e => console.error('Auth state change profile fetch error:', e))
    })
    return () => { subscription.unsubscribe(); clearTimeout(timeout) }
  }, [])

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }
  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        // The user clicked logout — give them logout. But surface the
        // server-side failure so they know the session may still be
        // active elsewhere.
        showToast('Sign-out incomplete on server: ' + error.message, 'warning')
      }
    } catch (e) {
      showToast('Sign-out network error — local session cleared', 'warning')
    }
    setUser(null)
    setProfile(null)
    setProfileError(null)
  }
  return <AuthCtx.Provider value={{ user, loading, signIn, signOut, isAdmin: profile?.role === 'admin', profile, profileError }}>{children}</AuthCtx.Provider>
}

// ─── Constants ──────────────────────────────────────────────
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low']
const STATUSES = ['On Track', 'At Risk', 'Delayed', 'Completed', 'On Hold']
const PHASES = ['Initiation', 'Planning', 'Execution', 'UAT', 'Go-Live', 'Closed']
const IMPACTS = ['High', 'Medium', 'Low']
const DEV_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Blocked']
const UAT_STATUSES = ['Not Started', 'Pending', 'In Progress', 'Passed', 'Failed']

const STATUS_COLORS = {
  'On Track': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500', hex: '#10b981' },
  'At Risk': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500', hex: '#f59e0b' },
  'Delayed': { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500', hex: '#ef4444' },
  'Completed': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500', hex: '#3b82f6' },
  'On Hold': { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400', hex: '#94a3b8' },
}
const PRIORITY_COLORS = {
  Critical: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  High: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  Medium: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' },
  Low: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' },
}
const DEV_STATUS_COLORS = {
  'Not Started': { bg: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-200', hex: '#94a3b8' },
  'In Progress': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', hex: '#f59e0b' },
  'Completed': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', hex: '#10b981' },
  'Blocked': { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', hex: '#ef4444' },
}
const UAT_STATUS_COLORS = {
  'Not Started': { bg: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-200', hex: '#94a3b8' },
  'Pending': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', hex: '#f59e0b' },
  'In Progress': { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', hex: '#38bdf8' },
  'Passed': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', hex: '#10b981' },
  'Failed': { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', hex: '#ef4444' },
}
const PIE_COLORS = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#94a3b8']
const PRI_PIE_COLORS = ['#ef4444', '#f97316', '#38bdf8', '#94a3b8']

// ─── Utility Components ─────────────────────────────────────
// Top-of-page brand mark. Renders both variants and lets a CSS rule
// (.app-dark .page-logo-light / .page-logo-dark) swap them — keeps the
// component theme-agnostic so we don't need to thread `theme` through
// every page that wants the logo.
function PageLogo() {
  return (
    <div className="mb-3">
      <img src="./ebs-logo.png" alt="EBS" className="page-logo-light h-20 w-auto object-contain" />
      <img src="./ebs-logo-white.png" alt="EBS" className="page-logo-dark h-20 w-auto object-contain" />
    </div>
  )
}

// Multi-select dropdown with checkboxes. Used by ProjectTracker for the
// Status + Priority filters so admins can layer multiple values
// simultaneously. Closes on outside click; ESC clears the popover but
// keeps the selection (clear via the "Clear all" link inside).
function MultiSelectDropdown({ options, selected, onChange, allLabel = 'All' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const toggle = (opt) => {
    if (selected.includes(opt)) onChange(selected.filter(s => s !== opt))
    else onChange([...selected, opt])
  }
  const label = selected.length === 0
    ? allLabel
    : selected.length === 1
      ? selected[0]
      : `${selected.length} selected`
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-800 hover:border-surface-300 focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400 transition-colors w-auto min-w-[160px] flex items-center justify-between gap-2 text-left">
        <span className="truncate">{label}</span>
        <ChevronDown size={14} className={`shrink-0 text-surface-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="multi-select-popover">
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              className="multi-select-clear">
              Clear all
            </button>
          )}
          {options.map(opt => {
            const checked = selected.includes(opt)
            return (
              <label key={opt} className="multi-select-item">
                <input type="checkbox" checked={checked} onChange={() => toggle(opt)} />
                <span>{opt}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400 transition-colors'
const selectCls = inputCls
const textareaCls = inputCls + ' resize-none'

function Badge({ children, colors }) {
  return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${colors.bg} ${colors.text} ${colors.border}`}>
    {colors.dot && <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />}{children}
  </span>
}
function StatusBadge({ status }) { return <Badge colors={STATUS_COLORS[status] || STATUS_COLORS['On Track']}>{status}</Badge> }
function PriorityBadge({ priority }) { return <Badge colors={PRIORITY_COLORS[priority] || PRIORITY_COLORS['Medium']}>{priority}</Badge> }
function DevStatusBadge({ status }) {
  if (!status) return <span className="text-xs text-surface-400">—</span>
  return <Badge colors={DEV_STATUS_COLORS[status] || DEV_STATUS_COLORS['Not Started']}>{status}</Badge>
}
function UatStatusBadge({ status }) {
  if (!status) return <span className="text-xs text-surface-400">—</span>
  return <Badge colors={UAT_STATUS_COLORS[status] || UAT_STATUS_COLORS['Not Started']}>{status}</Badge>
}

function ProgressBar({ value, className = '', height = 'h-2' }) {
  const num = value === 'Ongoing' ? 50 : parseInt(value) || 0
  const color = num >= 100 ? 'bg-blue-500' : num >= 75 ? 'bg-emerald-500' : num >= 40 ? 'bg-amber-500' : 'bg-brand-500'
  return <div className={`flex items-center gap-2 ${className}`}>
    <div className={`flex-1 ${height} bg-surface-200 rounded-full overflow-hidden`}>
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(num, 100)}%` }} />
    </div>
    <span className="text-xs font-medium text-surface-500 w-12 text-right">{value === 'Ongoing' ? 'Ongoing' : `${num}%`}</span>
  </div>
}

function Modal({ open, onClose, title, children, wide }) {
  // Close on ESC. Backdrop click is intentionally NOT a close path —
  // a text-selection drag that starts inside an input and ends outside
  // the panel would otherwise close the modal and discard the user's
  // in-progress edits. X button + ESC are the only close paths.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return <div className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] modal-backdrop">
    <div className={`bg-white rounded-2xl shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-2xl'} w-full mx-4 max-h-[85vh] flex flex-col animate-fade-in`}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200">
        <h2 className="text-lg font-semibold font-display text-surface-800">{title}</h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-100 text-surface-400 hover:text-surface-600 transition-colors"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
    </div>
  </div>
}

function ConfirmDialog({ open, onClose, onConfirm, title, message }) {
  // Same close-path rules as Modal — Cancel button or ESC, never backdrop.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return <div className="fixed inset-0 z-[60] flex items-center justify-center modal-backdrop">
    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-red-50 rounded-xl"><AlertTriangle className="text-red-500" size={20} /></div>
        <h3 className="text-lg font-semibold text-surface-800">{title}</h3>
      </div>
      <p className="text-surface-600 mb-6">{message}</p>
      <div className="flex gap-3 justify-end">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-50 font-medium text-sm">Cancel</button>
        <button onClick={onConfirm} className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium text-sm">Delete</button>
      </div>
    </div>
  </div>
}

function FormField({ label, children, className = '' }) {
  return <div className={className}><label className="block text-sm font-medium text-surface-600 mb-1.5">{label}</label>{children}</div>
}

function EmptyState({ icon: Icon, title, description, action }) {
  return <div className="flex flex-col items-center justify-center py-16 text-center">
    <div className="p-4 bg-surface-100 rounded-2xl mb-4"><Icon className="text-surface-400" size={32} /></div>
    <h3 className="text-lg font-semibold text-surface-700 mb-1">{title}</h3>
    <p className="text-sm text-surface-500 mb-4 max-w-sm">{description}</p>
    {action}
  </div>
}

function Spinner() { return <div className="flex items-center justify-center py-20"><RefreshCw className="animate-spin text-brand-500" size={28} /></div> }

// ─── Bulk Upload Template Download ──────────────────────────
async function downloadTemplate() {
  const XLSX = await loadXLSX()
  const headers = ['Project Name','Objective/Goal','Dept / Module','Business Owner','Priority','Status','Phase','Est Start (YYYY-MM)','Est End (YYYY-MM)','Start Date (YYYY-MM)','End Date (YYYY-MM)','% Complete','Total Cost (KWD)','Business Impact','Cost Remarks','Dependencies','Key Risks','Mitigation','Notes / Updates','Actions Needed']
  const sample = ['Sample Project','Objective here','EBS/IT','John Doe','High','On Track','Execution','2026-01','2026-01','2026-06','50','1000','High','Budget approved','None','Scope creep','Weekly reviews','On schedule','Complete phase 1']
  const ws = XLSX.utils.aoa_to_sheet([headers, sample])
  ws['!cols'] = headers.map(() => ({ wch: 22 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Projects')
  // Add dropdowns reference sheet
  const refData = [['Priority','Status','Phase','Business Impact'],['Critical','On Track','Initiation','High'],['High','At Risk','Planning','Medium'],['Medium','Delayed','Execution','Low'],['Low','Completed','UAT',''],['','On Hold','Go-Live',''],['','','Closed','']]
  const ws2 = XLSX.utils.aoa_to_sheet(refData)
  XLSX.utils.book_append_sheet(wb, ws2, 'Dropdowns Reference')
  XLSX.writeFile(wb, 'EBS_Project_Upload_Template.xlsx')
}

async function parseBulkUpload(file) {
  const XLSX = await loadXLSX()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
        const fieldMap = {
          'Project Name': 'project_name', 'Objective/Goal': 'objective', 'Dept / Module': 'dept_module',
          'Business Owner': 'business_owner', 'Priority': 'priority', 'Status': 'status', 'Phase': 'phase',
          'Est Start (YYYY-MM)': 'est_start', 'Est End (YYYY-MM)': 'est_end', 'Start Date (YYYY-MM)': 'start_date', 'End Date (YYYY-MM)': 'end_date',
          '% Complete': 'percent_complete', 'Total Cost (KWD)': 'total_cost_kwd', 'Business Impact': 'business_impact',
          'Cost Remarks': 'cost_remarks', 'Dependencies': 'dependencies', 'Key Risks': 'key_risks',
          'Mitigation': 'mitigation', 'Notes / Updates': 'notes_updates', 'Actions Needed': 'actions_needed'
        }
        const projects = rows.map(row => {
          const p = {}
          Object.entries(fieldMap).forEach(([excel, db]) => {
            const val = row[excel]
            if (val !== undefined && val !== '') {
              p[db] = db === 'total_cost_kwd' ? parseFloat(val) || 0 : String(val)
            }
          })
          return p
        }).filter(p => p.project_name)
        resolve(projects)
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// ─── Milestone Bulk Upload (per-project) ────────────────────
const MILESTONE_HEADERS = ['Key Deliverable','Estimated Start Date','Actual Start Date','Estimated End Date','Actual End Date','Status','Dependencies','Owner','Remarks']
const MILESTONE_FIELD_MAP = {
  'Key Deliverable':'deliverable',
  'Estimated Start Date':'est_start_date',
  'Actual Start Date':'actual_date',
  'Estimated End Date':'target_date',
  'Actual End Date':'actual_end_date',
  'Status':'development_status','Dependencies':'dependencies',
  'Owner':'owner','Remarks':'remarks',
}
async function downloadMilestoneTemplate() {
  const XLSX = await loadXLSX()
  const sample = ['Sample Deliverable','2026-05-01','','2026-06-30','','In Progress','None','John Doe','On track']
  const ws = XLSX.utils.aoa_to_sheet([MILESTONE_HEADERS, sample])
  ws['!cols'] = MILESTONE_HEADERS.map(() => ({ wch: 22 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Milestones')
  const ref = [['Status'],['Not Started'],['In Progress'],['Completed'],['Blocked']]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ref), 'Dropdowns')
  XLSX.writeFile(wb, 'EBS_Milestones_Template.xlsx')
}
async function parseMilestoneBulk(file) {
  const XLSX = await loadXLSX()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
        const out = rows.map(row => {
          const m = {}
          Object.entries(MILESTONE_FIELD_MAP).forEach(([excel, db]) => {
            const val = row[excel]
            if (val !== undefined && val !== '') m[db] = String(val)
          })
          return m
        }).filter(m => m.deliverable)
        resolve(out)
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// ─── Risk Bulk Upload (per-project) ─────────────────────────
const RISK_HEADERS = ['Risk / Issue Description','Impact','Likelihood','Mitigation Action','Owner']
const RISK_FIELD_MAP = {
  'Risk / Issue Description':'description','Impact':'impact','Likelihood':'likelihood',
  'Mitigation Action':'mitigation_action','Owner':'owner',
}
async function downloadRiskTemplate() {
  const XLSX = await loadXLSX()
  const sample = ['Sample risk description','High','Medium','Weekly review','Jane Smith']
  const ws = XLSX.utils.aoa_to_sheet([RISK_HEADERS, sample])
  ws['!cols'] = RISK_HEADERS.map(() => ({ wch: 22 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Risks')
  const ref = [['Impact','Likelihood'],['High','High'],['Medium','Medium'],['Low','Low']]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ref), 'Dropdowns')
  XLSX.writeFile(wb, 'EBS_Risks_Template.xlsx')
}
async function parseRiskBulk(file) {
  const XLSX = await loadXLSX()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
        const out = rows.map(row => {
          const r = {}
          Object.entries(RISK_FIELD_MAP).forEach(([excel, db]) => {
            const val = row[excel]
            if (val !== undefined && val !== '') r[db] = String(val)
          })
          return r
        }).filter(r => r.description)
        resolve(out)
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// ─── Export all projects/milestones/risks/gantt-data to Excel ───
async function exportAllToExcel(projects) {
  const XLSX = await loadXLSX()
  // Fetch milestones + risks via supabasePublic
  const [{ data: ms }, { data: rs }] = await Promise.all([
    supabasePublic.from('milestones').select('*').order('project_id').order('milestone_number'),
    supabasePublic.from('risks').select('*').order('project_id').order('risk_number'),
  ])
  const milestones = ms || []
  const risks = rs || []
  const pNameById = Object.fromEntries(projects.map(p => [p.id, p.project_name]))

  // Sheet 1: Projects
  const projectsSheet = projects.map(p => ({
    '#': p.project_number,
    'Project Name': p.project_name,
    'Objective': p.objective || '',
    'Dept / Module': p.dept_module || '',
    'Business Owner': p.business_owner || '',
    'Priority': p.priority || '',
    'Status': p.status || '',
    'Phase': p.phase || '',
    'Est Start': p.est_start || '',
    'Est End': p.est_end || '',
    'Start Date': p.start_date || '',
    'End Date': p.end_date || '',
    '% Complete': p.percent_complete || '',
    'Total Cost (KWD)': p.total_cost_kwd || 0,
    'Business Impact': p.business_impact || '',
    'Cost Remarks': p.cost_remarks || '',
    'Dependencies': p.dependencies || '',
    'Key Risks': p.key_risks || '',
    'Mitigation': p.mitigation || '',
    'Notes / Updates': p.notes_updates || '',
    'Actions Needed': p.actions_needed || '',
  }))

  const milestonesSheet = milestones.map(m => ({
    'Project': pNameById[m.project_id] || `(id ${m.project_id})`,
    '#': m.milestone_number,
    'Key Deliverable': m.deliverable || '',
    'Estimated Start Date': m.est_start_date || '',
    'Actual Start Date': m.actual_date || '',
    'Estimated End Date': m.target_date || '',
    'Actual End Date': m.actual_end_date || '',
    'Status': m.development_status || '',
    'Owner': m.owner || '',
    'Dependencies': m.dependencies || '',
    'Remarks': m.remarks || '',
  }))

  const risksSheet = risks.map(r => ({
    'Project': pNameById[r.project_id] || `(id ${r.project_id})`,
    '#': r.risk_number,
    'Risk / Issue Description': r.description || '',
    'Impact': r.impact || '',
    'Likelihood': r.likelihood || '',
    'Mitigation Action': r.mitigation_action || '',
    'Owner': r.owner || '',
  }))

  const ganttSheet = projects.map(p => ({
    '#': p.project_number,
    'Project Name': p.project_name,
    'Status': p.status || '',
    'Start Date': p.start_date || '',
    'End Date': p.end_date || '',
    '% Complete': p.percent_complete || '',
    'Business Owner': p.business_owner || '',
  }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(projectsSheet), 'Projects')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(milestonesSheet), 'Milestones')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(risksSheet), 'Risks')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ganttSheet), 'Gantt-data')
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  XLSX.writeFile(wb, `EBS_Projects_Export_${today}.xlsx`)
}

// ─── PPTX Report Generation ────────────────────────────────
async function generateReport(projects) {
  const PptxGenJS = await loadPptx()
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'CUSTOM', width: 13.33, height: 7.5 })
  pptx.layout = 'CUSTOM'

  const BG_DARK = '0F1320'
  const BG_LIGHT = 'F8F9FC'
  const BRAND = '4263EB'
  const WHITE = 'FFFFFF'
  const GRAY = '6B7A99'
  const GREEN = '10B981'
  const RED = 'EF4444'
  const AMBER = 'F59E0B'
  const BLUE = '3B82F6'
  const SLATE = '94A3B8'

  const now = new Date()
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const currentMonth = monthNames[now.getMonth()]
  const currentYear = now.getFullYear()
  const quarter = Math.ceil((now.getMonth() + 1) / 3)
  const fy = now.getMonth() >= 3 ? currentYear : currentYear - 1

  // ─── Slide 1: Title ───
  const s1 = pptx.addSlide()
  s1.background = { color: BG_DARK }
  s1.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 1.8, w: 6.5, h: 3.5, rectRadius: 0.3, fill: { color: '1A202C' } })
  s1.addText(`Q${quarter} FY${String(fy).slice(2)}`, { x: 1.0, y: 2.2, w: 5.5, h: 0.6, fontSize: 18, color: GRAY, fontFace: 'Calibri' })
  s1.addText('Monthly Business Performance Review', { x: 1.0, y: 2.8, w: 5.5, h: 1.0, fontSize: 28, color: WHITE, bold: true, fontFace: 'Calibri' })
  s1.addText(`${currentMonth} ${currentYear}`, { x: 1.0, y: 4.4, w: 5.5, h: 0.5, fontSize: 14, color: GRAY, fontFace: 'Calibri' })

  // ─── Slide 2: Section ───
  const s2 = pptx.addSlide()
  s2.background = { color: WHITE }
  s2.addText('EBS Updates', { x: 2, y: 2.8, w: 9, h: 1.2, fontSize: 40, bold: true, color: '1A202C', fontFace: 'Calibri', align: 'center' })
  s2.addText(String(projects.length), { x: 12.0, y: 6.5, w: 1, h: 0.6, fontSize: 14, color: GRAY, fontFace: 'Calibri', align: 'right' })

  // ─── Slide 3: Data Slide ───
  const s3 = pptx.addSlide()
  s3.background = { color: BG_LIGHT }

  // Header
  s3.addText('EBS Updates', { x: 0.4, y: 0.2, w: 4, h: 0.5, fontSize: 20, bold: true, color: '1A202C', fontFace: 'Calibri' })
  s3.addText(`EBS Project Portfolio  |  ${currentMonth} ${currentYear}  |  Monthly Business Review`, { x: 0.4, y: 0.65, w: 8, h: 0.35, fontSize: 9, color: GRAY, fontFace: 'Calibri' })

  // Stats
  const onTrack = projects.filter(p => p.status === 'On Track').length
  const delayed = projects.filter(p => p.status === 'Delayed').length
  const onHold = projects.filter(p => p.status === 'On Hold').length
  const completed = projects.filter(p => p.status === 'Completed').length
  const total = projects.length

  // Portfolio Status box
  s3.addText('Portfolio Status', { x: 0.4, y: 1.15, w: 2.8, h: 0.35, fontSize: 11, bold: true, color: '1A202C', fontFace: 'Calibri' })

  const statItems = [
    { label: 'On Track', value: onTrack, color: GREEN },
    { label: 'Delayed', value: delayed, color: RED },
    { label: 'On Hold', value: onHold, color: SLATE },
    { label: 'Completed', value: completed, color: BLUE },
  ]
  statItems.forEach((item, i) => {
    const y = 1.6 + i * 0.42
    s3.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: y, w: 0.2, h: 0.25, rectRadius: 0.04, fill: { color: item.color } })
    s3.addText(item.label, { x: 0.85, y: y, w: 1.5, h: 0.25, fontSize: 10, color: '1A202C', fontFace: 'Calibri' })
    s3.addText(String(item.value), { x: 2.5, y: y, w: 0.6, h: 0.25, fontSize: 12, bold: true, color: '1A202C', fontFace: 'Calibri', align: 'right' })
  })

  // Total circle
  s3.addShape(pptx.shapes.OVAL, { x: 0.7, y: 3.5, w: 1.8, h: 1.4, fill: { color: BRAND } })
  s3.addText(`${total} Projects`, { x: 0.7, y: 3.7, w: 1.8, h: 0.7, fontSize: 18, bold: true, color: WHITE, fontFace: 'Calibri', align: 'center' })
  s3.addText(`Total Active Portfolio  |  ${currentMonth.slice(0,3)} ${currentYear}`, { x: 0.3, y: 4.35, w: 2.6, h: 0.4, fontSize: 7, color: GRAY, fontFace: 'Calibri', align: 'center' })

  // ─── Content columns ───
  const colX = [0.4, 3.6, 6.8, 10.0]
  const colW = [3.0, 3.0, 3.0, 3.0]
  const secY = 5.2

  // New this month (projects started in current month)
  const newThisMonth = projects.filter(p => {
    if (!p.start_date) return false
    const sd = p.start_date
    const m = now.getMonth() + 1
    const y = now.getFullYear()
    return sd === `${y}-${String(m).padStart(2, '0')}`
  })
  s3.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x: colX[0], y: secY, w: colW[0], h: 2.0, rectRadius: 0.15, fill: { color: WHITE }, shadow: { type: 'outer', blur: 4, opacity: 0.1, offset: 2 } })
  s3.addText('New This Month', { x: colX[0] + 0.15, y: secY + 0.1, w: colW[0] - 0.3, h: 0.35, fontSize: 10, bold: true, color: '1A202C', fontFace: 'Calibri' })
  const newText = newThisMonth.length > 0 ? newThisMonth.map(p => `• ${p.project_name}`).join('\n') : '• No new projects this month'
  s3.addText(newText, { x: colX[0] + 0.15, y: secY + 0.45, w: colW[0] - 0.3, h: 1.4, fontSize: 7.5, color: GRAY, fontFace: 'Calibri', valign: 'top', lineSpacingMultiple: 1.3 })

  // Highlights (completed + high progress)
  const highlights = projects.filter(p => p.status === 'Completed' || (parseInt(p.percent_complete) >= 80 && p.status !== 'On Hold'))
  s3.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x: colX[1], y: 1.15, w: colW[1], h: 3.85, rectRadius: 0.15, fill: { color: WHITE }, shadow: { type: 'outer', blur: 4, opacity: 0.1, offset: 2 } })
  s3.addText(`${currentMonth} Highlights`, { x: colX[1] + 0.15, y: 1.25, w: colW[1] - 0.3, h: 0.35, fontSize: 10, bold: true, color: '1A202C', fontFace: 'Calibri' })
  const hlText = highlights.slice(0, 8).map(p => `• ${p.project_name} — ${p.percent_complete === '100' ? 'Completed' : p.percent_complete + '% complete'}`).join('\n')
  s3.addText(hlText || '• No highlights', { x: colX[1] + 0.15, y: 1.65, w: colW[1] - 0.3, h: 3.2, fontSize: 7.5, color: GRAY, fontFace: 'Calibri', valign: 'top', lineSpacingMultiple: 1.3 })

  // Risks & Issues
  const riskyProjects = projects.filter(p => p.status === 'Delayed' || p.status === 'At Risk' || p.status === 'On Hold')
  s3.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x: colX[2], y: 1.15, w: colW[2], h: 3.85, rectRadius: 0.15, fill: { color: WHITE }, shadow: { type: 'outer', blur: 4, opacity: 0.1, offset: 2 } })
  s3.addText('Risks & Issues', { x: colX[2] + 0.15, y: 1.25, w: colW[2] - 0.3, h: 0.35, fontSize: 10, bold: true, color: '1A202C', fontFace: 'Calibri' })
  const riskText = riskyProjects.slice(0, 6).map(p => {
    const reason = p.key_risks ? ` — ${p.key_risks.substring(0, 80)}` : ''
    return `• ${p.project_name}${reason}`
  }).join('\n')
  s3.addText(riskText || '• No active risks', { x: colX[2] + 0.15, y: 1.65, w: colW[2] - 0.3, h: 3.2, fontSize: 7.5, color: GRAY, fontFace: 'Calibri', valign: 'top', lineSpacingMultiple: 1.3 })

  // Focus this month (active execution/UAT projects)
  const focusProjects = projects.filter(p => (p.phase === 'Execution' || p.phase === 'UAT') && p.status === 'On Track')
  s3.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x: colX[1], y: secY, w: colW[1], h: 2.0, rectRadius: 0.15, fill: { color: WHITE }, shadow: { type: 'outer', blur: 4, opacity: 0.1, offset: 2 } })
  s3.addText(`${currentMonth} ${currentYear} Focus`, { x: colX[1] + 0.15, y: secY + 0.1, w: colW[1] - 0.3, h: 0.35, fontSize: 10, bold: true, color: '1A202C', fontFace: 'Calibri' })
  const focusText = focusProjects.slice(0, 6).map(p => `• ${p.project_name} — ${p.percent_complete || '0'}%`).join('\n')
  s3.addText(focusText || '• No items in focus', { x: colX[1] + 0.15, y: secY + 0.45, w: colW[1] - 0.3, h: 1.4, fontSize: 7.5, color: GRAY, fontFace: 'Calibri', valign: 'top', lineSpacingMultiple: 1.3 })

  // Decisions Required
  const decisionsNeeded = projects.filter(p => p.actions_needed && p.actions_needed.length > 10)
  s3.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x: colX[2], y: secY, w: colW[2] + 0.3, h: 2.0, rectRadius: 0.15, fill: { color: WHITE }, shadow: { type: 'outer', blur: 4, opacity: 0.1, offset: 2 } })
  s3.addText('Decisions Required', { x: colX[2] + 0.15, y: secY + 0.1, w: colW[2], h: 0.35, fontSize: 10, bold: true, color: '1A202C', fontFace: 'Calibri' })
  const decText = decisionsNeeded.slice(0, 5).map(p => `• ${p.project_name} — ${p.actions_needed.substring(0, 80)}`).join('\n')
  s3.addText(decText || '• No pending decisions', { x: colX[2] + 0.15, y: secY + 0.45, w: colW[2], h: 1.4, fontSize: 7.5, color: GRAY, fontFace: 'Calibri', valign: 'top', lineSpacingMultiple: 1.3 })

  // Slide number
  s3.addText('3', { x: 12.5, y: 6.9, w: 0.5, h: 0.4, fontSize: 10, color: GRAY, fontFace: 'Calibri', align: 'right' })

  pptx.writeFile({ fileName: `EBS_MBR_${currentMonth}_${currentYear}.pptx` })
}

// ─── Drill-Down List Modal ──────────────────────────────────
function DrillDownModal({ open, onClose, title, projects, onProjectClick }) {
  if (!open) return null
  return <Modal open={open} onClose={onClose} title={title} wide>
    <div className="space-y-2">
      {projects.map(p => (
        <div key={p.id} onClick={() => { onClose(); onProjectClick(p.id) }}
          className="flex items-center justify-between p-4 rounded-xl border border-surface-100 hover:border-brand-200 hover:bg-brand-50/30 cursor-pointer transition-all group">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-surface-400">#{p.project_number}</span>
              <PriorityBadge priority={p.priority} />
              <StatusBadge status={p.status} />
            </div>
            <p className="text-sm font-semibold text-surface-800 truncate">{p.project_name}</p>
            <p className="text-xs text-surface-500 mt-0.5">{p.business_owner} · {p.dept_module}</p>
          </div>
          <div className="flex items-center gap-3 ml-4">
            <ProgressBar value={p.percent_complete || '0'} className="w-28" />
            <ChevronRight size={16} className="text-surface-300 group-hover:text-brand-500 transition-colors" />
          </div>
        </div>
      ))}
      {projects.length === 0 && <p className="text-sm text-surface-400 text-center py-8">No projects match this filter</p>}
    </div>
  </Modal>
}

// ─── Layout ─────────────────────────────────────────────────
function Layout() {
  const { user, signOut, isAdmin } = useAuth()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('ebs.theme') === 'light' ? 'light' : 'dark' }
    catch { return 'dark' }
  })
  const isLanding = location.pathname === '/'
  // Non-landing routes get one of two theme layers applied to <main> so the
  // dashboard / projects / etc. carry the luxe colour story chosen on the
  // landing. .app-dark is the original warm-black layer; .app-light is its
  // cream + champagne mirror. Landing handles its own styling.
  const themeClass = isLanding
    ? ''
    : theme === 'dark' ? 'app-dark' : 'app-light'
  // Lightweight marker on the root so the sidebar + floating buttons —
  // which are siblings of <main>, not descendants — can be themed via
  // .theme-light/.theme-dark selectors. This carries NO layout rules of
  // its own (unlike .app-dark/.app-light which apply backgrounds + a
  // `> *` z-index helper that would break sibling fixed positioning).
  const themeMarker = `theme-${theme}`

  // Persist theme choice
  useEffect(() => {
    try { localStorage.setItem('ebs.theme', theme) } catch {}
  }, [theme])

  // Scroll to top on every route change. The actual scroll container is
  // <main id="main-scroll"> (overflow-y-auto) — window scroll is a fallback.
  useEffect(() => {
    const el = document.getElementById('main-scroll')
    if (el) el.scrollTop = 0
    window.scrollTo(0, 0)
  }, [location.pathname])

  const nav = [
    { path: '/', label: 'Home', icon: Sparkles },
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/projects', label: 'Projects', icon: FolderKanban },
    { path: '/gantt', label: 'Gantt', icon: GanttIcon },
  ]
  const isActive = (path) => location.pathname === path || (path !== '/' && location.pathname.startsWith(path))

  return <div className={`flex h-screen overflow-hidden ${themeMarker}`}>
    {/* Backdrop — always present when sidebar is open (all screen sizes) */}
    {sidebarOpen && <div className="fixed inset-0 bg-black/40 z-30" onClick={() => setSidebarOpen(false)} />}

    {/* Floating toggle — always visible; Menu icon when closed, Close when open */}
    {!isLanding && (
      <button
        onClick={() => setSidebarOpen(o => !o)}
        aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
        className="fixed top-4 left-4 z-50 w-11 h-11 rounded-xl bg-surface-900 text-white shadow-lg hover:bg-surface-800 flex items-center justify-center transition-colors"
        style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
    )}

    {/* Floating quick-icons (admin / logout / login) — top-right on all pages except landing */}
    {!isLanding && (
      <div
        className="fixed top-4 right-4 z-50 flex items-center gap-1 bg-surface-900 rounded-xl px-1.5 py-1 shadow-lg"
        style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
      >
        {isAdmin ? (
          <>
            <button onClick={signOut} className="p-2 text-surface-300 hover:text-white transition-colors" title="Sign out"><LogOut size={18} /></button>
          </>
        ) : (
          <Link to="/login" className="p-2 text-surface-300 hover:text-white transition-colors" title="Admin login"><LogIn size={18} /></Link>
        )}
      </div>
    )}

    {/* Sidebar — always overlay, hidden by default on all screen sizes */}
    <aside className={`sidebar-luxe fixed z-40 h-full w-64 flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="luxe-logo-frame w-10 h-10 flex items-center justify-center shrink-0"><img src="./ebs-logo-white.png" alt="EBS" className="w-7 h-7 object-contain" /></div>
          <div className="min-w-0">
            <h1 className="luxe-title">EBS Projects</h1>
            <p className="luxe-subtitle">Tracker · Roadmap</p>
          </div>
        </div>
      </div>
      <div className="luxe-divider mx-5" />
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(({ path, label, icon: Icon }) => (
          <Link key={path} to={path} onClick={() => setSidebarOpen(false)}
            className={`luxe-link flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium ${isActive(path) ? 'is-active' : ''}`}>
            <Icon size={18} />{label}
          </Link>
        ))}
        {/* EBS Tracker separator + link */}
        <div className="pt-4 mt-2">
          <div className="luxe-divider mb-3 mx-1" />
          <p className="luxe-section-label px-4 pb-2">Tools</p>
          <a
            href="./ebs-tracker/index.html"
            className="luxe-link flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium"
            title={isAdmin ? 'Open EBS Tracker (you are already logged in)' : 'EBS Tracker — login required'}
          >
            <BarChart3 size={18} />
            <span>EBS Tracker</span>
            {isAdmin && <span className="luxe-admin-pill ml-auto">Admin</span>}
          </a>
        </div>
      </nav>
      <div className="px-3 py-4">
        <div className="luxe-divider mb-3 mx-1" />
        {/* Theme toggle */}
        <button
          onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          className="luxe-link flex items-center justify-between gap-3 px-4 py-2.5 mb-1 rounded-xl text-sm font-medium w-full"
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          <span className="flex items-center gap-3">
            {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
            {theme === 'dark' ? 'Dark mode' : 'Light mode'}
          </span>
          <span className="luxe-toggle-track relative w-9 h-5 rounded-full">
            <span className={`luxe-toggle-knob absolute top-0.5 w-4 h-4 rounded-full transition-all ${theme === 'dark' ? 'left-0.5' : 'left-[18px]'}`} />
          </span>
        </button>
        {isAdmin ? (
          <div className="space-y-1">
            <Link to="/admin/team" onClick={() => setSidebarOpen(false)}
              className={`luxe-link flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium ${location.pathname === '/admin/team' ? 'is-active' : ''}`}>
              <UserCog size={18} /> Landing Team
            </Link>
            <button onClick={signOut} className="luxe-link flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium w-full">
              <LogOut size={18} /> Sign Out
            </button>
            <div className="px-4 py-2 mt-2">
              <div className="flex items-center gap-2">
                <div className="luxe-shield w-6 h-6 rounded-full flex items-center justify-center shrink-0"><Shield size={12} /></div>
                <span className="luxe-email truncate">{user.email}</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            <Link to="/login" onClick={() => setSidebarOpen(false)}
              className="luxe-link flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium">
              <LogIn size={18} /> Admin Login
            </Link>
            <div className="px-4 py-2 mt-2 flex items-center gap-2">
              <Eye size={14} className="luxe-email" /><span className="luxe-email">Viewing as Guest</span>
            </div>
          </>
        )}
      </div>
    </aside>

    {/* Main */}
    <main id="main-scroll" className={`flex-1 overflow-y-auto pb-20 lg:pb-0 ${themeClass}`}>

      <div className={isLanding ? '' : 'px-4 pt-20 pb-8 sm:px-6 lg:px-8'}>
        <Routes>
          <Route path="/" element={<LandingPage isAdmin={isAdmin} theme={theme} setTheme={setTheme} />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/projects" element={<ProjectTracker />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/gantt" element={<GanttChartPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/team" element={<AdminTeamPage />} />
        </Routes>
      </div>
    </main>

    {/* Mobile bottom nav */}
    <div className="bottom-nav lg:hidden">
      {nav.map(({ path, label, icon: Icon }) => (
        <Link key={path} to={path} className={isActive(path) ? 'active' : ''}>
          <Icon size={20} /><span>{label}</span>
        </Link>
      ))}
      {isAdmin ? (
        <Link to="/admin/team" className={isActive('/admin') ? 'active' : ''}>
          <Shield size={20} /><span>Admin</span>
        </Link>
      ) : (
        <Link to="/login" className={isActive('/login') ? 'active' : ''}>
          <LogIn size={20} /><span>Login</span>
        </Link>
      )}
    </div>
  </div>
}

// ─── DASHBOARD (with drill-down) ────────────────────────────
function Dashboard() {
  const { projects, projectsLoading, projectsError, refreshProjects } = useProjects()
  const [drillDown, setDrillDown] = useState(null) // { title, projects }
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const navigate = useNavigate()

  if (projectsLoading) return <Spinner />
  if (projectsError) return <EmptyState icon={AlertCircle} title="Failed to load projects" description={projectsError} action={<button onClick={refreshProjects} className="text-brand-600 text-sm font-medium">Try again</button>} />

  const total = projects.length
  const byStatus = STATUSES.map(s => ({ name: s, value: projects.filter(p => p.status === s).length })).filter(d => d.value > 0)
  const byPriority = PRIORITIES.map(p => ({ name: p, value: projects.filter(pr => pr.priority === p).length })).filter(d => d.value > 0)
  const byPhase = PHASES.map(ph => ({ name: ph, value: projects.filter(p => p.phase === ph).length })).filter(d => d.value > 0)
  const onTrack = projects.filter(p => p.status === 'On Track').length
  const atRisk = projects.filter(p => p.status === 'At Risk' || p.status === 'Delayed').length
  const completed = projects.filter(p => p.status === 'Completed').length
  const onHold = projects.filter(p => p.status === 'On Hold').length

  const byOwner = {}
  projects.forEach(p => { const o = p.business_owner || 'Unassigned'; byOwner[o] = (byOwner[o] || 0) + 1 })
  const ownerData = Object.entries(byOwner).map(([name, value]) => ({ name: name.length > 25 ? name.substring(0, 25) + '…' : name, fullName: name, value })).sort((a, b) => b.value - a.value).slice(0, 10)

  // Drill-down handlers
  const drillStatus = (status) => {
    const filtered = projects.filter(p => p.status === status)
    setDrillDown({ title: `${status} Projects (${filtered.length})`, projects: filtered })
  }
  const drillPriority = (priority) => {
    const filtered = projects.filter(p => p.priority === priority)
    setDrillDown({ title: `${priority} Priority Projects (${filtered.length})`, projects: filtered })
  }
  const drillPhase = (phase) => {
    const filtered = projects.filter(p => p.phase === phase)
    setDrillDown({ title: `${phase} Phase Projects (${filtered.length})`, projects: filtered })
  }
  const drillOwner = (owner) => {
    const filtered = projects.filter(p => (p.business_owner || 'Unassigned') === owner)
    setDrillDown({ title: `Owner: ${owner} (${filtered.length})`, projects: filtered })
  }

  const summaryCards = [
    { kpi: 'total',     label: 'Total Projects',     value: total,     icon: FolderKanban,    color: 'bg-brand-600',    onClick: () => setDrillDown({ title: `All Projects (${total})`, projects }) },
    { kpi: 'onTrack',   label: 'On Track',           value: onTrack,   icon: CheckCircle2,    color: 'bg-emerald-500',  onClick: () => drillStatus('On Track') },
    { kpi: 'atRisk',    label: 'At Risk / Delayed',  value: atRisk,    icon: AlertTriangle,   color: 'bg-red-500',      onClick: () => { const f = projects.filter(p => p.status === 'At Risk' || p.status === 'Delayed'); setDrillDown({ title: `At Risk & Delayed (${f.length})`, projects: f }) } },
    { kpi: 'completed', label: 'Completed',          value: completed, icon: Target,          color: 'bg-blue-500',     onClick: () => drillStatus('Completed') },
    { kpi: 'onHold',    label: 'On Hold',            value: onHold,    icon: Pause,           color: 'bg-slate-400',    onClick: () => drillStatus('On Hold') },
  ]

  // Projects starting this month (project_start_date in YYYY-MM format).
  // Feeds the editorial closer at the bottom.
  const now = new Date()
  const monthName = now.toLocaleDateString('en-US', { month: 'long' })
  const yearMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const newThisMonth = projects
    .filter(p => p.start_date === yearMonthKey)
    .sort((a, b) => (a.project_number || 0) - (b.project_number || 0))

  // Progress so far — every project's lifecycle bucketed per month.
  // Three states per month:
  //   started    — start_date matches the month
  //   inProgress — start_date is before the month AND (no end_date OR month < end_date)
  //   completed  — end_date matches the month
  // A 1-month project (start === end) counts as BOTH started and completed
  // for that month, with no in-progress (the user's example).
  // monthOf normalises 'YYYY-MM' and 'YYYY-MM-DD' to 'YYYY-MM' so the
  // string comparisons work for both formats.
  const monthOf = (d) => (d ? d.slice(0, 7) : null)
  const projectsWithStart = projects.filter(p => p.start_date)
  let progressMonths = []
  let inMotionThisMonth = 0
  let maxLifecycleBar = 0
  if (projectsWithStart.length > 0) {
    const earliestStart = monthOf(projectsWithStart.map(p => p.start_date).sort()[0])
    const [fy, fm] = earliestStart.split('-').map(Number)
    const cursor = new Date(fy, fm - 1, 1)
    const endOfRange = new Date(now.getFullYear(), now.getMonth(), 1)
    while (cursor <= endOfRange) {
      const k = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
      const started = [], inProgress = [], completed = []
      projects.forEach(p => {
        const sm = monthOf(p.start_date)
        const em = monthOf(p.end_date)
        if (!sm) return
        if (sm === k) started.push(p)
        if (em && em === k) completed.push(p)
        if (sm < k && (!em || k < em)) inProgress.push(p)
      })
      progressMonths.push({ key: k, started, inProgress, completed })
      cursor.setMonth(cursor.getMonth() + 1)
    }
    if (progressMonths.length > 12) progressMonths = progressMonths.slice(-12)
    progressMonths.forEach(d => {
      maxLifecycleBar = Math.max(maxLifecycleBar, d.started.length, d.inProgress.length, d.completed.length)
    })
    // "In motion" headline counts projects active in the CURRENT month —
    // started + in-progress (not completed). Started and inProgress are
    // mutually exclusive (start_date === k vs start_date < k), so a simple
    // sum has no double-count.
    const currentMonth = progressMonths.find(m => m.key === yearMonthKey)
    if (currentMonth) {
      inMotionThisMonth = currentMonth.started.length + currentMonth.inProgress.length
    }
  }

  // Clickable pie chart handler
  const onPieClick = (data, type) => {
    if (type === 'status') drillStatus(data.name)
    else if (type === 'priority') drillPriority(data.name)
  }

  return <div>
    <PageLogo />
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
      <div>
        <h1 className="page-title-gold text-2xl font-bold font-display text-surface-900">Projects Dashboard</h1>
        <p className="text-sm text-surface-500 mt-1">Click any card, chart segment, or bar to drill down into projects</p>
      </div>
      {/* Project-level dashboard selector */}
      <div className="flex items-center gap-2">
        <button onClick={() => generateReport(projects)}
          className="flex items-center gap-2 px-4 py-2 bg-surface-900 text-white rounded-xl text-sm font-medium hover:bg-surface-800 transition-colors shadow-sm whitespace-nowrap">
          <Presentation size={16} /> Generate MBR
        </button>
        <select value={selectedProjectId} onChange={e => { if (e.target.value) navigate(`/projects/${e.target.value}`) }}
          className={`${selectCls} w-auto min-w-[200px] sm:min-w-[240px] text-sm`}>
          <option value="">Jump to project...</option>
          {projects.map(p => <option key={p.id} value={p.id}>#{p.project_number} — {p.project_name}</option>)}
        </select>
      </div>
    </div>

    {/* Summary Cards — value on the left, big tinted icon on the right */}
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-8 stagger">
      {summaryCards.map(({ kpi, label, value, icon: Icon, onClick }) => (
        <div key={label} data-kpi={kpi} onClick={onClick}
          className="bg-white rounded-2xl p-5 border border-surface-200 shadow-sm animate-fade-in hover:shadow-md hover:border-brand-200 transition-all cursor-pointer group">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-2xl font-bold font-display text-surface-900">{value}</p>
              <p className="text-xs text-surface-500 mt-0.5">{label}</p>
            </div>
            <Icon size={44} className="kpi-card-icon shrink-0" strokeWidth={1.5} />
          </div>
          <p className="text-[10px] text-brand-500 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">Click to view →</p>
        </div>
      ))}
    </div>

    {/* Charts — recharts ships in its own chunk; Suspense covers the
        moment between dashboard render and chart code arrival. */}
    <Suspense fallback={<div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8"><div className="bg-white rounded-2xl p-6 border border-surface-200 h-[340px] animate-pulse" /><div className="bg-white rounded-2xl p-6 border border-surface-200 h-[340px] animate-pulse" /></div>}>
      <DashboardCharts
        byStatus={byStatus} byPriority={byPriority} ownerData={ownerData} byPhase={byPhase}
        PIE_COLORS={PIE_COLORS} PRI_PIE_COLORS={PRI_PIE_COLORS}
        onPieClick={onPieClick} drillOwner={drillOwner} drillPhase={drillPhase}
      />
    </Suspense>

    {/* At Risk & Recently Updated */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-2xl p-6 border border-surface-200 shadow-sm">
        <h3 className="text-sm font-semibold text-surface-700 mb-4">At Risk & Delayed Projects</h3>
        {projects.filter(p => p.status === 'At Risk' || p.status === 'Delayed').length === 0 ? (
          <p className="text-sm text-surface-400 py-4">No at-risk or delayed projects</p>
        ) : (
          <div className="space-y-3">
            {projects.filter(p => p.status === 'At Risk' || p.status === 'Delayed').map(p => (
              <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                className="flex items-center justify-between p-3 rounded-xl bg-surface-50 hover:bg-red-50/50 cursor-pointer transition-colors group">
                <div><p className="text-sm font-medium text-surface-800">{p.project_name}</p><p className="text-xs text-surface-500">{p.business_owner}</p></div>
                <div className="flex items-center gap-2"><StatusBadge status={p.status} /><ChevronRight size={14} className="text-surface-300 group-hover:text-red-400" /></div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="bg-white rounded-2xl p-6 border border-surface-200 shadow-sm">
        <h3 className="text-sm font-semibold text-surface-700 mb-4">Recently Updated</h3>
        <div className="space-y-3">
          {[...projects].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 5).map(p => (
            <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
              className="flex items-center justify-between p-3 rounded-xl bg-surface-50 hover:bg-brand-50/50 cursor-pointer transition-colors group">
              <div><p className="text-sm font-medium text-surface-800">{p.project_name}</p><p className="text-xs text-surface-500">{new Date(p.updated_at).toLocaleDateString()}</p></div>
              <div className="flex items-center gap-2"><ProgressBar value={p.percent_complete || '0'} className="w-28" /><ChevronRight size={14} className="text-surface-300 group-hover:text-brand-400" /></div>
            </div>
          ))}
        </div>
      </div>
    </div>

    {/* Progress so far — every project's lifecycle, month by month */}
    {progressMonths.length > 0 && (
      <section className="dash-progress-section">
        <div className="dash-month-eyebrow">Progress So Far</div>
        <h2 className="dash-month-title">{inMotionThisMonth} <span className="yr">in motion</span></h2>
        <p className="dash-month-sub">The lifecycle of every project, month by month. Click a bar to drill in.</p>
        <div className="dash-progress-legend">
          <span className="dash-progress-legend-item"><span className="dash-progress-dot started" /> Started</span>
          <span className="dash-progress-legend-item"><span className="dash-progress-dot in-progress" /> In Progress</span>
          <span className="dash-progress-legend-item"><span className="dash-progress-dot completed" /> Completed</span>
        </div>
        <div className="dash-progress-strip">
          {progressMonths.map(({ key, started, inProgress, completed }) => {
            const [y, m] = key.split('-').map(Number)
            const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' })
            const yrSuffix = `'${String(y).slice(2)}`
            const h = (n) => maxLifecycleBar > 0 ? (n / maxLifecycleBar) * 100 : 0
            const drill = (state, list) => {
              if (!list.length) return
              setDrillDown({
                title: `${state} in ${monthLabel} ${yrSuffix} (${list.length})`,
                projects: list,
              })
            }
            return (
              <div key={key} className="dash-progress-col">
                <div className="dash-progress-bars">
                  <button type="button" disabled={started.length === 0}
                    className="dash-progress-bar-btn"
                    onClick={() => drill('Started', started)}
                    title={`${started.length} started`}>
                    <div className="dash-progress-bar started" style={{ height: `${h(started.length)}%` }} />
                  </button>
                  <button type="button" disabled={inProgress.length === 0}
                    className="dash-progress-bar-btn"
                    onClick={() => drill('In Progress', inProgress)}
                    title={`${inProgress.length} in progress`}>
                    <div className="dash-progress-bar in-progress" style={{ height: `${h(inProgress.length)}%` }} />
                  </button>
                  <button type="button" disabled={completed.length === 0}
                    className="dash-progress-bar-btn"
                    onClick={() => drill('Completed', completed)}
                    title={`${completed.length} completed`}>
                    <div className="dash-progress-bar completed" style={{ height: `${h(completed.length)}%` }} />
                  </button>
                </div>
                <div className="dash-progress-counts">
                  <span className={started.length === 0 ? 'is-zero' : ''}>{started.length}</span>
                  <span className={inProgress.length === 0 ? 'is-zero' : ''}>{inProgress.length}</span>
                  <span className={completed.length === 0 ? 'is-zero' : ''}>{completed.length}</span>
                </div>
                <div className="dash-progress-month">{monthLabel}<span className="yr">{yrSuffix}</span></div>
              </div>
            )
          })}
        </div>
      </section>
    )}

    {/* Editorial closer — projects whose start_date is the current month */}
    <section className="dash-month-section">
      <div className="dash-month-eyebrow">Starting This Month</div>
      <h2 className="dash-month-title">{monthName}<span className="yr">'{String(now.getFullYear()).slice(2)}</span></h2>
      <p className="dash-month-sub">{newThisMonth.length} {newThisMonth.length === 1 ? 'project kicks off' : 'projects kick off'} this month.</p>
      {newThisMonth.length === 0 ? (
        <div className="dash-month-empty">A quiet stretch — no projects starting this month.</div>
      ) : (
        <div className="dash-month-list">
          {newThisMonth.map((p, i) => (
            <div key={p.id} className="dash-month-row" onClick={() => navigate(`/projects/${p.id}`)}>
              <div className="dash-month-num">{String(i + 1).padStart(2, '0')}</div>
              <div>
                <div className="dash-month-name">{p.project_name}</div>
                <div className="dash-month-meta">{p.business_owner || 'Unassigned'} · {p.phase || '—'}</div>
              </div>
              <StatusBadge status={p.status} />
              <div className="dash-month-date">#{p.project_number || '—'}</div>
            </div>
          ))}
        </div>
      )}
    </section>

    {/* Drill-down modal */}
    <DrillDownModal open={!!drillDown} onClose={() => setDrillDown(null)}
      title={drillDown?.title || ''} projects={drillDown?.projects || []}
      onProjectClick={(id) => navigate(`/projects/${id}`)} />
  </div>
}

// ─── PROJECT TRACKER ────────────────────────────────────────
function ProjectTracker() {
  const { isAdmin } = useAuth()
  const { projects, projectsLoading, projectsError, refreshProjects } = useProjects()
  const navigate = useNavigate()
  const [editProject, setEditProject] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatuses, setFilterStatuses] = useState([])
  const [filterPriorities, setFilterPriorities] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const fileInputRef = useRef(null)

  const filtered = useMemo(() => projects.filter(p => {
    if (searchTerm && !p.project_name.toLowerCase().includes(searchTerm.toLowerCase()) && !(p.business_owner || '').toLowerCase().includes(searchTerm.toLowerCase())) return false
    if (filterStatuses.length > 0 && !filterStatuses.includes(p.status)) return false
    if (filterPriorities.length > 0 && !filterPriorities.includes(p.priority)) return false
    return true
  }), [projects, searchTerm, filterStatuses, filterPriorities])

  const handleSave = async (data) => {
    try {
      if (editProject) {
        const { error } = await supabase.from('projects').update(data).eq('id', editProject.id)
        if (error) throw error
        showToast('Project updated', 'success')
      } else {
        const maxNum = projects.reduce((m, p) => Math.max(m, p.project_number || 0), 0)
        const { error } = await supabase.from('projects').insert({ ...data, project_number: maxNum + 1 })
        if (error) throw error
        showToast('Project created', 'success')
      }
      setShowForm(false); setEditProject(null); refreshProjects()
    } catch (e) {
      showToast('Save failed: ' + (e.message || e), 'error')
      // Leave the modal open so the user can retry — don't close or refresh.
    }
  }
  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      const { error } = await supabase.from('projects').delete().eq('id', deleteTarget.id)
      if (error) throw error
      showToast('Project deleted', 'success')
      setDeleteTarget(null); refreshProjects()
    } catch (e) {
      showToast('Delete failed: ' + (e.message || e), 'error')
      // Don't clear deleteTarget — let the user retry from the same modal.
    }
  }
  const handleBulkUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setUploadMsg('')
    try {
      const parsed = await parseBulkUpload(file)
      if (parsed.length === 0) { setUploadMsg('No valid projects found in the file.'); setUploading(false); return }
      const maxNum = projects.reduce((m, p) => Math.max(m, p.project_number || 0), 0)
      const toInsert = parsed.map((p, i) => ({ ...p, project_number: maxNum + 1 + i }))
      const { error } = await supabase.from('projects').insert(toInsert)
      if (error) throw error
      setUploadMsg(`Successfully imported ${toInsert.length} projects!`)
      refreshProjects()
    } catch (err) {
      setUploadMsg(`Error: ${err.message}`)
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  if (projectsLoading) return <Spinner />
  if (projectsError) return <EmptyState icon={AlertCircle} title="Failed to load projects" description={projectsError} action={<button onClick={refreshProjects} className="text-brand-600 text-sm font-medium">Try again</button>} />

  return <div>
    <PageLogo />
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
      <div>
        <h1 className="page-title-gold text-2xl font-bold font-display text-surface-900">Project Tracker</h1>
        <p className="text-sm text-surface-500 mt-1">{projects.length} projects · {filtered.length} shown · Click any row to view details</p>
      </div>
      {isAdmin && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => exportAllToExcel(projects)}
            className="flex items-center gap-1.5 px-3 py-2 border border-emerald-300 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-medium hover:bg-emerald-100 transition-colors">
            <FileSpreadsheet size={14} /> Export All → Excel
          </button>
          <button onClick={downloadTemplate}
            className="flex items-center gap-1.5 px-3 py-2 border border-surface-200 text-surface-600 rounded-xl text-xs font-medium hover:bg-surface-50 transition-colors">
            <Download size={14} /> Template
          </button>
          <input type="file" ref={fileInputRef} accept=".xlsx,.xls,.csv" onChange={handleBulkUpload} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-2 border border-surface-200 text-surface-600 rounded-xl text-xs font-medium hover:bg-surface-50 transition-colors disabled:opacity-50">
            <Upload size={14} /> {uploading ? 'Importing...' : 'Bulk Upload'}
          </button>
          <button onClick={() => { setEditProject(null); setShowForm(true) }}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors shadow-sm">
            <Plus size={16} /> New Project
          </button>
        </div>
      )}
    </div>

    {uploadMsg && (
      <div className={`mb-4 px-4 py-3 rounded-xl text-sm ${uploadMsg.startsWith('Error') ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-emerald-50 border border-emerald-200 text-emerald-700'}`}>
        {uploadMsg}
        <button onClick={() => setUploadMsg('')} className="ml-2 font-medium underline">dismiss</button>
      </div>
    )}

    <div className="flex flex-col sm:flex-row gap-3 mb-6">
      <div className="relative flex-1">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
        <input type="text" placeholder="Search projects or owners..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className={`${inputCls} pl-9`} />
      </div>
      <MultiSelectDropdown options={STATUSES} selected={filterStatuses} onChange={setFilterStatuses} allLabel="All Statuses" />
      <MultiSelectDropdown options={PRIORITIES} selected={filterPriorities} onChange={setFilterPriorities} allLabel="All Priorities" />
    </div>

    <div className="bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden">
      {/* Desktop table */}
      <div className="overflow-x-auto hidden md:block">
        <table className="w-full">
          <thead><tr className="bg-surface-50 border-b border-surface-200">
            {['#', 'Project Name', 'Dept / Module', 'Owner', 'Priority', 'Status', 'Phase', 'Progress', 'Impact', ''].map(h => (
              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-surface-100">
            {filtered.map(p => (
              <tr key={p.id} className="project-row group" onClick={() => navigate(`/projects/${p.id}`)}>
                <td className="px-4 py-3 text-sm font-mono text-surface-400">{p.project_number}</td>
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-surface-800 max-w-xs truncate group-hover:text-brand-600 transition-colors">{p.project_name}</p>
                </td>
                <td className="px-4 py-3 text-sm text-surface-600 max-w-[180px] truncate">{p.dept_module}</td>
                <td className="px-4 py-3 text-sm text-surface-600 whitespace-nowrap">{p.business_owner}</td>
                <td className="px-4 py-3"><PriorityBadge priority={p.priority} /></td>
                <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                <td className="px-4 py-3 text-sm text-surface-600">{p.phase}</td>
                <td className="px-4 py-3 w-36"><ProgressBar value={p.percent_complete || '0'} /></td>
                <td className="px-4 py-3 text-sm text-surface-600">{p.business_impact}</td>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    {isAdmin && <>
                      <button onClick={() => { setEditProject(p); setShowForm(true) }} className="p-1.5 rounded-lg hover:bg-brand-50 text-surface-400 hover:text-brand-600 transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => setDeleteTarget(p)} className="p-1.5 rounded-lg hover:bg-red-50 text-surface-400 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                    </>}
                    <ChevronRight size={14} className="text-surface-300 group-hover:text-brand-500 transition-colors ml-1" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden divide-y divide-surface-100">
        {filtered.map(p => (
          <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
            className="p-4 active:bg-surface-50 transition-colors cursor-pointer">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="text-[10px] font-mono text-surface-400">#{p.project_number}</span>
                  <PriorityBadge priority={p.priority} />
                  <StatusBadge status={p.status} />
                </div>
                <p className="text-sm font-semibold text-surface-800 mb-1 leading-tight">{p.project_name}</p>
                <p className="text-xs text-surface-500">{p.business_owner} · {p.phase}</p>
              </div>
              <div className="flex items-center gap-1 pt-1" onClick={e => e.stopPropagation()}>
                {isAdmin && <>
                  <button onClick={() => { setEditProject(p); setShowForm(true) }} className="p-2 rounded-lg hover:bg-brand-50 text-surface-400"><Pencil size={14} /></button>
                  <button onClick={() => setDeleteTarget(p)} className="p-2 rounded-lg hover:bg-red-50 text-surface-400"><Trash2 size={14} /></button>
                </>}
                <ChevronRight size={16} className="text-surface-300 ml-1" />
              </div>
            </div>
            <ProgressBar value={p.percent_complete || '0'} className="mt-2.5" />
          </div>
        ))}
      </div>
      {filtered.length === 0 && <EmptyState icon={FolderKanban} title="No projects found" description="Try adjusting your search or filter criteria." />}
    </div>

    <ProjectFormModal open={showForm} project={editProject} onClose={() => { setShowForm(false); setEditProject(null) }} onSave={handleSave} />
    <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete}
      title="Delete Project" message={`Are you sure you want to delete "${deleteTarget?.project_name}"? This will also delete all milestones and risks.`} />
  </div>
}

// ─── PROJECT FORM MODAL ─────────────────────────────────────
function ProjectFormModal({ open, project, onClose, onSave }) {
  const [form, setForm] = useState({})
  useEffect(() => {
    if (project) setForm({ ...project })
    else setForm({ priority: 'Medium', status: 'On Track', phase: 'Initiation', business_impact: 'Medium', percent_complete: '0' })
  }, [project, open])
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))
  const handleSubmit = () => { const { id, created_at, updated_at, project_number, ...data } = form; onSave(data) }

  return <Modal open={open} onClose={onClose} title={project ? 'Edit Project' : 'New Project'} wide>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <FormField label="Project Name *" className="md:col-span-2"><input className={inputCls} value={form.project_name || ''} onChange={e => set('project_name', e.target.value)} /></FormField>
      <FormField label="Objective / Goal" className="md:col-span-2"><textarea className={textareaCls} rows={2} value={form.objective || ''} onChange={e => set('objective', e.target.value)} /></FormField>
      <FormField label="Dept / Module"><input className={inputCls} value={form.dept_module || ''} onChange={e => set('dept_module', e.target.value)} /></FormField>
      <FormField label="Business Owner"><input className={inputCls} value={form.business_owner || ''} onChange={e => set('business_owner', e.target.value)} /></FormField>
      <FormField label="Priority"><select className={selectCls} value={form.priority || ''} onChange={e => set('priority', e.target.value)}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></FormField>
      <FormField label="Status"><select className={selectCls} value={form.status || ''} onChange={e => set('status', e.target.value)}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></FormField>
      <FormField label="Phase"><select className={selectCls} value={form.phase || ''} onChange={e => set('phase', e.target.value)}>{PHASES.map(p => <option key={p}>{p}</option>)}</select></FormField>
      <FormField label="% Complete"><input className={inputCls} value={form.percent_complete || ''} onChange={e => set('percent_complete', e.target.value)} placeholder="0-100 or Ongoing" /></FormField>
      <FormField label="Est. Start (YYYY-MM)"><input className={inputCls} value={form.est_start || ''} onChange={e => set('est_start', e.target.value)} placeholder="2026-01" /></FormField>
      <FormField label="Est. End (YYYY-MM)"><input className={inputCls} value={form.est_end || ''} onChange={e => set('est_end', e.target.value)} placeholder="2026-12" /></FormField>
      <FormField label="Start Date (YYYY-MM)"><input className={inputCls} value={form.start_date || ''} onChange={e => set('start_date', e.target.value)} placeholder="2026-01" /></FormField>
      <FormField label="End Date (YYYY-MM)"><input className={inputCls} value={form.end_date || ''} onChange={e => set('end_date', e.target.value)} placeholder="2026-12" /></FormField>
      <FormField label="Total Cost (KWD)"><input className={inputCls} type="number" value={form.total_cost_kwd || ''} onChange={e => set('total_cost_kwd', e.target.value)} /></FormField>
      <FormField label="Business Impact"><select className={selectCls} value={form.business_impact || ''} onChange={e => set('business_impact', e.target.value)}><option value="">—</option>{IMPACTS.map(i => <option key={i}>{i}</option>)}</select></FormField>
      <FormField label="Cost Remarks"><input className={inputCls} value={form.cost_remarks || ''} onChange={e => set('cost_remarks', e.target.value)} /></FormField>
      <FormField label="Dependencies" className="md:col-span-2"><textarea className={textareaCls} rows={2} value={form.dependencies || ''} onChange={e => set('dependencies', e.target.value)} /></FormField>
      <FormField label="Key Risks" className="md:col-span-2"><textarea className={textareaCls} rows={2} value={form.key_risks || ''} onChange={e => set('key_risks', e.target.value)} /></FormField>
      <FormField label="Mitigation" className="md:col-span-2"><textarea className={textareaCls} rows={2} value={form.mitigation || ''} onChange={e => set('mitigation', e.target.value)} /></FormField>
      <FormField label="Notes / Updates" className="md:col-span-2"><textarea className={textareaCls} rows={2} value={form.notes_updates || ''} onChange={e => set('notes_updates', e.target.value)} /></FormField>
      <FormField label="Actions Needed / Next Steps" className="md:col-span-2"><textarea className={textareaCls} rows={2} value={form.actions_needed || ''} onChange={e => set('actions_needed', e.target.value)} /></FormField>
    </div>
    <div className="flex gap-3 justify-end mt-6 pt-4 border-t border-surface-200">
      <button onClick={onClose} className="px-4 py-2 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-50 font-medium text-sm">Cancel</button>
      <button onClick={handleSubmit} disabled={!form.project_name}
        className="flex items-center gap-2 px-5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-medium text-sm disabled:opacity-40 transition-colors">
        <Save size={14} /> {project ? 'Update' : 'Create'}
      </button>
    </div>
  </Modal>
}

// ─── PROJECT DETAIL (with project-level dashboard) ──────────
function ProjectDetail() {
  const { id } = useParams()
  const { isAdmin } = useAuth()
  const { refreshProjects } = useProjects()
  const navigate = useNavigate()
  const [project, setProject] = useState(null)
  const [milestones, setMilestones] = useState([])
  const [risks, setRisks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showMilestoneForm, setShowMilestoneForm] = useState(false)
  const [editMilestone, setEditMilestone] = useState(null)
  const [showRiskForm, setShowRiskForm] = useState(false)
  const [editRisk, setEditRisk] = useState(null)
  const [deleteMilestone, setDeleteMilestone] = useState(null)
  const [deleteRisk, setDeleteRisk] = useState(null)
  const [delayReasons, setDelayReasons] = useState([])
  const [editDelayReason, setEditDelayReason] = useState(null)
  const [showDelayReasonForm, setShowDelayReasonForm] = useState(false)
  const [deleteDelayReason, setDeleteDelayReason] = useState(null)
  const [tab, setTab] = useState('dashboard')
  const [showEditProject, setShowEditProject] = useState(false)
  const [dashDrill, setDashDrill] = useState(null) // { title, items, type:'milestones'|'risks' }
  const [fetchError, setFetchError] = useState(null)
  const [hourLogs, setHourLogs] = useState([])         // raw task_logs for this project
  const [msUploading, setMsUploading] = useState(false)
  const [msUploadMsg, setMsUploadMsg] = useState('')
  const msFileRef = useRef(null)
  const [rkUploading, setRkUploading] = useState(false)
  const [rkUploadMsg, setRkUploadMsg] = useState('')
  const rkFileRef = useRef(null)

  const fetchAll = useCallback(async () => {
    setFetchError(null)
    try {
      const [{ data: p, error: pe }, { data: m, error: me }, { data: r, error: re }, { data: dr, error: drE }] = await Promise.all([
        supabasePublic.from('projects').select('*').eq('id', id).single(),
        supabasePublic.from('milestones').select('*').eq('project_id', id).order('milestone_number'),
        supabasePublic.from('risks').select('*').eq('project_id', id).order('risk_number'),
        supabasePublic.from('delay_reasons').select('*').eq('project_id', id).order('reason_number'),
      ])
      if (pe) throw pe
      if (me) console.error('Milestones fetch error:', me)
      if (re) console.error('Risks fetch error:', re)
      if (drE) console.error('Delay reasons fetch error:', drE)
      setProject(p); setMilestones(m || []); setRisks(r || []); setDelayReasons(dr || [])

      // Secondary: employee hours on this project — depends on p.proj_unique_id.
      // Include user_id + profiles join so we can show landing-page avatars on
      // the contributor cards. Falls back to team_member name for legacy rows.
      if (p?.proj_unique_id) {
        const { data: logs, error: le } = await supabasePublic
          .from('task_logs')
          .select('user_id, team_member, hours_spent, log_date, task_project, task_description, profiles!user_id(id, full_name, avatar_url)')
          .eq('linked_project_id', p.proj_unique_id)
        if (le) console.error('Task logs fetch error:', le)
        else setHourLogs(logs || [])
      }
    } catch (e) {
      console.error('ProjectDetail fetch error:', e)
      setFetchError(e.message || 'Failed to load project data')
    } finally {
      setLoading(false)
    }
  }, [id])
  useEffect(() => { fetchAll() }, [fetchAll])

  // Per-project bulk upload — milestones
  const handleMilestoneBulk = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setMsUploading(true); setMsUploadMsg('')
    try {
      const parsed = await parseMilestoneBulk(file)
      if (parsed.length === 0) { setMsUploadMsg('No valid milestones found in file.'); setMsUploading(false); return }
      const maxNum = milestones.reduce((m, ms) => Math.max(m, ms.milestone_number || 0), 0)
      const toInsert = parsed.map((m, i) => ({ ...m, project_id: parseInt(id), milestone_number: maxNum + 1 + i }))
      const { error } = await supabase.from('milestones').insert(toInsert)
      if (error) throw error
      setMsUploadMsg(`Imported ${toInsert.length} milestones.`)
      fetchAll()
    } catch (err) { setMsUploadMsg('Error: ' + err.message) }
    setMsUploading(false)
    if (msFileRef.current) msFileRef.current.value = ''
  }

  // Per-project bulk upload — risks
  const handleRiskBulk = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setRkUploading(true); setRkUploadMsg('')
    try {
      const parsed = await parseRiskBulk(file)
      if (parsed.length === 0) { setRkUploadMsg('No valid risks found in file.'); setRkUploading(false); return }
      const maxNum = risks.reduce((m, r) => Math.max(m, r.risk_number || 0), 0)
      const toInsert = parsed.map((r, i) => ({ ...r, project_id: parseInt(id), risk_number: maxNum + 1 + i }))
      const { error } = await supabase.from('risks').insert(toInsert)
      if (error) throw error
      setRkUploadMsg(`Imported ${toInsert.length} risks.`)
      fetchAll()
    } catch (err) { setRkUploadMsg('Error: ' + err.message) }
    setRkUploading(false)
    if (rkFileRef.current) rkFileRef.current.value = ''
  }

  const saveMilestone = async (data) => {
    try {
      if (editMilestone) {
        const { error } = await supabase.from('milestones').update(data).eq('id', editMilestone.id)
        if (error) throw error
      } else {
        const maxNum = milestones.reduce((m, ms) => Math.max(m, ms.milestone_number || 0), 0)
        const { error } = await supabase.from('milestones').insert({ ...data, project_id: parseInt(id), milestone_number: maxNum + 1 })
        if (error) throw error
      }
      showToast('Milestone saved', 'success')
      setShowMilestoneForm(false); setEditMilestone(null); fetchAll()
    } catch (e) { showToast('Save failed: ' + (e.message || e), 'error') }
  }
  const saveRisk = async (data) => {
    try {
      if (editRisk) {
        const { error } = await supabase.from('risks').update(data).eq('id', editRisk.id)
        if (error) throw error
      } else {
        const maxNum = risks.reduce((m, r) => Math.max(m, r.risk_number || 0), 0)
        const { error } = await supabase.from('risks').insert({ ...data, project_id: parseInt(id), risk_number: maxNum + 1 })
        if (error) throw error
      }
      showToast('Risk saved', 'success')
      setShowRiskForm(false); setEditRisk(null); fetchAll()
    } catch (e) { showToast('Save failed: ' + (e.message || e), 'error') }
  }
  const handleDeleteMilestone = async () => {
    if (!deleteMilestone) return
    try {
      const { error } = await supabase.from('milestones').delete().eq('id', deleteMilestone.id)
      if (error) throw error
      showToast('Milestone deleted', 'success')
      setDeleteMilestone(null); fetchAll()
    } catch (e) { showToast('Delete failed: ' + (e.message || e), 'error') }
  }
  const handleDeleteRisk = async () => {
    if (!deleteRisk) return
    try {
      const { error } = await supabase.from('risks').delete().eq('id', deleteRisk.id)
      if (error) throw error
      showToast('Risk deleted', 'success')
      setDeleteRisk(null); fetchAll()
    } catch (e) { showToast('Delete failed: ' + (e.message || e), 'error') }
  }
  const saveDelayReason = async (data) => {
    try {
      if (editDelayReason) {
        const { error } = await supabase.from('delay_reasons').update(data).eq('id', editDelayReason.id)
        if (error) throw error
      } else {
        const maxNum = delayReasons.reduce((m, d) => Math.max(m, d.reason_number || 0), 0)
        const { error } = await supabase.from('delay_reasons').insert({ ...data, project_id: parseInt(id), reason_number: maxNum + 1 })
        if (error) throw error
      }
      showToast('Delay reason saved', 'success')
      setShowDelayReasonForm(false); setEditDelayReason(null); fetchAll()
    } catch (e) { showToast('Save failed: ' + (e.message || e), 'error') }
  }
  const handleDeleteDelayReason = async () => {
    if (!deleteDelayReason) return
    try {
      const { error } = await supabase.from('delay_reasons').delete().eq('id', deleteDelayReason.id)
      if (error) throw error
      showToast('Delay reason deleted', 'success')
      setDeleteDelayReason(null); fetchAll()
    } catch (e) { showToast('Delete failed: ' + (e.message || e), 'error') }
  }
  const saveProject = async (data) => {
    try {
      const { error } = await supabase.from('projects').update(data).eq('id', project.id)
      if (error) throw error
      showToast('Project updated', 'success')
      setShowEditProject(false)
      // Refresh both the local detail page AND the global projects cache
      // so other surfaces (Dashboard, Gantt, ProjectTracker) reflect the
      // change without needing a full reload.
      fetchAll()
      refreshProjects()
    } catch (e) { showToast('Save failed: ' + (e.message || e), 'error') }
  }

  if (loading) return <Spinner />
  if (fetchError) return <EmptyState icon={AlertCircle} title="Failed to load project" description={fetchError} action={<button onClick={fetchAll} className="text-brand-600 text-sm font-medium">Try again</button>} />
  if (!project) return <EmptyState icon={FolderKanban} title="Project not found" description="This project may have been deleted." action={<Link to="/projects" className="text-brand-600 text-sm font-medium">← Back to tracker</Link>} />

  // Analytics
  const completedMs = milestones.filter(m => m.development_status === 'Completed').length
  const msProgress = milestones.length > 0 ? Math.round((completedMs / milestones.length) * 100) : 0
  const devStatusData = DEV_STATUSES.map(s => ({ name: s, value: milestones.filter(m => m.development_status === s).length })).filter(d => d.value > 0)
  const uatStatusData = UAT_STATUSES.map(s => ({ name: s, value: milestones.filter(m => m.uat_status === s).length })).filter(d => d.value > 0)
  const riskByImpact = IMPACTS.map(i => ({ name: i, value: risks.filter(r => r.impact === i).length })).filter(d => d.value > 0)
  const riskByLikelihood = IMPACTS.map(i => ({ name: i, value: risks.filter(r => r.likelihood === i).length })).filter(d => d.value > 0)
  const devColors = DEV_STATUSES.map(s => DEV_STATUS_COLORS[s]?.hex || '#94a3b8')
  const uatColors = UAT_STATUSES.map(s => UAT_STATUS_COLORS[s]?.hex || '#94a3b8')

  return <div>
    {/* Back navigation */}
    <button onClick={() => navigate('/projects')} className="flex items-center gap-1.5 text-sm text-surface-500 hover:text-brand-600 mb-4 transition-colors">
      <ArrowLeft size={16} /> Back to Project Tracker
    </button>

    {/* Project Header Card — like the Ecom Integration sheet */}
    <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6 mb-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="text-xs font-mono text-surface-400 bg-surface-100 px-2 py-0.5 rounded">#{project.project_number}</span>
            <PriorityBadge priority={project.priority} />
            <StatusBadge status={project.status} />
            <span className="text-xs bg-surface-100 text-surface-600 px-2 py-0.5 rounded font-medium">{project.phase}</span>
          </div>
          <h1 className="text-xl font-bold font-display text-surface-900 mb-2">{project.project_name}</h1>
          {project.objective && <p className="text-sm text-surface-600 leading-relaxed max-w-3xl">{project.objective}</p>}
        </div>
        <div className="flex flex-col items-end gap-2 min-w-[220px]">
          <ProgressBar value={project.percent_complete || '0'} className="w-full" height="h-3" />
          {isAdmin && (
            <button onClick={() => setShowEditProject(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-medium hover:bg-brand-700 transition-colors mt-1">
              <Pencil size={12} /> Edit All Details
            </button>
          )}
        </div>
      </div>

      {/* Meta grid — matching the Ecom Integration detail sheet layout */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-surface-100">
        {[
          { l: 'Department / Module', v: project.dept_module },
          { l: 'Business Owner', v: project.business_owner },
          { l: 'Est. Start', v: project.est_start || '—' },
          { l: 'Est. End', v: project.est_end || '—' },
          { l: 'Start Date', v: project.start_date },
          { l: 'End Date', v: project.end_date },
          { l: 'Business Impact', v: project.business_impact },
          { l: 'Total Cost (KWD)', v: project.total_cost_kwd ? parseFloat(project.total_cost_kwd).toLocaleString() : '—' },
          { l: 'Cost Remarks', v: project.cost_remarks || '—' },
        ].map(({ l, v }) => (
          <div key={l}><p className="text-xs text-surface-400 mb-0.5">{l}</p><p className="text-sm font-medium text-surface-700">{v || '—'}</p></div>
        ))}
      </div>

      {/* Expandable text sections */}
      {[
        { l: 'Dependencies', v: project.dependencies },
        { l: 'Key Risks', v: project.key_risks },
        { l: 'Mitigation', v: project.mitigation },
        { l: 'Notes / Updates', v: project.notes_updates },
        { l: 'Actions Needed / Next Steps', v: project.actions_needed },
      ].filter(s => s.v).map(({ l, v }) => (
        <div key={l} className="mt-4 pt-4 border-t border-surface-100">
          <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">{l}</p>
          <p className="text-sm text-surface-700 leading-relaxed whitespace-pre-line">{v}</p>
        </div>
      ))}
    </div>

    {/* Tabs — Dashboard / Milestones / Risks */}
    <div className="flex gap-1 mb-6 bg-surface-100 rounded-xl p-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 sm:w-fit">
      {[
        { key: 'dashboard', label: 'Project Dashboard', icon: BarChart3 },
        { key: 'milestones', label: 'Key Milestones', icon: ListChecks, count: milestones.length },
        { key: 'risks', label: 'Risks & Issues', icon: FileWarning, count: risks.length },
        { key: 'delay_reasons', label: 'Delay Reasons', icon: Clock, count: delayReasons.length },
      ].map(({ key, label, icon: Icon, count }) => (
        <button key={key} onClick={() => setTab(key)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${tab === key ? 'bg-white text-surface-800 shadow-sm' : 'text-surface-500 hover:text-surface-700'}`}>
          <Icon size={15} /> {label} {count !== undefined && <span className="text-xs bg-surface-200 px-1.5 py-0.5 rounded-full">{count}</span>}
        </button>
      ))}
    </div>

    {/* ─── Project Dashboard Tab ─── */}
    {tab === 'dashboard' && (
      <div>
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border border-surface-200">
            <p className="text-xs text-surface-400 mb-1">Total Milestones</p>
            <p className="text-2xl font-bold font-display text-surface-900">{milestones.length}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-surface-200">
            <p className="text-xs text-surface-400 mb-1">Completed</p>
            <p className="text-2xl font-bold font-display text-emerald-600">{completedMs}</p>
            <ProgressBar value={String(msProgress)} className="mt-2" />
          </div>
          <div className="bg-white rounded-xl p-4 border border-surface-200">
            <p className="text-xs text-surface-400 mb-1">Open Risks</p>
            <p className="text-2xl font-bold font-display text-red-600">{risks.length}</p>
            {risks.filter(r => r.impact === 'High').length > 0 && <p className="text-xs text-red-500 mt-1">{risks.filter(r => r.impact === 'High').length} high impact</p>}
          </div>
        </div>

        {milestones.length > 0 ? (
          <div className="mb-6">
            {/* Status Pie — single chart now that UAT is hidden site-wide */}
            <div className="bg-white rounded-2xl p-6 border border-surface-200 max-w-2xl mx-auto">
              <h3 className="text-sm font-semibold text-surface-700 mb-1">Status</h3>
              <p className="text-xs text-surface-400 mb-3">Click a segment to see milestones</p>
              <Suspense fallback={<ChartFallback height={220} />}>
                <ProjectDetailChartsLazy kind="dev" data={devStatusData} colors={DEV_STATUS_COLORS}
                  onDrill={(name) => { const filtered = milestones.filter(m => m.development_status === name); setDashDrill({ title: `Status: ${name} (${filtered.length})`, items: filtered, type: 'milestones' }) }} />
              </Suspense>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-surface-200 p-8 text-center mb-6">
            <Info className="text-surface-300 mx-auto mb-3" size={32} />
            <p className="text-sm text-surface-500">Add milestones to see project-level analytics here</p>
            {isAdmin && <button onClick={() => { setTab('milestones'); setTimeout(() => setShowMilestoneForm(true), 100) }}
              className="text-brand-600 text-sm font-medium mt-2 hover:underline">+ Add first milestone</button>}
          </div>
        )}

        {/* Risk summary */}
        {risks.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl p-6 border border-surface-200">
              <h3 className="text-sm font-semibold text-surface-700 mb-1">Risks by Impact</h3>
              <p className="text-xs text-surface-400 mb-3">Click a bar to see risks</p>
              <Suspense fallback={<ChartFallback height={180} />}>
                <ProjectDetailChartsLazy kind="risk" data={riskByImpact} fill="#ef4444"
                  onDrill={(name) => { const filtered = risks.filter(r => r.impact === name); setDashDrill({ title: `${name} Impact Risks (${filtered.length})`, items: filtered, type: 'risks' }) }} />
              </Suspense>
            </div>
            <div className="bg-white rounded-2xl p-6 border border-surface-200">
              <h3 className="text-sm font-semibold text-surface-700 mb-1">Risks by Likelihood</h3>
              <p className="text-xs text-surface-400 mb-3">Click a bar to see risks</p>
              <Suspense fallback={<ChartFallback height={180} />}>
                <ProjectDetailChartsLazy kind="risk" data={riskByLikelihood} fill="#f59e0b"
                  onDrill={(name) => { const filtered = risks.filter(r => r.likelihood === name); setDashDrill({ title: `${name} Likelihood Risks (${filtered.length})`, items: filtered, type: 'risks' }) }} />
              </Suspense>
            </div>
          </div>
        )}

        {/* Employee hours on this project — portrait cards grid */}
        {(() => {
          // Aggregate: per member → { hours, logs[], byDay{date:hours}, avatar }
          // Group by user_id when available so the same person logged under
          // different team_member spellings still rolls up; fall back to the
          // string key for legacy rows missing user_id.
          const byMember = {}
          hourLogs.forEach(l => {
            const key = l.user_id || ('name:' + (l.team_member || 'Unknown'))
            if (!byMember[key]) byMember[key] = {
              name: l.profiles?.full_name || l.team_member || 'Unknown',
              avatar: l.profiles?.avatar_url || null,
              hours: 0, logs: [], byDay: {},
            }
            const hrs = parseFloat(l.hours_spent || 0)
            byMember[key].hours += hrs
            byMember[key].logs.push(l)
            if (l.log_date) byMember[key].byDay[l.log_date] = (byMember[key].byDay[l.log_date] || 0) + hrs
          })
          const contributors = Object.values(byMember)
            .map(m => ({ ...m, hours: Math.round(m.hours * 10) / 10 }))
            .sort((a, b) => b.hours - a.hours)
          const totalHours = contributors.reduce((s, d) => s + d.hours, 0)

          if (contributors.length === 0) {
            return (
              <div className="bg-white rounded-2xl border border-surface-200 p-6 mt-6">
                <h3 className="text-sm font-semibold text-surface-700 mb-1">Hours Logged by Employee</h3>
                <p className="text-xs text-surface-400 mb-3">From EBS Tracker — no team member has logged hours against this project yet.</p>
              </div>
            )
          }

          // Tiny SVG sparkline — daily contribution polyline
          const sparkline = (byDay) => {
            const days = Object.keys(byDay).sort()
            if (days.length < 2) {
              // single day → draw a flat line so card layout is consistent
              return <div className="h-10 flex items-end gap-[2px]">
                <span className="inline-block w-1 bg-brand-500/70 rounded-sm" style={{ height: '60%' }} />
              </div>
            }
            const vals = days.map(d => byDay[d])
            const max = Math.max(...vals)
            const W = 140, H = 36
            const pts = vals.map((v, i) => {
              const x = (i / (vals.length - 1)) * W
              const y = H - (max > 0 ? (v / max) * (H - 6) : 0) - 3
              return `${x.toFixed(1)},${y.toFixed(1)}`
            }).join(' ')
            const last = pts.split(' ').pop().split(',')
            return (
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-10 overflow-visible">
                <defs>
                  <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#818cf8" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polygon fill="url(#spark-fill)" points={`0,${H} ${pts} ${W},${H}`} />
                <polyline fill="none" stroke="#818cf8" strokeWidth="1.5" points={pts} strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={last[0]} cy={last[1]} r="2.5" fill="#818cf8" />
              </svg>
            )
          }

          return (
            <div className="bg-white rounded-2xl border border-surface-200 p-6 mt-6">
              <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                <h3 className="text-sm font-semibold text-surface-700">Hours Logged by Employee</h3>
                <div className="flex gap-3 text-xs text-surface-500">
                  <span><strong className="text-surface-700">{contributors.length}</strong> contributors</span>
                  <span><strong className="text-surface-700">{totalHours.toFixed(1)}</strong> total hours</span>
                </div>
              </div>
              <p className="text-xs text-surface-400 mb-5">Click a card to see that employee's individual log entries.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {contributors.map(c => {
                  const initials = c.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                  const pct = totalHours > 0 ? Math.round((c.hours / totalHours) * 100) : 0
                  return (
                    <button
                      key={c.name}
                      onClick={() => setDashDrill({ title: `${c.name} — ${c.hours.toFixed(1)} h`, items: c.logs, type: 'hour_logs' })}
                      className="text-left bg-white rounded-2xl border border-surface-200 p-5 hover:border-brand-300 transition-all group"
                    >
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-11 h-11 rounded-full flex items-center justify-center font-semibold text-sm text-white shadow-sm overflow-hidden"
                          style={{ background: 'linear-gradient(135deg, #6366f1, #4338ca)' }}>
                          {c.avatar
                            ? <img src={c.avatar} alt={c.name} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.replaceWith(Object.assign(document.createTextNode(initials), {})) }} />
                            : initials}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-surface-800 truncate">{c.name}</div>
                          <div className="text-[11px] text-surface-500">{c.logs.length} {c.logs.length === 1 ? 'entry' : 'entries'}</div>
                        </div>
                      </div>
                      <div className="flex items-baseline gap-1 mb-1">
                        <span className="font-display text-3xl font-bold text-surface-900">{c.hours.toFixed(1)}</span>
                        <span className="text-xs font-mono text-surface-500">h</span>
                        <span className="ml-auto text-[10px] uppercase tracking-widest text-surface-400">{pct}%</span>
                      </div>
                      {sparkline(c.byDay)}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* Milestone details list on dashboard */}
        {milestones.length > 0 && (
          <div className="bg-white rounded-2xl border border-surface-200 p-6 mt-6">
            <h3 className="text-sm font-semibold text-surface-700 mb-4">Milestone Progress Overview</h3>
            <div className="space-y-3">
              {milestones.map(m => (
                <div key={m.id} className="flex items-center gap-4 p-3 rounded-xl bg-surface-50">
                  <span className="text-xs font-mono text-surface-400 w-6">#{m.milestone_number}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-surface-800 truncate">{m.deliverable}</p>
                    {m.owner && <p className="text-xs text-surface-400">Owner: {m.owner}</p>}
                  </div>
                  <DevStatusBadge status={m.development_status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )}

    {/* ─── Milestones Tab ─── */}
    {tab === 'milestones' && (
      <div className="bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden">
        {isAdmin && (
          <div className="px-4 py-3 border-b border-surface-100 flex items-center gap-2 justify-end flex-wrap">
            {msUploadMsg && <span className={`text-xs ${msUploadMsg.startsWith('Error') ? 'text-red-600' : 'text-emerald-600'}`}>{msUploadMsg}</span>}
            <button onClick={downloadMilestoneTemplate}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-surface-200 text-surface-600 rounded-lg text-xs font-medium hover:bg-surface-50 transition-colors">
              <Download size={13} /> Template
            </button>
            <input type="file" ref={msFileRef} accept=".xlsx,.xls,.csv" onChange={handleMilestoneBulk} className="hidden" />
            <button onClick={() => msFileRef.current?.click()} disabled={msUploading}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-surface-200 text-surface-600 rounded-lg text-xs font-medium hover:bg-surface-50 transition-colors disabled:opacity-50">
              <Upload size={13} /> {msUploading ? 'Importing…' : 'Bulk Upload'}
            </button>
            <button onClick={() => { setEditMilestone(null); setShowMilestoneForm(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-medium hover:bg-brand-700 transition-colors">
              <Plus size={13} /> Add Milestone
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="bg-surface-50 border-b border-surface-200">
              {['#', 'Key Deliverable', 'Est Start', 'Actual Start', 'Est End', 'Actual End', 'Status', 'Dependencies', 'Owner', 'Remarks', isAdmin && 'Actions'].filter(Boolean).map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-surface-100">
              {milestones.map(m => (
                <tr key={m.id} className="hover:bg-surface-50 transition-colors">
                  <td className="px-4 py-3 text-sm font-mono text-surface-400">{m.milestone_number}</td>
                  <td className="px-4 py-3"><p className="text-sm font-medium text-surface-800">{m.deliverable}</p></td>
                  <td className="px-4 py-3 text-sm text-surface-600 whitespace-nowrap">{m.est_start_date || '—'}</td>
                  <td className="px-4 py-3 text-sm text-surface-600 whitespace-nowrap">{m.actual_date || '—'}</td>
                  <td className="px-4 py-3 text-sm text-surface-600 whitespace-nowrap">{m.target_date || '—'}</td>
                  <td className="px-4 py-3 text-sm text-surface-600 whitespace-nowrap">{m.actual_end_date || '—'}</td>
                  <td className="px-4 py-3"><DevStatusBadge status={m.development_status} /></td>
                  <td className="px-4 py-3 text-xs text-surface-500 max-w-[200px]"><p className="truncate">{m.dependencies || '—'}</p></td>
                  <td className="px-4 py-3 text-sm text-surface-600 whitespace-nowrap">{m.owner || '—'}</td>
                  <td className="px-4 py-3 text-xs text-surface-500 max-w-[200px]"><p className="truncate">{m.remarks || '—'}</p></td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditMilestone(m); setShowMilestoneForm(true) }} className="p-1.5 rounded-lg hover:bg-brand-50 text-surface-400 hover:text-brand-600 transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => setDeleteMilestone(m)} className="p-1.5 rounded-lg hover:bg-red-50 text-surface-400 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {milestones.length === 0 && (
          <EmptyState icon={ListChecks} title="No milestones yet"
            description={isAdmin ? "Add milestones to track key deliverables for this project." : "No milestones have been added yet."}
            action={isAdmin && <button onClick={() => setShowMilestoneForm(true)} className="text-brand-600 text-sm font-medium">+ Add first milestone</button>} />
        )}
      </div>
    )}

    {/* ─── Risks Tab ─── */}
    {tab === 'risks' && (
      <div className="bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden">
        {isAdmin && (
          <div className="px-4 py-3 border-b border-surface-100 flex items-center gap-2 justify-end flex-wrap">
            {rkUploadMsg && <span className={`text-xs ${rkUploadMsg.startsWith('Error') ? 'text-red-600' : 'text-emerald-600'}`}>{rkUploadMsg}</span>}
            <button onClick={downloadRiskTemplate}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-surface-200 text-surface-600 rounded-lg text-xs font-medium hover:bg-surface-50 transition-colors">
              <Download size={13} /> Template
            </button>
            <input type="file" ref={rkFileRef} accept=".xlsx,.xls,.csv" onChange={handleRiskBulk} className="hidden" />
            <button onClick={() => rkFileRef.current?.click()} disabled={rkUploading}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-surface-200 text-surface-600 rounded-lg text-xs font-medium hover:bg-surface-50 transition-colors disabled:opacity-50">
              <Upload size={13} /> {rkUploading ? 'Importing…' : 'Bulk Upload'}
            </button>
            <button onClick={() => { setEditRisk(null); setShowRiskForm(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-medium hover:bg-brand-700 transition-colors">
              <Plus size={13} /> Add Risk
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="bg-surface-50 border-b border-surface-200">
              {['#', 'Risk / Issue Description', 'Impact', 'Likelihood', 'Mitigation Action', 'Owner', isAdmin && 'Actions'].filter(Boolean).map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-surface-100">
              {risks.map(r => (
                <tr key={r.id} className="hover:bg-surface-50 transition-colors">
                  <td className="px-4 py-3 text-sm font-mono text-surface-400">{r.risk_number}</td>
                  <td className="px-4 py-3 text-sm text-surface-800 max-w-xs">{r.description}</td>
                  <td className="px-4 py-3">{r.impact && <Badge colors={PRIORITY_COLORS[r.impact] || PRIORITY_COLORS['Medium']}>{r.impact}</Badge>}</td>
                  <td className="px-4 py-3">{r.likelihood && <Badge colors={PRIORITY_COLORS[r.likelihood] || PRIORITY_COLORS['Medium']}>{r.likelihood}</Badge>}</td>
                  <td className="px-4 py-3 text-sm text-surface-600 max-w-xs">{r.mitigation_action || '—'}</td>
                  <td className="px-4 py-3 text-sm text-surface-600">{r.owner || '—'}</td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditRisk(r); setShowRiskForm(true) }} className="p-1.5 rounded-lg hover:bg-brand-50 text-surface-400 hover:text-brand-600 transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => setDeleteRisk(r)} className="p-1.5 rounded-lg hover:bg-red-50 text-surface-400 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {risks.length === 0 && (
          <EmptyState icon={FileWarning} title="No risks logged"
            description={isAdmin ? "Log risks and issues for this project." : "No risks have been logged yet."}
            action={isAdmin && <button onClick={() => setShowRiskForm(true)} className="text-brand-600 text-sm font-medium">+ Add first risk</button>} />
        )}
      </div>
    )}

    {/* ─── Delay Reasons Tab ─── */}
    {tab === 'delay_reasons' && (
      <div className="bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden">
        {isAdmin && (
          <div className="px-4 py-3 border-b border-surface-100 flex items-center gap-2 justify-end">
            <button onClick={() => { setEditDelayReason(null); setShowDelayReasonForm(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-medium hover:bg-brand-700 transition-colors">
              <Plus size={13} /> Add Delay Reason
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="bg-surface-50 border-b border-surface-200">
              {['#', 'Date', 'Reason', isAdmin && 'Actions'].filter(Boolean).map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-surface-100">
              {delayReasons.map(d => (
                <tr key={d.id} className="hover:bg-surface-50 transition-colors">
                  <td className="px-4 py-3 text-sm font-mono text-surface-400">{d.reason_number}</td>
                  <td className="px-4 py-3 text-sm text-surface-600 whitespace-nowrap">{d.recorded_date || '—'}</td>
                  <td className="px-4 py-3 text-sm text-surface-800 whitespace-pre-wrap">{d.reason}</td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditDelayReason(d); setShowDelayReasonForm(true) }} className="p-1.5 rounded-lg hover:bg-brand-50 text-surface-400 hover:text-brand-600 transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => setDeleteDelayReason(d)} className="p-1.5 rounded-lg hover:bg-red-50 text-surface-400 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {delayReasons.length === 0 && (
          <EmptyState icon={Clock} title="No delay reasons logged"
            description={isAdmin ? "Log a reason whenever the project's timeline slips." : "No delay reasons have been logged yet."}
            action={isAdmin && <button onClick={() => setShowDelayReasonForm(true)} className="text-brand-600 text-sm font-medium">+ Add first delay reason</button>} />
        )}
      </div>
    )}

    {/* Modals */}
    <ProjectFormModal open={showEditProject} project={project} onClose={() => setShowEditProject(false)} onSave={saveProject} />
    <MilestoneFormModal open={showMilestoneForm} milestone={editMilestone} onClose={() => { setShowMilestoneForm(false); setEditMilestone(null) }} onSave={saveMilestone} />
    <RiskFormModal open={showRiskForm} risk={editRisk} onClose={() => { setShowRiskForm(false); setEditRisk(null) }} onSave={saveRisk} />
    <ConfirmDialog open={!!deleteMilestone} onClose={() => setDeleteMilestone(null)} onConfirm={handleDeleteMilestone} title="Delete Milestone" message={`Delete "${deleteMilestone?.deliverable}"?`} />
    <ConfirmDialog open={!!deleteRisk} onClose={() => setDeleteRisk(null)} onConfirm={handleDeleteRisk} title="Delete Risk" message="Delete this risk/issue entry?" />
    <DelayReasonFormModal open={showDelayReasonForm} delayReason={editDelayReason} onClose={() => { setShowDelayReasonForm(false); setEditDelayReason(null) }} onSave={saveDelayReason} />
    <ConfirmDialog open={!!deleteDelayReason} onClose={() => setDeleteDelayReason(null)} onConfirm={handleDeleteDelayReason} title="Delete Delay Reason" message="Delete this delay reason?" />

    {/* Project Dashboard Drill-Down Modal */}
    <Modal open={!!dashDrill} onClose={() => setDashDrill(null)} title={dashDrill?.title || ''} wide>
      {dashDrill?.type === 'milestones' && (
        <div className="space-y-2">
          {(dashDrill?.items || []).map(m => (
            <div key={m.id} className="flex items-center justify-between p-4 rounded-xl border border-surface-100 bg-surface-50">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-surface-400">#{m.milestone_number}</span>
                  <p className="text-sm font-semibold text-surface-800">{m.deliverable}</p>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  {m.owner && <span className="text-xs text-surface-500">Owner: {m.owner}</span>}
                  {m.target_date && <span className="text-xs text-surface-500">Est End: {m.target_date}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <DevStatusBadge status={m.development_status} />
              </div>
            </div>
          ))}
          {(dashDrill?.items || []).length === 0 && <p className="text-sm text-surface-400 text-center py-6">No milestones match this filter</p>}
        </div>
      )}
      {dashDrill?.type === 'risks' && (
        <div className="space-y-2">
          {(dashDrill?.items || []).map(r => (
            <div key={r.id} className="p-4 rounded-xl border border-surface-100 bg-surface-50">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-surface-400">#{r.risk_number}</span>
                {r.impact && <Badge colors={PRIORITY_COLORS[r.impact] || PRIORITY_COLORS['Medium']}>Impact: {r.impact}</Badge>}
                {r.likelihood && <Badge colors={PRIORITY_COLORS[r.likelihood] || PRIORITY_COLORS['Medium']}>Likelihood: {r.likelihood}</Badge>}
              </div>
              <p className="text-sm text-surface-800 mb-1">{r.description}</p>
              {r.mitigation_action && <p className="text-xs text-surface-500">Mitigation: {r.mitigation_action}</p>}
              {r.owner && <p className="text-xs text-surface-400 mt-1">Owner: {r.owner}</p>}
            </div>
          ))}
          {(dashDrill?.items || []).length === 0 && <p className="text-sm text-surface-400 text-center py-6">No risks match this filter</p>}
        </div>
      )}
      {dashDrill?.type === 'hour_logs' && (
        <div className="space-y-2">
          {[...(dashDrill?.items || [])]
            .sort((a, b) => (a.log_date || '') < (b.log_date || '') ? 1 : -1)
            .map((l, i) => (
              <div key={i} className="p-4 rounded-xl border border-surface-100 bg-surface-50">
                <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-surface-400">{l.log_date}</span>
                    <span className="text-xs font-semibold bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">{parseFloat(l.hours_spent || 0)} h</span>
                  </div>
                </div>
                <p className="text-sm font-medium text-surface-800">{l.task_project || '—'}</p>
                {l.task_description && <p className="text-xs text-surface-500 mt-1">{l.task_description}</p>}
              </div>
            ))}
          {(dashDrill?.items || []).length === 0 && <p className="text-sm text-surface-400 text-center py-6">No task logs</p>}
        </div>
      )}
    </Modal>
  </div>
}

// ─── Milestone Form Modal ───────────────────────────────────
function MilestoneFormModal({ open, milestone, onClose, onSave }) {
  const [form, setForm] = useState({})
  useEffect(() => {
    if (milestone) setForm({ ...milestone })
    else setForm({ development_status: 'Not Started', uat_status: 'Not Started' })
  }, [milestone, open])
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const submit = () => { const { id, created_at, updated_at, project_id, milestone_number, ...data } = form; onSave(data) }

  return <Modal open={open} onClose={onClose} title={milestone ? 'Edit Milestone' : 'New Milestone'}>
    <div className="space-y-4">
      <FormField label="Key Deliverable *"><input className={inputCls} value={form.deliverable || ''} onChange={e => set('deliverable', e.target.value)} /></FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Estimated Start Date"><input className={inputCls} type="date" value={form.est_start_date || ''} onChange={e => set('est_start_date', e.target.value)} /></FormField>
        <FormField label="Actual Start Date"><input className={inputCls} type="date" value={form.actual_date || ''} onChange={e => set('actual_date', e.target.value)} /></FormField>
        <FormField label="Estimated End Date"><input className={inputCls} type="date" value={form.target_date || ''} onChange={e => set('target_date', e.target.value)} /></FormField>
        <FormField label="Actual End Date"><input className={inputCls} type="date" value={form.actual_end_date || ''} onChange={e => set('actual_end_date', e.target.value)} /></FormField>
      </div>
      <FormField label="Status"><select className={selectCls} value={form.development_status || ''} onChange={e => set('development_status', e.target.value)}>{DEV_STATUSES.map(s => <option key={s}>{s}</option>)}</select></FormField>
      <FormField label="Owner"><input className={inputCls} value={form.owner || ''} onChange={e => set('owner', e.target.value)} /></FormField>
      <FormField label="Dependencies"><textarea className={textareaCls} rows={2} value={form.dependencies || ''} onChange={e => set('dependencies', e.target.value)} /></FormField>
      <FormField label="Remarks"><textarea className={textareaCls} rows={2} value={form.remarks || ''} onChange={e => set('remarks', e.target.value)} /></FormField>
    </div>
    <div className="flex gap-3 justify-end mt-6 pt-4 border-t border-surface-200">
      <button onClick={onClose} className="px-4 py-2 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-50 font-medium text-sm">Cancel</button>
      <button onClick={submit} disabled={!form.deliverable} className="flex items-center gap-2 px-5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-medium text-sm disabled:opacity-40 transition-colors"><Save size={14} /> {milestone ? 'Update' : 'Create'}</button>
    </div>
  </Modal>
}

// ─── Risk Form Modal ────────────────────────────────────────
function RiskFormModal({ open, risk, onClose, onSave }) {
  const [form, setForm] = useState({})
  useEffect(() => {
    if (risk) setForm({ ...risk })
    else setForm({ impact: 'Medium', likelihood: 'Medium' })
  }, [risk, open])
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const submit = () => { const { id, created_at, updated_at, project_id, risk_number, ...data } = form; onSave(data) }

  return <Modal open={open} onClose={onClose} title={risk ? 'Edit Risk' : 'New Risk'}>
    <div className="space-y-4">
      <FormField label="Risk / Issue Description *"><textarea className={textareaCls} rows={3} value={form.description || ''} onChange={e => set('description', e.target.value)} /></FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Impact"><select className={selectCls} value={form.impact || ''} onChange={e => set('impact', e.target.value)}>{IMPACTS.map(i => <option key={i}>{i}</option>)}</select></FormField>
        <FormField label="Likelihood"><select className={selectCls} value={form.likelihood || ''} onChange={e => set('likelihood', e.target.value)}>{IMPACTS.map(i => <option key={i}>{i}</option>)}</select></FormField>
      </div>
      <FormField label="Mitigation Action"><textarea className={textareaCls} rows={2} value={form.mitigation_action || ''} onChange={e => set('mitigation_action', e.target.value)} /></FormField>
      <FormField label="Owner"><input className={inputCls} value={form.owner || ''} onChange={e => set('owner', e.target.value)} /></FormField>
    </div>
    <div className="flex gap-3 justify-end mt-6 pt-4 border-t border-surface-200">
      <button onClick={onClose} className="px-4 py-2 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-50 font-medium text-sm">Cancel</button>
      <button onClick={submit} disabled={!form.description} className="flex items-center gap-2 px-5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-medium text-sm disabled:opacity-40 transition-colors"><Save size={14} /> {risk ? 'Update' : 'Create'}</button>
    </div>
  </Modal>
}

// ─── Delay Reason Form Modal ────────────────────────────────
function DelayReasonFormModal({ open, delayReason, onClose, onSave }) {
  const [form, setForm] = useState({})
  useEffect(() => {
    if (delayReason) setForm({ ...delayReason })
    // Default the date to today on a fresh add so the admin doesn't
    // need to pick it most of the time.
    else setForm({ recorded_date: new Date().toISOString().slice(0, 10) })
  }, [delayReason, open])
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const submit = () => {
    const { id, created_at, updated_at, project_id, reason_number, ...data } = form
    onSave(data)
  }
  return <Modal open={open} onClose={onClose} title={delayReason ? 'Edit Delay Reason' : 'New Delay Reason'}>
    <div className="space-y-4">
      <FormField label="Date Recorded">
        <input className={inputCls} type="date" value={form.recorded_date || ''} onChange={e => set('recorded_date', e.target.value)} />
      </FormField>
      <FormField label="Reason *">
        <textarea className={textareaCls} rows={5} value={form.reason || ''} onChange={e => set('reason', e.target.value)} placeholder="What caused the delay?" />
      </FormField>
    </div>
    <div className="flex gap-3 justify-end mt-6 pt-4 border-t border-surface-200">
      <button onClick={onClose} className="px-4 py-2 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-50 font-medium text-sm">Cancel</button>
      <button onClick={submit} disabled={!form.reason} className="flex items-center gap-2 px-5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-medium text-sm disabled:opacity-40 transition-colors">
        <Save size={14} /> {delayReason ? 'Update' : 'Create'}
      </button>
    </div>
  </Modal>
}

// ─── GANTT CHART ────────────────────────────────────────────
function GanttChartPage() {
  const { projects, projectsLoading } = useProjects()
  const navigate = useNavigate()

  if (projectsLoading) return <Spinner />

  // YYYY-MM strings need different anchoring at each end of a bar:
  // start_date='2026-03' should mean "Mar 1" (bar starts at left edge of
  // March column); end_date='2026-03' should mean "Mar 31" (bar fills
  // the column). Using a single Mar-1 parser made every bar visually
  // end one column early.
  const parseStartDate = (d) => { if (!d) return null; if (d.length === 7) return new Date(d + '-01'); return new Date(d) }
  const parseEndDate = (d) => {
    if (!d) return null
    if (d.length === 7) {
      const [y, m] = d.split('-').map(Number)
      return new Date(y, m, 0) // day 0 of next month = last day of YYYY-MM
    }
    return new Date(d)
  }
  // Include est_start / est_end in the timeline span so the dashed
  // "planned" overlay isn't clipped when the estimate extends past
  // the actual range.
  const allDates = projects.flatMap(p => [
    parseStartDate(p.start_date),
    parseEndDate(p.end_date),
    parseStartDate(p.est_start),
    parseEndDate(p.est_end),
  ]).filter(Boolean)
  if (allDates.length === 0) return <EmptyState icon={GanttIcon} title="No date data" description="Projects need start/end dates for the Gantt chart." />

  const minDate = new Date(Math.min(...allDates.map(d => d.getTime())))
  const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())))
  minDate.setDate(1); maxDate.setMonth(maxDate.getMonth() + 1, 0)

  const months = []
  const curr = new Date(minDate)
  while (curr <= maxDate) { months.push(new Date(curr)); curr.setMonth(curr.getMonth() + 1) }

  const totalMs = maxDate.getTime() - minDate.getTime()
  const getPos = (date) => ((date.getTime() - minDate.getTime()) / totalMs) * 100
  const now = new Date()
  const todayPos = now >= minDate && now <= maxDate ? getPos(now) : null
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  const years = {}
  months.forEach(m => { const y = m.getFullYear(); if (!years[y]) years[y] = []; years[y].push(m) })

  return <div>
    <PageLogo />
    <div className="mb-6">
      <h1 className="page-title-gold text-2xl font-bold font-display text-surface-900">Gantt Chart</h1>
      <p className="text-sm text-surface-500 mt-1">Project timeline — auto-updates from project data · Click any row to view details</p>
    </div>
    <div className="flex flex-wrap gap-4 mb-4">
      {Object.entries(STATUS_COLORS).map(([name, c]) => (
        <div key={name} className="flex items-center gap-1.5 text-xs text-surface-600"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: c.hex }} /> {name}</div>
      ))}
      {todayPos !== null && <div className="flex items-center gap-1.5 text-xs text-surface-600"><div className="w-3 h-0.5 bg-red-500" /> Today</div>}
      <div className="flex items-center gap-1.5 text-xs text-surface-600"><div className="w-3 h-1 gantt-est-bar" /> Planned (est.)</div>
    </div>
    <div className="bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto"><div className="min-w-[1100px]">
        <div className="flex border-b border-surface-200">
          <div className="w-[320px] min-w-[320px] bg-surface-50 border-r border-surface-200 flex">
            <div className="w-10 px-2 py-2 text-[10px] font-semibold text-surface-400 flex items-end">#</div>
            <div className="flex-1 px-3 py-2 text-[10px] font-semibold text-surface-400 uppercase flex items-end">Project</div>
            <div className="w-20 px-2 py-2 text-[10px] font-semibold text-surface-400 uppercase flex items-end">Status</div>
            <div className="w-12 px-2 py-2 text-[10px] font-semibold text-surface-400 uppercase flex items-end text-right">Done</div>
          </div>
          <div className="flex-1 relative">
            <div className="flex border-b border-surface-100">
              {Object.entries(years).map(([year, ms]) => (
                <div key={year}
                  className={`text-center text-[10px] font-bold py-1 border-r border-surface-100 bg-surface-50 gantt-year-${Number(year) % 2 === 0 ? 'even' : 'odd'}`}
                  style={{ width: `${(ms.length / months.length) * 100}%` }}>
                  {year}
                </div>
              ))}
            </div>
            <div className="flex">
              {months.map((m, i) => (
                <div key={i}
                  className={`text-center text-[9px] py-1.5 border-r border-surface-100 gantt-month-cell gantt-month-${m.getFullYear() % 2 === 0 ? 'even' : 'odd'}`}
                  style={{ width: `${100 / months.length}%` }}>
                  {MONTH_NAMES[m.getMonth()]}
                </div>
              ))}
            </div>
          </div>
        </div>
        {projects.map(p => {
          const start = parseStartDate(p.start_date); const end = parseEndDate(p.end_date)
          if (!start || !end) return null
          const left = getPos(start); const right = getPos(end); const width = Math.max(right - left, 1)
          const pct = p.percent_complete === 'Ongoing' ? 50 : parseInt(p.percent_complete) || 0
          const color = STATUS_COLORS[p.status]?.hex || '#94a3b8'
          return <div key={p.id} className="flex border-b border-surface-50 hover:bg-surface-50/50 cursor-pointer transition-colors group" style={{ height: 36 }} onClick={() => navigate(`/projects/${p.id}`)}>
            <div className="w-[320px] min-w-[320px] border-r border-surface-100 flex items-center">
              <div className="w-10 px-2 text-[10px] font-mono text-surface-400">{p.project_number}</div>
              <div className="flex-1 px-2 text-xs font-medium text-surface-700 truncate group-hover:text-brand-600 transition-colors">{p.project_name}</div>
              <div className="w-20 px-1 flex items-center justify-center"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} /></div>
              <div className="w-12 px-2 text-[10px] text-surface-500 text-right font-mono">{p.percent_complete === 'Ongoing' ? '∞' : `${pct}%`}</div>
            </div>
            <div className="flex-1 relative">
              {months.map((_, i) => (<div key={i} className="absolute top-0 bottom-0 border-r border-surface-50" style={{ left: `${(i / months.length) * 100}%` }} />))}
              {todayPos !== null && <div className="absolute top-0 bottom-0 w-px bg-red-400 z-10" style={{ left: `${todayPos}%` }} />}
              {/* Estimated range — dashed champagne strip above the actual
                  bar. Only renders when BOTH est dates are set. */}
              {(() => {
                const eStart = parseStartDate(p.est_start)
                const eEnd = parseEndDate(p.est_end)
                if (!eStart || !eEnd) return null
                const eLeft = getPos(eStart)
                const eWidth = Math.max(getPos(eEnd) - eLeft, 1)
                return <div className="absolute gantt-est-bar" style={{ left: `${eLeft}%`, width: `${eWidth}%`, top: 4, height: 4 }}
                  title={`Planned: ${p.est_start || '?'} → ${p.est_end || '?'}`} />
              })()}
              <div className="absolute top-1/2 -translate-y-1/2 gantt-bar rounded-md overflow-hidden" style={{ left: `${left}%`, width: `${width}%`, height: 20 }}>
                <div className="absolute inset-0 rounded-md opacity-25" style={{ backgroundColor: color }} />
                <div className="absolute inset-y-0 left-0 rounded-md opacity-80" style={{ backgroundColor: color, width: `${pct}%` }} />
                <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold z-10"
                  style={{ color: pct > 40 ? '#fff' : '#1a202c', textShadow: pct > 40 ? '0 0 3px rgba(0,0,0,0.4)' : 'none' }}>
                  {p.percent_complete === 'Ongoing' ? '∞' : `${pct}%`}
                </span>
              </div>
            </div>
          </div>
        })}
      </div></div>
    </div>
  </div>
}

// ─── LOGIN PAGE ─────────────────────────────────────────────
function LoginPage() {
  const { signIn, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false)

  useEffect(() => { if (isAdmin) navigate('/dashboard') }, [isAdmin, navigate])

  const handleLogin = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try { await signIn(email, password); navigate('/dashboard') }
    catch (err) { setError(err.message || 'Invalid credentials') }
    setLoading(false)
  }

  return <div className="flex items-center justify-center min-h-[70vh]">
    <div className="w-full max-w-md">
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-brand-600 flex items-center justify-center mx-auto mb-4"><Shield className="text-white" size={24} /></div>
        <h1 className="text-2xl font-bold font-display text-surface-900">Admin Login</h1>
        <p className="text-sm text-surface-500 mt-1">Sign in to manage projects</p>
      </div>
      <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6">
        <form onSubmit={handleLogin} className="space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
          <FormField label="Email"><input id="login-email" name="email" className={inputCls} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@company.com" autoComplete="email" required /></FormField>
          <FormField label="Password"><input id="login-password" name="password" className={inputCls} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required /></FormField>
          <button type="submit" disabled={loading} className="w-full py-2.5 bg-brand-600 text-white rounded-xl font-medium text-sm hover:bg-brand-700 transition-colors disabled:opacity-50">{loading ? 'Signing in...' : 'Sign In'}</button>
        </form>
      </div>
    </div>
  </div>
}

// ─── ADMIN TEAM PAGE ────────────────────────────────────────
// Lets an admin choose which profiles appear on the landing page team
// section, set display order, mark one as team lead, edit job title + bio.
function AdminTeamPage() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)

  useEffect(() => { if (!isAdmin) navigate('/login') }, [isAdmin, navigate])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabasePublic
      .from('profiles')
      .select('id, full_name, email, role, job_title, bio, avatar_url, display_order, show_on_landing, is_team_lead')
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('full_name')
    setProfiles(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const updateProfile = async (id, patch) => {
    setSavingId(id)
    try {
      // If setting is_team_lead=true, clear it on all others first
      if (patch.is_team_lead === true) {
        const { error: clearErr } = await supabase.from('profiles').update({ is_team_lead: false }).neq('id', id)
        if (clearErr) throw clearErr
      }
      const { error } = await supabase.from('profiles').update(patch).eq('id', id)
      if (error) throw error
      setProfiles(ps => ps.map(p => p.id === id ? { ...p, ...patch, ...(patch.is_team_lead ? { } : {}) } : (patch.is_team_lead ? { ...p, is_team_lead: false } : p)))
      showToast('Profile updated', 'success')
    } catch (e) { showToast('Save failed: ' + (e.message || e), 'error') }
    finally { setSavingId(null) }
  }

  if (!isAdmin) return null
  if (loading) return <Spinner />

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold font-display text-surface-900">Landing Team</h1>
        <p className="text-sm text-surface-500 mt-1">Choose who appears in the team section on the landing page. Mark one member as lead — the rest show below.</p>
      </div>

      <div className="bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead><tr className="bg-surface-50 border-b border-surface-200 text-xs font-semibold text-surface-500 uppercase">
            <th className="px-4 py-3 text-left">Name</th>
            <th className="px-4 py-3 text-left">Job Title</th>
            <th className="px-4 py-3 text-center">Show on Landing</th>
            <th className="px-4 py-3 text-center">Lead</th>
            <th className="px-4 py-3 text-center">Order</th>
          </tr></thead>
          <tbody className="divide-y divide-surface-100">
            {profiles.map(p => (
              <tr key={p.id} className={savingId === p.id ? 'opacity-50' : ''}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {p.avatar_url
                      ? <img src={p.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                      : <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center"><User size={14} className="text-brand-600" /></div>}
                    <div>
                      <p className="text-sm font-medium text-surface-800">{p.full_name || '(no name)'}</p>
                      <p className="text-xs text-surface-400">{p.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <input
                    type="text"
                    defaultValue={p.job_title || ''}
                    placeholder="Job title"
                    onBlur={e => { if (e.target.value !== (p.job_title || '')) updateProfile(p.id, { job_title: e.target.value }) }}
                    className="w-full px-2 py-1 rounded border border-surface-200 text-sm bg-white focus:outline-none focus:border-brand-400"
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={!!p.show_on_landing}
                    onChange={e => updateProfile(p.id, { show_on_landing: e.target.checked })}
                    className="w-4 h-4 accent-brand-600"
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="radio"
                    name="team_lead"
                    checked={!!p.is_team_lead}
                    onChange={() => updateProfile(p.id, { is_team_lead: true })}
                    className="w-4 h-4 accent-brand-600"
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="number"
                    defaultValue={p.display_order ?? ''}
                    onBlur={e => {
                      const v = e.target.value === '' ? null : parseInt(e.target.value, 10)
                      if (v !== p.display_order) updateProfile(p.id, { display_order: v })
                    }}
                    className="w-16 px-2 py-1 rounded border border-surface-200 text-sm text-center"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-surface-400 mt-4">
        Photos are uploaded inline from the landing page itself (hover on any photo).
      </p>
    </div>
  )
}

// ─── ADMIN USERS PAGE ───────────────────────────────────────
function AdminUsersPage() {
  const { isAdmin, user } = useAuth()
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newFullName, setNewFullName] = useState('')
  const [newRole, setNewRole] = useState('user')
  const [message, setMessage] = useState(''); const [error, setError] = useState('')
  const [resetTarget, setResetTarget] = useState('')

  useEffect(() => { if (!isAdmin) navigate('/login') }, [isAdmin, navigate])

  const handleCreateUser = async () => {
    setError(''); setMessage('')
    if (!newFullName.trim()) { setError('Full name is required'); return }
    try {
      const { data, error: err } = await supabase.auth.signUp({
        email: newEmail,
        password: newPassword,
        options: { data: { full_name: newFullName, role: newRole } }
      })
      if (err) throw err
      // Upsert profile with role (trigger may have already created it)
      if (data?.user?.id) {
        await supabase.from('profiles').upsert({
          id: data.user.id,
          full_name: newFullName,
          email: newEmail,
          role: newRole,
          username: newEmail.split('@')[0]
        })
      }
      setMessage(`User ${newEmail} created as ${newRole}!`)
      setNewEmail(''); setNewPassword(''); setNewFullName(''); setNewRole('user')
      setShowCreate(false)
    } catch (err) { setError(err.message) }
  }

  const handleResetPassword = async () => {
    setError(''); setMessage('')
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(resetTarget)
      if (err) throw err
      setMessage(`Password reset email sent to ${resetTarget}`); setResetTarget('')
    } catch (err) { setError(err.message) }
  }

  if (!isAdmin) return null

  return <div className="max-w-2xl mx-auto">
    <div className="mb-8"><h1 className="text-2xl font-bold font-display text-surface-900">User Management</h1><p className="text-sm text-surface-500 mt-1">Create users for both the Project Website and EBS Tracker</p></div>
    {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg px-4 py-3 mb-4">{message}</div>}
    {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>}

    <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6 mb-6">
      <h3 className="text-sm font-semibold text-surface-700 mb-3">Current Session</h3>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center"><Shield className="text-brand-600" size={18} /></div>
        <div><p className="text-sm font-medium text-surface-800">{user?.email}</p><p className="text-xs text-surface-500">Logged in as admin</p></div>
      </div>
    </div>

    <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-surface-700">Create New User</h3>
          <p className="text-xs text-surface-500 mt-0.5">Admin users can edit projects and access EBS Tracker Admin Panel. Regular users can only view projects and log tasks in EBS Tracker.</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-medium hover:bg-brand-700 transition-colors"><Plus size={13} /> New User</button>
      </div>
      {showCreate && (
        <div className="space-y-4 pt-4 border-t border-surface-100">
          <FormField label="Full Name *"><input id="new-full-name" name="full_name" className={inputCls} type="text" value={newFullName} onChange={e => setNewFullName(e.target.value)} placeholder="Jane Smith" autoComplete="off" /></FormField>
          <FormField label="Email"><input id="new-email" name="new_email" className={inputCls} type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="user@company.com" autoComplete="off" /></FormField>
          <FormField label="Password"><input id="new-password" name="new_password" className={inputCls} type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 6 characters" autoComplete="new-password" /></FormField>
          <FormField label="Role">
            <select className={inputCls} value={newRole} onChange={e => setNewRole(e.target.value)}>
              <option value="user">User — view projects + log EBS tasks</option>
              <option value="admin">Admin — full access to everything</option>
            </select>
          </FormField>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-50 font-medium text-sm">Cancel</button>
            <button onClick={handleCreateUser} disabled={!newEmail || !newPassword || newPassword.length < 6 || !newFullName} className="px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-medium text-sm disabled:opacity-40 transition-colors">Create User</button>
          </div>
        </div>
      )}
    </div>

    <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-6 mb-6">
      <h3 className="text-sm font-semibold text-surface-700 mb-4">Reset User Password</h3>
      <p className="text-sm text-surface-500 mb-4">Enter the email address of the user. They will receive a reset link.</p>
      <div className="flex gap-3">
        <input id="reset-email" name="reset_email" className={`${inputCls} flex-1`} type="email" value={resetTarget} onChange={e => setResetTarget(e.target.value)} placeholder="user@company.com" autoComplete="off" />
        <button onClick={handleResetPassword} disabled={!resetTarget} className="px-4 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 font-medium text-sm disabled:opacity-40 transition-colors whitespace-nowrap">Send Reset Link</button>
      </div>
    </div>
  </div>
}

// ─── MAIN APP ───────────────────────────────────────────────
// ─── Auth gate — shows full-page spinner until session is known ──
export default function App() {
  // No more loading gate — render immediately. Login page handles unauthed users,
  // other pages handle their own loading states. No single point of failure.
  return (
    <AuthProvider>
      <ProjectsProvider>
        <Layout />
      </ProjectsProvider>
    </AuthProvider>
  )
}
