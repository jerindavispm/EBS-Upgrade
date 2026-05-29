import React, { Fragment, useEffect, useState, useCallback, useRef, useLayoutEffect, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown, ChevronUp, ArrowRight, Users, User,
  Sparkles, Target, Mail, Rocket, Sun, Moon,
} from 'lucide-react'
import { supabase, supabasePublic } from '../supabaseClient'
import { EditableText, EditableImage } from './Editable'
import { useInView } from '../hooks/useInView'

const ParticleNetwork = React.lazy(() => import('./ParticleNetwork'))
const BusinessCard    = React.lazy(() => import('./BusinessCard'))

// Scroll-reveal wrapper — fades + slides up when scrolled into view.
// Stagger lists by passing increasing `delay` (ms).
function Reveal({ delay = 0, as: Tag = 'div', className = '', children, ...rest }) {
  const [ref, inView] = useInView()
  return (
    <Tag
      ref={ref}
      className={`transition-all duration-[700ms] ease-out will-change-transform ${
        inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  )
}

// Scroll progress 0→1 as the target element travels through the viewport.
// By default progress hits 1 when the element's CENTER reaches the viewport
// CENTER — so animations finish exactly when the block looks "settled" in
// the middle of the screen, not before. Pass { completeAtCenter: false } +
// endVhFraction to lock the completion line to a fixed viewport offset
// instead. Returns [refCallback, progress] — pass refCallback to the JSX
// element's ref prop. Using a callback ref (not a useRef object) is
// critical: the effect re-runs when the element actually attaches, which
// can happen AFTER the first render if the host component returns early
// during data loading.
function useScrollProgress(options = {}) {
  const {
    startVhFraction = 0.95,
    endVhFraction = 0.2,
    completeAtCenter = true,
  } = options
  const [el, setEl] = useState(null)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    if (!el) return
    let rafId = null
    const compute = () => {
      rafId = null
      const rect = el.getBoundingClientRect()
      const vh = window.innerHeight
      // Progress 0 marker — element top crossing this viewport y starts the animation.
      const start = vh * startVhFraction
      // Progress 1 marker — where the element top must be for the element to be
      // vertically centered in the viewport. Falls back to a fixed offset when
      // completeAtCenter is disabled.
      const end = completeAtCenter
        ? (vh / 2) - (rect.height / 2)
        : vh * endVhFraction
      const range = Math.max(1, start - end)
      const traveled = start - rect.top
      const p = Math.max(0, Math.min(1, traveled / range))
      setProgress(p)
    }
    const onScroll = () => {
      if (rafId) return
      rafId = requestAnimationFrame(compute)
    }
    compute()
    // App's actual scroll container is #main-scroll; fall back to window otherwise.
    const scroller = document.getElementById('main-scroll') || window
    scroller.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [el, startVhFraction, endVhFraction, completeAtCenter])
  return [setEl, progress]
}

// Vertical adaptation of the "limelight" navigation pattern. A gold bar
// slides vertically along the dock's left edge, with a trapezoid glow
// projecting leftward toward the active section. Active index is driven
// by the parent (typically from an IntersectionObserver elsewhere).
function VerticalLimelightNav({ items, activeIndex, onChange, className = '' }) {
  const itemRefs = useRef([])
  const limelightRef = useRef(null)
  const [isReady, setIsReady] = useState(false)

  useLayoutEffect(() => {
    if (items.length === 0) return
    const limelight = limelightRef.current
    const activeItem = itemRefs.current[activeIndex]
    if (limelight && activeItem) {
      const newTop = activeItem.offsetTop + activeItem.offsetHeight / 2 - limelight.offsetHeight / 2
      limelight.style.top = `${newTop}px`
      if (!isReady) setTimeout(() => setIsReady(true), 50)
    }
  }, [activeIndex, isReady, items])

  if (items.length === 0) return null

  return (
    <nav className={`relative inline-flex flex-col items-stretch py-1 ${className}`}>
      {items.map((item, index) => {
        const { id, icon, label, onClick } = item
        const isActive = activeIndex === index
        return (
          <a
            key={id}
            ref={el => (itemRefs.current[index] = el)}
            className="relative z-20 flex flex-col items-center justify-center cursor-pointer px-4 py-3"
            onClick={() => { onChange?.(index, item); onClick?.() }}
            aria-label={label}
          >
            {React.cloneElement(icon, {
              size: 18,
              className: `transition-opacity duration-200 ${isActive ? 'opacity-100' : 'opacity-50'}`,
              style: { color: isActive ? '#f5e6c2' : 'rgba(245,230,194,0.55)' },
            })}
            {label && (
              <span
                className={`mt-1 text-[9px] tracking-[0.18em] uppercase transition-opacity duration-200 ${
                  isActive ? 'opacity-100' : 'opacity-55'
                }`}
                style={{ color: isActive ? '#f5e6c2' : 'rgba(245,230,194,0.55)' }}
              >
                {label}
              </span>
            )}
          </a>
        )
      })}

      {/* Limelight bar — vertical, on the LEFT edge of the dock so its
          cone glow projects RIGHT, lighting the active item from left→right
          through the dock interior. */}
      <div
        ref={limelightRef}
        className={`absolute left-0 z-10 w-[5px] h-11 rounded-full ${
          isReady ? 'transition-[top] duration-400 ease-in-out' : ''
        }`}
        style={{
          top: '-999px',
          background: 'linear-gradient(180deg, #f5e6c2, #e6cf94, #caa15a)',
          boxShadow: '18px 0 36px 6px rgba(229,207,148,0.45)',
        }}
      >
        {/* Cone glow projecting RIGHT into the dock interior */}
        <div
          className="absolute left-[5px] top-[-30%] w-14 h-[160%] pointer-events-none"
          style={{
            clipPath: 'polygon(0% 25%, 0% 75%, 100% 95%, 100% 5%)',
            background: 'linear-gradient(to right, rgba(229,207,148,0.40), transparent)',
          }}
        />
      </div>
    </nav>
  )
}

// Floating right-edge dock — uses VerticalLimelightNav for the 3 in-page
// anchors and a separate theme-toggle button below a gold divider. Hidden
// until the hero is scrolled past.
function FloatingSideDock({ isDark, onToggleTheme, scrollToSection, onOpenContact }) {
  const [visible, setVisible] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  // Prevents the IntersectionObserver from bouncing the limelight through
  // intermediate sections while a click-triggered smooth-scroll is in flight.
  const scrollLockRef = useRef(false)
  const scrollLockTimer = useRef(null)
  const [toggleSpin, setToggleSpin] = useState(0)

  // Show after hero is mostly scrolled out of view
  useEffect(() => {
    const scroller = document.getElementById('main-scroll') || window
    let rafId = null
    const compute = () => {
      rafId = null
      const heroEl = document.querySelector('section[data-hero]') || document.querySelector('section')
      if (!heroEl) return
      const rect = heroEl.getBoundingClientRect()
      setVisible(rect.bottom < window.innerHeight * 0.3)
    }
    const onScroll = () => { if (!rafId) rafId = requestAnimationFrame(compute) }
    compute()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [])

  // Auto-update active index based on which section is in view.
  // Guarded by scrollLockRef so a click-triggered smooth-scroll doesn't
  // briefly snap the limelight to every section it passes through.
  useEffect(() => {
    const sectionIds = ['about', 'moonshot', 'vision', 'team']
    const observers = []
    sectionIds.forEach((id, i) => {
      const el = document.getElementById(id)
      if (!el) return
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (scrollLockRef.current) return
          if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
            setActiveIndex(i)
          }
        },
        { threshold: [0.35, 0.6, 0.85], root: document.getElementById('main-scroll') }
      )
      observer.observe(el)
      observers.push(observer)
    })
    return () => observers.forEach(o => o.disconnect())
  }, [])

  // Click-to-scroll with lock: instantly set active, lock for ~1100ms while
  // the smooth-scroll lands so the limelight doesn't pinball through other
  // sections during transit. Uses the shared `scrollToSection` helper which
  // centers the target section in the viewport — the same position where
  // the section's scroll-linked animations reach completion.
  const handleNavClick = (id, index) => {
    setActiveIndex(index)
    scrollLockRef.current = true
    if (scrollLockTimer.current) clearTimeout(scrollLockTimer.current)
    scrollLockTimer.current = setTimeout(() => { scrollLockRef.current = false }, 1100)
    scrollToSection?.(id)
  }

  const handleToggleTheme = () => {
    setToggleSpin(n => n + 1)
    onToggleTheme()
  }

  const navItems = [
    { id: 'about',    label: 'About',    icon: <Sparkles />, onClick: () => handleNavClick('about',    0) },
    { id: 'moonshot', label: 'Moonshot', icon: <Rocket />,   onClick: () => handleNavClick('moonshot', 1) },
    { id: 'vision',   label: 'Vision',   icon: <Target />,   onClick: () => handleNavClick('vision',   2) },
    { id: 'team',     label: 'Team',     icon: <Users />,    onClick: () => handleNavClick('team',     3) },
  ]

  return (
    <div
      aria-hidden={!visible}
      className={`hidden md:flex fixed right-4 top-1/2 -translate-y-1/2 z-40 transition-all duration-500 ease-out ${
        visible
          ? 'opacity-100 translate-x-0 pointer-events-auto'
          : 'opacity-0 translate-x-6 pointer-events-none'
      }`}
    >
      <div className="luxe-dock">
        <VerticalLimelightNav
          items={navItems}
          activeIndex={activeIndex}
          onChange={(i) => setActiveIndex(i)}
        />
        <div className="luxe-dock-divider" />
        {/* Contact entry — opens the business card modal */}
        <button
          type="button"
          onClick={onOpenContact}
          className="luxe-dock-item"
          aria-label="Open contact card"
        >
          <Mail size={16} style={{ color: 'rgba(245,230,194,0.7)' }} />
          <span className="luxe-dock-label">Contact</span>
        </button>
        <div className="luxe-dock-divider" />
        <button
          type="button"
          onClick={handleToggleTheme}
          className="luxe-dock-item"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {/* key forces React to remount the wrapper each click → CSS animation re-plays */}
          <span key={toggleSpin} className="luxe-toggle-icon-spin">
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </span>
          <span className="luxe-dock-label">{isDark ? 'Light' : 'Dark'}</span>
        </button>
      </div>
    </div>
  )
}

// Scroll-LINKED word reveal — the words are tied to scroll position.
// Stop scrolling → animation pauses. Scroll back up → words disappear
// in reverse (last word goes first). `overlap` controls how many words'
// reveal windows overlap (higher = smoother, more words fading at once).
function WordScrollReveal({ text, className = '', as: Tag = 'p', overlap = 3 }) {
  const [setRef, progress] = useScrollProgress()
  const tokens = (text || '').split(/(\s+)/)
  const totalWords = tokens.reduce((n, t) => n + (/^\s+$/.test(t) ? 0 : 1), 0)
  // Scale word windows so the LAST word's window ends exactly at progress=1.
  // Range = totalWords + overlap - 1; word i is fully revealed when progress
  // reaches (i + overlap) / range. Without this scaling, the last `overlap-1`
  // words never reach 100% opacity since their windows extend past 1.
  const range = Math.max(1, totalWords + overlap - 1)
  const fadeWidth = overlap / range
  let wordIdx = 0
  return (
    <Tag ref={setRef} className={className} data-scroll-anchor>
      {tokens.map((tok, i) => {
        if (/^\s+$/.test(tok)) return <Fragment key={i}>{tok}</Fragment>
        const wordStart = wordIdx / range
        const local = Math.max(0, Math.min(1, (progress - wordStart) / fadeWidth))
        wordIdx += 1
        return (
          <span
            key={i}
            className="inline-block transition-[opacity,transform] duration-150 ease-out will-change-transform"
            style={{
              opacity: local,
              transform: `translateY(${(1 - local) * 8}px)`,
            }}
          >
            {tok}
          </span>
        )
      })}
    </Tag>
  )
}

// ---- Data loaders ----------------------------------------------------------
async function fetchLandingContent() {
  const { data, error } = await supabasePublic
    .from('landing_page_content')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  return data
}

async function fetchTeamMembers() {
  const { data, error } = await supabasePublic
    .from('profiles')
    .select('id, full_name, job_title, bio, avatar_url, display_order, is_team_lead, employee_roles')
    .eq('show_on_landing', true)
    .order('display_order', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data || []
}

// ---- Achievements tile -----------------------------------------------------
function AchievementTile({ item, index, isAdmin, onSave, sectionProgress = null, slot = null }) {
  const update = async (field, newValue) => {
    // Parent tracks the full achievements array; we update via lift-up.
    await onSave({ ...item, [field]: newValue }, index)
  }

  // Scroll-linked fade + blur for visitor view. Admin always sees the fully-rendered tile.
  const animate = !isAdmin && sectionProgress !== null && slot !== null
  let opacity = 1, blurPx = 0
  if (animate) {
    const tileProg = Math.max(0, Math.min(1, (sectionProgress - slot.start) / (slot.end - slot.start)))
    // Fade in (0 – 0.25) then blur clears (0.15 – 0.75). Overlap for a smooth single-motion feel.
    opacity = Math.max(0, Math.min(1, tileProg / 0.25))
    const focusProg = Math.max(0, Math.min(1, (tileProg - 0.15) / 0.6))
    blurPx = (1 - focusProg) * 14
  }

  return (
    <div
      className="luxe-card luxe-card-hover p-6 text-center"
      style={animate ? {
        opacity,
        filter: `blur(${blurPx}px)`,
        transition: 'opacity 200ms ease-out, filter 200ms ease-out',
      } : undefined}
    >
      <div className="text-4xl mb-2">{item.icon || '⭐'}</div>
      <EditableText
        value={item.value}
        isAdmin={isAdmin}
        onSave={v => update('value', v)}
        className="text-3xl font-bold luxe-heading"
        as="div"
      />
      <EditableText
        value={item.label}
        isAdmin={isAdmin}
        onSave={v => update('label', v)}
        className="text-sm luxe-muted mt-1"
        as="div"
      />
    </div>
  )
}

// Moonshot tile row — owns a single scroll progress (0..1 across the grid's
// passage through the viewport) and slices it into 3 overlapping slots, one
// per tile. Each tile uses its slot to drive its fade → unblur → typewriter.
function MoonshotGrid({ achievements, isAdmin, onSave }) {
  const [setGridRef, sectionProgress] = useScrollProgress({ startVhFraction: 0.95, endVhFraction: 0.2 })
  const ICON_BY_INDEX = ['', '🛒', '🛡️']
  const SLOTS = [
    { start: 0.00, end: 0.55 },
    { start: 0.22, end: 0.78 },
    { start: 0.45, end: 1.00 },
  ]
  return (
    <div ref={setGridRef} data-scroll-anchor className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {achievements.map((a, i) => {
        const item = ICON_BY_INDEX[i] ? { ...a, icon: ICON_BY_INDEX[i] } : a
        return (
          <AchievementTile
            key={i}
            item={item}
            index={i}
            isAdmin={isAdmin}
            onSave={onSave}
            sectionProgress={sectionProgress}
            slot={SLOTS[i] || { start: 0, end: 1 }}
          />
        )
      })}
    </div>
  )
}

// ---- Team card -------------------------------------------------------------
function TeamCard({ member, lead = false, isAdmin, onMemberChange, mode = null, sectionProgress = null, slot = null }) {
  // Compact sizes — lead still ~40% larger than members but the whole tree
  // is shrunk so the avatars' image resolution doesn't read as soft.
  const sizeClasses = lead
    ? 'w-32 h-32 sm:w-40 sm:h-40'   // 128 / 160
    : 'w-24 h-24 sm:w-28 sm:h-28'   // 96 / 112

  const saveField = async (field, value) => {
    const { error } = await supabase.from('profiles').update({ [field]: value }).eq('id', member.id)
    if (error) throw error
    onMemberChange({ ...member, [field]: value })
  }

  // Per-card scroll progress for either mode.
  const animate = !isAdmin && mode && sectionProgress !== null && slot !== null
  const cardProg = animate ? Math.max(0, Math.min(1, (sectionProgress - slot.start) / (slot.end - slot.start))) : 1

  let containerStyle, avatarStyle, nameStyle, titleStyle

  if (animate && mode === 'tree') {
    // Whole card fades + slides up as a unit (org-chart branch tip).
    containerStyle = {
      opacity: cardProg,
      transform: `translateY(${(1 - cardProg) * 18}px)`,
      transition: 'opacity 200ms ease-out, transform 200ms ease-out',
    }
  } else if (animate && mode === 'inflate') {
    // Per-piece sequential phases tied to scroll.
    // Phase 1 (0–0.4): avatar scales 0 → 1 + fades in
    // Phase 2 (0.3–0.6): name slides up + fades
    // Phase 3 (0.5–0.8): title fades in
    const avatarProg = Math.max(0, Math.min(1, cardProg / 0.4))
    const nameProg   = Math.max(0, Math.min(1, (cardProg - 0.3) / 0.3))
    const titleProg  = Math.max(0, Math.min(1, (cardProg - 0.5) / 0.3))
    avatarStyle = {
      transform: `scale(${avatarProg})`,
      opacity: avatarProg,
      transition: 'transform 200ms cubic-bezier(.34,1.56,.64,1), opacity 200ms ease-out',
      transformOrigin: 'center',
    }
    nameStyle = {
      opacity: nameProg,
      transform: `translateY(${(1 - nameProg) * 8}px)`,
      transition: 'opacity 200ms ease-out, transform 200ms ease-out',
    }
    titleStyle = {
      opacity: titleProg,
      transition: 'opacity 200ms ease-out',
    }
  }

  // Shared face styling — front and back of the flip card use IDENTICAL outer
  // box (same dimensions, ring, shadow, gradient bg) so the flip is just a
  // content swap, not a size change.
  const faceClass = `absolute inset-0 rounded-2xl overflow-hidden bg-gradient-to-br from-[#3a2e1a] to-[#1a1208] ring-2 ring-[rgba(212,184,123,0.25)] shadow-[0_8px_32px_-8px_rgba(212,184,123,0.4)] transition-shadow duration-300 group-hover:shadow-[0_12px_40px_-8px_rgba(229,207,148,0.55)]`
  const frontAvatarClass = `${faceClass} flex items-center justify-center`

  return (
    <div className="relative flex flex-col items-center text-center group" style={containerStyle}>
      {isAdmin ? (
        /* Admin: simple avatar with pencil-edit affordance + inline bio below */
        <div style={avatarStyle}>
          <EditableImage
            src={member.avatar_url}
            alt={member.full_name}
            isAdmin={isAdmin}
            supabase={supabase}
            bucket="team-photos"
            pathPrefix={`${member.id}/`}
            onSave={url => saveField('avatar_url', url)}
            className={`${sizeClasses} rounded-2xl overflow-hidden bg-gradient-to-br from-[#3a2e1a] to-[#1a1208] ring-2 ring-[rgba(212,184,123,0.25)] shadow-[0_8px_32px_-8px_rgba(212,184,123,0.4)] flex items-center justify-center`}
            imgClassName="w-full h-full object-cover"
            fallback={<User className="text-[#caa15a]" size={lead ? 56 : 40} />}
          />
        </div>
      ) : (
        /* Visitor: 3D flip card. Front = avatar, Back = glass bio block. */
        <div style={{ ...avatarStyle, perspective: '1200px' }}>
          <div
            className={`${sizeClasses} relative transition-transform duration-700 ease-out group-hover:[transform:rotateY(180deg)]`}
            style={{ transformStyle: 'preserve-3d' }}
          >
            {/* Front face — avatar photo */}
            <div className={frontAvatarClass} style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
              {member.avatar_url ? (
                <img src={member.avatar_url} alt={member.full_name} className="w-full h-full object-cover" />
              ) : (
                <User className="text-[#caa15a]" size={lead ? 56 : 40} />
              )}
            </div>
            {/* Back face — same outer box as the front, content inside */}
            <div
              className={faceClass}
              style={{
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
              }}
            >
              <div className="absolute inset-0 p-3 text-center flex flex-col justify-center items-center overflow-hidden">
                {Array.isArray(member.employee_roles) && member.employee_roles.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-1 mb-2">
                    {member.employee_roles.map((r, i) => (
                      <span
                        key={i}
                        className="inline-block px-1.5 py-[1px] rounded-full text-[8px] font-semibold tracking-wide"
                        style={{
                          background: 'rgba(212,184,123,0.10)',
                          color: '#e6cf94',
                          border: '1px solid rgba(212,184,123,0.28)',
                        }}
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                )}
                <p className={`luxe-body leading-snug ${lead ? 'text-[11px]' : 'text-[9px]'}`}>
                  {member.bio || ''}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 max-w-[160px]">
        <div style={nameStyle}>
          <EditableText
            value={member.full_name}
            isAdmin={isAdmin}
            onSave={v => saveField('full_name', v)}
            className={lead ? 'text-lg font-display luxe-heading' : 'text-sm font-semibold text-[#fff8e7]'}
            as="div"
            placeholder="Name"
          />
        </div>
        <div style={titleStyle}>
          <EditableText
            value={member.job_title}
            isAdmin={isAdmin}
            onSave={v => saveField('job_title', v)}
            className={lead ? 'text-sm luxe-accent font-medium mt-1' : 'text-xs luxe-accent mt-0.5'}
            as="div"
            placeholder="Job title"
          />
        </div>
      </div>

      {/* Admin: inline bio editor below the card */}
      {isAdmin && (
        <div className="mt-3 max-w-xs w-full">
          <div className="luxe-card p-4 text-left">
            {Array.isArray(member.employee_roles) && member.employee_roles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {member.employee_roles.map((r, i) => (
                  <span
                    key={i}
                    className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide"
                    style={{
                      background: 'rgba(212,184,123,0.08)',
                      color: '#e6cf94',
                      border: '1px solid rgba(212,184,123,0.25)',
                    }}
                  >
                    {r}
                  </span>
                ))}
              </div>
            )}
            <EditableText
              value={member.bio}
              isAdmin={isAdmin}
              multiline
              onSave={v => saveField('bio', v)}
              className="text-xs luxe-body leading-relaxed"
              as="p"
              placeholder="No bio yet — admin can add one."
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Main component --------------------------------------------------------
export default function LandingPage({ isAdmin }) {
  const navigate = useNavigate()
  const [content, setContent] = useState(null)
  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(true)
  // Range = 0.95 viewport heights. Tight enough that the user can physically
  // scroll far enough to reach progress=1 (the Team section is followed only
  // by a small footer, so max-scroll only allows about one viewport of travel
  // past the section entering view).
  const [setTeamGridRef, teamProgress] = useScrollProgress({ startVhFraction: 1.0, endVhFraction: 0.05 })
  // Theme state for the floating dock toggle. Flipping it adds a class on the
  // landing root which serves as a hook for any light-mode CSS overrides.
  const [lightMode, setLightMode] = useState(false)
  // Business card modal open state. Triggered from the floating dock entry
  // and the top hero nav strip; card content is pulled from the team lead.
  const [cardOpen, setCardOpen] = useState(false)

  // Click-navigation (floating dock + limelight nav): scroll so the target's
  // vertical CENTER lands at the viewport's vertical CENTER. Crucially we
  // center the SECTION'S INNER ANIMATED BLOCK (marked with [data-scroll-anchor])
  // when one exists — not the whole section. The scroll-linked animations are
  // tied to the inner block, so centering anything else leaves the animation
  // at partial progress.
  //
  // CLAMP: never scroll so far that the section's TOP (its heading) goes
  // above the viewport top. For tall sections (e.g. Team — grid + heading is
  // taller than viewport), centering the grid alone would push the heading
  // off-screen, so we clamp the scroll target so the section header stays
  // visible just below the viewport top. Animation progress still reaches 1
  // in this case because the inner block has already crossed its completion
  // line by the time the section header is at the top.
  const SECTION_TOP_MARGIN = 24  // px the section top sits below viewport top when clamped
  // Per-section additional downward scroll offset (px). Positive = scroll
  // FURTHER down (less of the upper edge visible) on click-nav. ~76 px ≈ 2 cm
  // at 96 dpi. Used to fine-tune which row of a tall section lands in view.
  const SECTION_EXTRA_DOWN = { team: 76 }
  const scrollToSectionWithCompletion = useCallback((id) => {
    const section = document.getElementById(id)
    if (!section) return
    const target = section.querySelector('[data-scroll-anchor]') || section
    const extra = SECTION_EXTRA_DOWN[id] || 0
    const scroller = document.getElementById('main-scroll')
    if (scroller) {
      const scrollerRect = scroller.getBoundingClientRect()
      const tRect = target.getBoundingClientRect()
      const sRect = section.getBoundingClientRect()
      const tTopInContent = tRect.top - scrollerRect.top + scroller.scrollTop
      const sTopInContent = sRect.top - scrollerRect.top + scroller.scrollTop
      const centeredScroll = tTopInContent + tRect.height / 2 - scroller.clientHeight / 2
      const top = Math.min(centeredScroll, sTopInContent - SECTION_TOP_MARGIN) + extra
      scroller.scrollTo({ top, behavior: 'smooth' })
    } else {
      const tRect = target.getBoundingClientRect()
      const sRect = section.getBoundingClientRect()
      const tTopInDoc = tRect.top + window.scrollY
      const sTopInDoc = sRect.top + window.scrollY
      const centeredScroll = tTopInDoc + tRect.height / 2 - window.innerHeight / 2
      const top = Math.min(centeredScroll, sTopInDoc - SECTION_TOP_MARGIN) + extra
      window.scrollTo({ top, behavior: 'smooth' })
    }
  }, [])
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [c, t] = await Promise.all([fetchLandingContent(), fetchTeamMembers()])
      setContent(c)
      setTeam(t)
    } catch (e) {
      console.error('Landing fetch error:', e)
      setError(e.message || 'Failed to load landing content')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Save a single landing_page_content field
  const saveContent = async (field, value) => {
    const { error: uErr } = await supabase
      .from('landing_page_content')
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq('id', 1)
    if (uErr) throw uErr
    setContent(c => ({ ...c, [field]: value }))
  }

  // Save one achievement in the JSONB array
  const saveAchievement = async (updated, index) => {
    const next = [...(content.achievements || [])]
    next[index] = updated
    await saveContent('achievements', next)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !content) {
    return (
      <div className="max-w-xl mx-auto mt-20 text-center">
        <p className="text-red-600 mb-4">Failed to load landing content.</p>
        <p className="text-sm text-surface-500 mb-4">{error}</p>
        <button onClick={load} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium">
          Retry
        </button>
      </div>
    )
  }

  const lead = team.find(m => m.is_team_lead)
  const members = team.filter(m => !m.is_team_lead)

  return (
    <div className={`overflow-x-clip ${lightMode ? 'landing-light' : ''}`}>
    <FloatingSideDock
      isDark={!lightMode}
      onToggleTheme={() => setLightMode(v => !v)}
      scrollToSection={scrollToSectionWithCompletion}
      onOpenContact={() => setCardOpen(true)}
    />
    <Suspense fallback={null}>
      <BusinessCard
        open={cardOpen}
        onClose={() => setCardOpen(false)}
        lead={team.find(m => m.is_team_lead)}
      />
    </Suspense>
    <div className="-m-4 sm:-m-6 lg:-m-8">
      {/* ─── Hero ────────────────────────────────────────────── */}
      <section
        data-hero
        className="relative overflow-hidden text-white"
        style={{
          background: `
            radial-gradient(ellipse 80% 60% at 50% 30%, rgba(212,184,123,0.18), transparent 65%),
            radial-gradient(ellipse 90% 80% at 50% 110%, rgba(138,99,40,0.15), transparent 60%),
            linear-gradient(180deg, #0c0a08 0%, #08070a 100%)
          `,
        }}
      >
        {/* Top nav — three in-page anchors. Pinned at z-50 with a soft
            gradient backdrop so it always reads above the particle
            animation and ambient light pools below. Offset down from the
            hero's top edge so the wrapper's negative margins + any
            iOS safe-area inset don't push it off-screen. */}
        <nav
          className="absolute left-0 right-0 z-50 flex items-center justify-center gap-6 sm:gap-10 py-4 px-6 pointer-events-none"
          style={{
            top: 'max(2.5rem, calc(env(safe-area-inset-top) + 1.5rem))',
            background:
              'linear-gradient(180deg, rgba(12,10,8,0.78) 0%, rgba(12,10,8,0.35) 60%, rgba(12,10,8,0) 100%)',
            borderRadius: '0 0 18px 18px',
          }}
        >
          {/* Etched gold thread along the bottom edge — matches the section rim threads */}
          <div className="luxe-rim-bottom" />
          {[
            { id: 'about',    label: 'About Us' },
            { id: 'moonshot', label: 'Moonshot Projects' },
            { id: 'vision',   label: 'Our Vision' },
            { id: 'team',     label: 'Our Team' },
            { id: 'contact',  label: 'Contact', isContact: true },
          ].map((item, i) => (
            <Fragment key={item.id}>
              {i > 0 && <span className="luxe-nav-dot pointer-events-none" aria-hidden="true" />}
              <button
                type="button"
                onClick={() => item.isContact ? setCardOpen(true) : scrollToSectionWithCompletion(item.id)}
                className="pointer-events-auto text-[10px] sm:text-xs luxe-nav-item"
              >
                {item.label}
              </button>
            </Fragment>
          ))}
        </nav>

        {/* Ambient light pools — stronger gold glows for a richer luxe feel */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute -top-24 -left-24 w-[640px] h-[640px] rounded-full blur-3xl"
            style={{ background: 'radial-gradient(circle, rgba(229,207,148,0.32), transparent 65%)' }}
          />
          <div
            className="absolute top-1/3 -right-32 w-[680px] h-[680px] rounded-full blur-3xl"
            style={{ background: 'radial-gradient(circle, rgba(212,184,123,0.34), transparent 65%)' }}
          />
          <div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[820px] h-[420px] rounded-full blur-3xl"
            style={{ background: 'radial-gradient(circle, rgba(202,161,90,0.22), transparent 65%)' }}
          />
        </div>

        {/* Checked grid — champagne ruler lines (matches the luxe rim threads) */}
        <div
          className="absolute inset-0 opacity-[0.10]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(212,184,123,0.85) 1px, transparent 1px), linear-gradient(90deg, rgba(212,184,123,0.85) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />

        {/* Particle network — prominent ambient animation across the hero */}
        <div className="absolute inset-0 opacity-95 pointer-events-none">
          <Suspense fallback={null}>
            <ParticleNetwork />
          </Suspense>
        </div>

        <div className="relative max-w-6xl mx-auto px-6 lg:px-8 py-20 lg:py-28 flex flex-col items-center text-center">
          {/* Eyebrow rule + label */}
          <div className="flex items-center gap-3 mb-10 text-white/60">
            <span className="h-px w-10 bg-white/30" />
            <span className="text-[11px] tracking-[0.35em] uppercase font-semibold">EBS Department</span>
            <span className="h-px w-10 bg-white/30" />
          </div>

          {/* Union Trading Co. wordmark — white-on-transparent, large, centered */}
          <div className="relative flex items-center justify-center mb-12 w-full max-w-5xl">
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{
                background:
                  'radial-gradient(closest-side, rgba(255,255,255,0.14), rgba(255,255,255,0) 70%)',
              }}
            />
            <img
              src="./union-trading-logo-white.png"
              alt="Union Trading Co."
              className="relative w-full max-w-[860px] h-auto object-contain drop-shadow-[0_8px_60px_rgba(255,255,255,0.2)]"
            />
          </div>

          {/* Title */}
          <EditableText
            value={content.hero_title}
            isAdmin={isAdmin}
            onSave={v => saveContent('hero_title', v)}
            className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold font-display leading-[1.05] tracking-tight max-w-4xl"
            as="h1"
          />

          {/* Subtitle */}
          <EditableText
            value={content.hero_subtitle}
            isAdmin={isAdmin}
            onSave={v => saveContent('hero_subtitle', v)}
            className="text-base sm:text-lg text-white/65 mt-6 max-w-2xl"
            as="p"
          />

          {/* Hero CTA — primary luxe pill (champagne fill, dark arrow capsule, signature sweep + lift animation) */}
          <button
            onClick={() => navigate('/dashboard')}
            className="mt-10 luxe-button-pill"
          >
            Explore Projects
            <span className="luxe-button-pill-arrow">
              <ArrowRight size={15} />
            </span>
          </button>

          {/* Secondary — small caption for additional weight */}
          <div className="mt-14 flex items-center gap-6 text-[11px] uppercase tracking-[0.25em] text-white/35">
            <span>Enterprise Systems</span>
            <span className="w-1 h-1 rounded-full bg-white/40" />
            <span>Integrations</span>
            <span className="w-1 h-1 rounded-full bg-white/40" />
            <span>Analytics</span>
          </div>
        </div>

        {/* Bottom-right corner branding mark — subtle watermark */}
        <img
          src="./hero-corner-logo.png"
          alt=""
          aria-hidden="true"
          className="absolute right-4 bottom-4 sm:right-6 sm:bottom-6 w-32 sm:w-40 lg:w-48 h-auto pointer-events-none"
        />
      </section>


      {/* ─── Description ─────────────────────────────────────── */}
      <section id="about" className="luxe-section luxe-section-about overflow-hidden scroll-mt-4">
        <div className="luxe-rim-top" />
        <div className="relative max-w-5xl mx-auto px-6 lg:px-8 py-20 text-center">
          <Reveal>
            <div className="luxe-pill mb-6">
              <Sparkles size={12} /> About Us
            </div>
          </Reveal>
          {/* Card is always visible; words inside tie directly to scroll progress. */}
          <div className="luxe-card mx-auto max-w-3xl p-8 lg:p-10">
            {isAdmin ? (
              <EditableText
                value={content.description}
                isAdmin={isAdmin}
                multiline
                onSave={v => saveContent('description', v)}
                className="text-lg lg:text-xl luxe-body leading-relaxed"
                as="p"
              />
            ) : (
              <WordScrollReveal
                text={content.description}
                className="text-lg lg:text-xl luxe-body leading-relaxed"
                overlap={3}
              />
            )}
          </div>
        </div>
      </section>

      {/* ─── Achievements ────────────────────────────────────── */}
      <section id="moonshot" className="luxe-section luxe-section-moonshot overflow-hidden scroll-mt-4">
        <div className="luxe-rim-top" />
        <div className="relative max-w-5xl mx-auto px-6 lg:px-8 py-20">
          <Reveal className="text-center mb-12">
            <div className="luxe-pill">
              <Rocket size={12} /> Moonshot Projects
            </div>
          </Reveal>
          {/* Tiles use scroll-linked fade + blur-clear (per-tile slot) */}
          <MoonshotGrid
            achievements={content.achievements || []}
            isAdmin={isAdmin}
            onSave={saveAchievement}
          />
          <Reveal delay={300} className="text-center mt-12">
            <button onClick={() => navigate('/projects')} className="luxe-button">
              View our Projects
              <ArrowRight size={16} />
            </button>
          </Reveal>
        </div>
      </section>

      {/* ─── Vision ──────────────────────────────────────────── */}
      <section id="vision" className="luxe-section luxe-section-vision overflow-hidden scroll-mt-4">
        <div className="luxe-rim-top" />
        <div className="luxe-rim-bottom" />
        <div className="relative max-w-4xl mx-auto px-6 lg:px-8 py-20 text-center">
          <Reveal>
            <div className="luxe-pill mb-6">
              <Target size={12} /> Our Vision
            </div>
          </Reveal>
          {/* Card always visible; words tied to scroll progress like the About paragraph. */}
          <div className="luxe-card mx-auto p-8 lg:p-10">
            {isAdmin ? (
              <EditableText
                value={content.vision}
                isAdmin={isAdmin}
                multiline
                onSave={v => saveContent('vision', v)}
                className="text-lg lg:text-xl luxe-body leading-relaxed"
                as="blockquote"
              />
            ) : (
              <WordScrollReveal
                text={content.vision}
                className="text-lg lg:text-xl luxe-body leading-relaxed"
                as="blockquote"
                overlap={3}
              />
            )}
          </div>
        </div>
      </section>

      {/* ─── Team Tree ───────────────────────────────────────── */}
      <section id="team" className="luxe-section luxe-section-team overflow-hidden scroll-mt-4">
        <div className="luxe-rim-top" />
        <div className="relative max-w-5xl mx-auto px-6 lg:px-8 py-20">
          <Reveal className="text-center mb-14">
            <div className="luxe-pill mb-5">
              <Users size={12} /> Our Team
            </div>
            <h2
              className="text-base sm:text-lg lg:text-xl luxe-heading mt-2"
              style={{ fontWeight: 400, letterSpacing: '0' }}
            >
              The minds that power the platform
            </h2>
          </Reveal>

          {/* Wrapper is always rendered so useScrollProgress can attach its ref on first mount,
              before team data finishes loading. */}
          <div ref={setTeamGridRef} data-scroll-anchor className="flex flex-col items-center">
          {team.length === 0 ? (
            <div className="text-center text-surface-500 py-10">
              <p>No team members to show yet.</p>
              {isAdmin && (
                <p className="text-xs mt-2">Mark profiles with <code className="bg-surface-100 px-1 rounded">show_on_landing = true</code> and set <code className="bg-surface-100 px-1 rounded">is_team_lead</code> + <code className="bg-surface-100 px-1 rounded">display_order</code>.</p>
              )}
            </div>
          ) : (() => {
            // Cascading scroll-linked sequence — starts a bit later so the
            // user has scrolled meaningfully into the section before lead
            // inflate kicks in. Member spacing tightened slightly so the
            // last member still completes within reachable scroll.
            //   ① lead inflate  ② drop line  ③ trunk wipe + each member
            //     drop + card inflate, sequentially L→R
            const leadSlot     = { start: 0.13, end: 0.38 }
            const droplineSlot = { start: 0.38, end: 0.45 }
            const trunkSlot    = { start: 0.45, end: 0.75 }
            const memberSlots = members.map((_, i) => {
              const baseStart = 0.50 + i * 0.13  // M0 0.50, M1 0.63, M2 0.76
              return {
                drop: { start: baseStart,        end: baseStart + 0.05 },
                card: { start: baseStart + 0.04, end: baseStart + 0.17 },
              }
            })

            const clampProg = (start, end) => {
              const w = end - start
              return Math.max(0, Math.min(1, (teamProgress - start) / (w || 1)))
            }
            const droplineProg = clampProg(droplineSlot.start, droplineSlot.end)
            const trunkProg    = clampProg(trunkSlot.start,    trunkSlot.end)
            const animateConnectors = !isAdmin

            return (
              <>
                {/* Lead */}
                {lead && (
                  <div className="relative">
                    {/* Gold diamond ornament below lead */}
                    <div
                      aria-hidden="true"
                      className="hidden sm:block absolute left-1/2 -bottom-3 w-2 h-2 -translate-x-1/2 rotate-45"
                      style={{
                        background: 'linear-gradient(135deg, #f5e6c2, #caa15a)',
                        boxShadow: '0 0 10px rgba(229,207,148,0.5)',
                      }}
                    />
                    <TeamCard
                      member={lead}
                      lead
                      isAdmin={isAdmin}
                      onMemberChange={m =>
                        setTeam(t => t.map(x => (x.id === m.id ? m : x)))
                      }
                      mode="inflate"
                      sectionProgress={teamProgress}
                      slot={leadSlot}
                    />
                  </div>
                )}

                {/* Vertical drop from lead to the horizontal trunk */}
                {lead && members.length > 0 && (
                  <div
                    className="hidden sm:block w-px h-8 luxe-divider"
                    style={animateConnectors ? {
                      transform: `scaleY(${droplineProg})`,
                      transformOrigin: 'top',
                      transition: 'transform 200ms ease-out',
                    } : undefined}
                  />
                )}

                {/* Members row */}
                {members.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 sm:gap-10 mt-8 relative w-full">
                    {members.length > 1 && (
                      <>
                        {/* Mobile trunk: 2 cols, gap-6 = 24px → inset (100% − 24px)/4 */}
                        <div
                          className="block sm:hidden absolute -top-8 h-px luxe-divider"
                          style={{
                            left: 'calc((100% - 24px) / 4)',
                            right: 'calc((100% - 24px) / 4)',
                            ...(animateConnectors ? {
                              transform: `scaleX(${trunkProg})`,
                              transformOrigin: 'left',
                              transition: 'transform 200ms ease-out',
                            } : {}),
                          }}
                        />
                        {/* Desktop trunk: 3 cols, gap-10 = 40px → inset (100% − 80px)/6 */}
                        <div
                          className="hidden sm:block absolute -top-8 h-px luxe-divider"
                          style={{
                            ...(members.length === 2
                              ? { left: 'calc((100% - 80px) / 6)', right: '50%' }
                              : { left: 'calc((100% - 80px) / 6)', right: 'calc((100% - 80px) / 6)' }
                            ),
                            ...(animateConnectors ? {
                              transform: `scaleX(${trunkProg})`,
                              transformOrigin: 'left',
                              transition: 'transform 200ms ease-out',
                            } : {}),
                          }}
                        />
                      </>
                    )}

                    {members.map((m, i) => {
                      const mSlot = memberSlots[i]
                      const memberDropProg = animateConnectors
                        ? clampProg(mSlot.drop.start, mSlot.drop.end)
                        : 1
                      return (
                        <div key={m.id} className="relative">
                          {i < 3 && (
                            <div
                              className="hidden sm:block absolute left-1/2 -top-8 w-px h-8 luxe-divider"
                              style={animateConnectors ? {
                                transform: `translateX(-50%) scaleY(${memberDropProg})`,
                                transformOrigin: 'top',
                                transition: 'transform 200ms ease-out',
                              } : {
                                transform: 'translateX(-50%)',
                              }}
                            />
                          )}
                          <TeamCard
                            member={m}
                            isAdmin={isAdmin}
                            onMemberChange={mm =>
                              setTeam(t => t.map(x => (x.id === mm.id ? mm : x)))
                            }
                            mode="inflate"
                            sectionProgress={teamProgress}
                            slot={mSlot.card}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )
          })()}
          </div>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────── */}
      <footer id="contact" className="landing-footer-luxe scroll-mt-4">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-10">
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] items-center gap-8 sm:gap-12">
            {/* Union Trading Co. logo — full opacity, no drop-shadow */}
            <div className="flex items-center justify-center sm:justify-start">
              <img
                src="./union-trading-logo.png"
                alt="Union Trading Co."
                className="h-16 sm:h-20 w-auto object-contain landing-footer-logo"
              />
            </div>

            {/* Contact block — centered */}
            <div className="flex flex-col items-center text-center">
              <div className="landing-footer-eyebrow">Contact Us</div>
              <a
                href="mailto:ebs@utc.com.kw"
                className="landing-footer-email"
              >
                <Mail size={14} className="landing-footer-mail-icon" />
                ebs@utc.com.kw
              </a>
            </div>

            {/* Editable footer caption */}
            <EditableText
              value={content.footer_text}
              isAdmin={isAdmin}
              onSave={v => saveContent('footer_text', v)}
              className="landing-footer-caption text-center sm:text-right"
              as="p"
            />
          </div>
          <div className="landing-footer-baseline">
            Built with care · Kuwait · {new Date().getFullYear()}
          </div>
        </div>
      </footer>
    </div>
    </div>
  )
}
