import React, { Fragment, useEffect, useState, useCallback, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown, ChevronUp, ArrowRight, Users, User,
  Sparkles, Target, Mail
} from 'lucide-react'
import { supabase, supabasePublic } from '../supabaseClient'
import { EditableText, EditableImage } from './Editable'

const ParticleNetwork = React.lazy(() => import('./ParticleNetwork'))

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
function AchievementTile({ item, index, isAdmin, onSave }) {
  const update = async (field, newValue) => {
    // Parent tracks the full achievements array; we update via lift-up.
    await onSave({ ...item, [field]: newValue }, index)
  }
  return (
    <div className="bg-white/80 backdrop-blur rounded-2xl border border-surface-200 p-6 shadow-sm text-center hover:shadow-md transition-shadow">
      <div className="text-4xl mb-2">{item.icon || '⭐'}</div>
      <EditableText
        value={item.value}
        isAdmin={isAdmin}
        onSave={v => update('value', v)}
        className="text-3xl font-bold font-display text-brand-600"
        as="div"
      />
      <EditableText
        value={item.label}
        isAdmin={isAdmin}
        onSave={v => update('label', v)}
        className="text-sm text-surface-500 mt-1"
        as="div"
      />
    </div>
  )
}

// ---- Team card -------------------------------------------------------------
function TeamCard({ member, lead = false, isAdmin, onMemberChange }) {
  const [expanded, setExpanded] = useState(false)
  const sizeClasses = lead
    ? 'w-40 h-40 sm:w-48 sm:h-48'
    : 'w-28 h-28 sm:w-32 sm:h-32'

  const saveField = async (field, value) => {
    const { error } = await supabase.from('profiles').update({ [field]: value }).eq('id', member.id)
    if (error) throw error
    onMemberChange({ ...member, [field]: value })
  }

  return (
    <div className="flex flex-col items-center text-center">
      <EditableImage
        src={member.avatar_url}
        alt={member.full_name}
        isAdmin={isAdmin}
        supabase={supabase}
        bucket="team-photos"
        pathPrefix={`${member.id}/`}
        onSave={url => saveField('avatar_url', url)}
        className={`${sizeClasses} rounded-full overflow-hidden bg-gradient-to-br from-brand-500 to-brand-700 ring-4 ring-white shadow-lg flex items-center justify-center`}
        imgClassName="w-full h-full object-cover"
        fallback={<User className="text-white/80" size={lead ? 80 : 56} />}
      />
      <div className="mt-4 max-w-[200px]">
        <EditableText
          value={member.full_name}
          isAdmin={isAdmin}
          onSave={v => saveField('full_name', v)}
          className={lead ? 'text-lg font-bold font-display text-surface-900' : 'text-sm font-semibold text-surface-800'}
          as="div"
          placeholder="Name"
        />
        <EditableText
          value={member.job_title}
          isAdmin={isAdmin}
          onSave={v => saveField('job_title', v)}
          className={lead ? 'text-sm text-brand-600 font-medium mt-1' : 'text-xs text-brand-600 mt-0.5'}
          as="div"
          placeholder="Job title"
        />
      </div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-3 flex items-center gap-1 text-xs text-surface-500 hover:text-brand-600 transition-colors"
      >
        {expanded ? <>Hide details <ChevronUp size={12} /></> : <>Expand <ChevronDown size={12} /></>}
      </button>
      {expanded && (
        <div className="mt-2 bg-white rounded-xl p-3 shadow-md border border-surface-100 max-w-xs text-left">
          {Array.isArray(member.employee_roles) && member.employee_roles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {member.employee_roles.map((r, i) => (
                <span key={i} className="inline-block px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[10px] font-semibold tracking-wide">
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
            className="text-xs text-surface-600 leading-relaxed"
            as="p"
            placeholder="No bio yet — admin can add one."
          />
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
    <div className="-m-4 sm:-m-6 lg:-m-8">
      {/* ─── Hero ────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-black text-white">
        {/* Top nav — three in-page anchors. Pinned at z-50 with a soft
            gradient backdrop so it always reads above the particle
            animation and ambient light pools below. Offset down from the
            hero's top edge so the wrapper's negative margins + any
            iOS safe-area inset don't push it off-screen. */}
        <nav
          className="absolute left-0 right-0 z-50 flex items-center justify-center gap-6 sm:gap-10 py-4 px-6 pointer-events-none"
          style={{
            top: 'max(2.5rem, calc(env(safe-area-inset-top) + 1.5rem))',
            background: 'linear-gradient(180deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0) 100%)',
            borderRadius: '0 0 18px 18px',
          }}
        >
          {[
            { id: 'about',   label: 'About Us' },
            { id: 'team',    label: 'Our Team' },
            { id: 'contact', label: 'Contact Us' },
          ].map((item, i) => (
            <Fragment key={item.id}>
              {i > 0 && <span className="w-1 h-1 rounded-full bg-white/40 pointer-events-none" aria-hidden="true" />}
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById(item.id)
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                className="pointer-events-auto text-xs sm:text-sm tracking-[0.28em] uppercase font-semibold text-white hover:text-amber-200 transition-colors"
              >
                {item.label}
              </button>
            </Fragment>
          ))}
        </nav>

        {/* Ambient light pools behind the logo — pure monochrome, no brand-blue */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-24 -left-24 w-[520px] h-[520px] rounded-full bg-white/5 blur-3xl" />
          <div className="absolute top-1/3 -right-32 w-[560px] h-[560px] rounded-full bg-white/5 blur-3xl" />
        </div>

        {/* Subtle grid — low-contrast white ruler lines */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
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

          {/* CTA — inverted high-contrast, echoes the logo's B&W aesthetic */}
          <button
            onClick={() => navigate('/dashboard')}
            className="mt-10 group inline-flex items-center gap-3 pl-6 pr-4 py-3 bg-white text-black rounded-full font-semibold text-sm tracking-tight hover:bg-white/90 transition-all"
          >
            Explore Projects
            <span className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center transition-transform group-hover:translate-x-0.5">
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

        {/* Bottom-right corner branding mark — sized small as a
            subtle watermark in the black animation area. pointer-
            events-none so it never steals clicks from the eyebrow
            CTAs above. */}
        <img
          src="./hero-corner-logo.png"
          alt=""
          aria-hidden="true"
          className="absolute right-4 bottom-4 sm:right-6 sm:bottom-6 w-32 sm:w-40 lg:w-48 h-auto pointer-events-none"
        />
      </section>

      {/* ─── Description ─────────────────────────────────────── */}
      <section id="about" className="bg-white scroll-mt-4">
        <div className="max-w-5xl mx-auto px-6 lg:px-8 py-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 text-brand-700 text-xs font-semibold mb-4">
            <Sparkles size={12} /> ABOUT US
          </div>
          <EditableText
            value={content.description}
            isAdmin={isAdmin}
            multiline
            onSave={v => saveContent('description', v)}
            className="text-lg lg:text-xl text-surface-700 leading-relaxed"
            as="p"
          />
        </div>
      </section>

      {/* ─── Achievements ────────────────────────────────────── */}
      <section className="bg-surface-50">
        <div className="max-w-5xl mx-auto px-6 lg:px-8 py-16">
          <div className="text-center mb-10">
            <h2 className="text-2xl lg:text-3xl font-bold font-display text-surface-900">Moonshot Projects</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {(content.achievements || []).map((a, i) => {
              // Tile 1 keeps its DB icon; tiles 2 and 3 get domain-specific
              // overrides (e-commerce + IT security) so the visuals stay
              // tied to their categories regardless of past admin edits.
              const ICON_BY_INDEX = ['', '🛒', '🛡️']
              const item = ICON_BY_INDEX[i] ? { ...a, icon: ICON_BY_INDEX[i] } : a
              return (
                <AchievementTile
                  key={i}
                  item={item}
                  index={i}
                  isAdmin={isAdmin}
                  onSave={saveAchievement}
                />
              )
            })}
          </div>
          <div className="text-center mt-10">
            <button
              onClick={() => navigate('/projects')}
              className="inline-flex items-center gap-2 px-6 py-3 bg-surface-900 hover:bg-surface-800 text-white rounded-xl font-medium text-sm transition-colors"
            >
              View our Projects <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>

      {/* ─── Vision ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-black text-white">
        {/* subtle ambient glow echo of the hero */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-white/5 blur-3xl pointer-events-none" />
        <div className="relative max-w-4xl mx-auto px-6 lg:px-8 py-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-white/90 text-xs font-semibold mb-4">
            <Target size={12} /> OUR VISION
          </div>
          <EditableText
            value={content.vision}
            isAdmin={isAdmin}
            multiline
            onSave={v => saveContent('vision', v)}
            className="text-xl lg:text-2xl font-display leading-relaxed italic"
            as="blockquote"
          />
        </div>
      </section>

      {/* ─── Team Tree ───────────────────────────────────────── */}
      <section id="team" className="bg-white scroll-mt-4">
        <div className="max-w-5xl mx-auto px-6 lg:px-8 py-16">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 text-brand-700 text-xs font-semibold mb-3">
              <Users size={12} /> OUR TEAM
            </div>
            <h2 className="text-2xl lg:text-3xl font-bold font-display text-surface-900">The minds that power the platform</h2>
          </div>

          {team.length === 0 ? (
            <div className="text-center text-surface-500 py-10">
              <p>No team members to show yet.</p>
              {isAdmin && (
                <p className="text-xs mt-2">Mark profiles with <code className="bg-surface-100 px-1 rounded">show_on_landing = true</code> and set <code className="bg-surface-100 px-1 rounded">is_team_lead</code> + <code className="bg-surface-100 px-1 rounded">display_order</code>.</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center">
              {/* Lead */}
              {lead && (
                <div className="relative">
                  <TeamCard
                    member={lead}
                    lead
                    isAdmin={isAdmin}
                    onMemberChange={m =>
                      setTeam(t => t.map(x => (x.id === m.id ? m : x)))
                    }
                  />
                </div>
              )}

              {/* Vertical drop from lead to the horizontal trunk */}
              {lead && members.length > 0 && (
                <div className="hidden sm:block w-px h-10 bg-surface-300" />
              )}

              {/* Members row */}
              {members.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 sm:gap-12 mt-10 relative w-full">
                  {/* Horizontal trunk — spans from the first cell's centre
                      to the last cell's centre. With N equal-width columns
                      and total gap G, the inset on each side equals
                      (100% - G) / (2N). Hidden for a single member (no peers
                      to connect to). Only renders if the row has ≥2 cells
                      visible — i.e. ≥2 members on mobile, ≥2 on desktop;
                      capped at 3 on desktop because that's the row-1 width. */}
                  {members.length > 1 && (
                    <>
                      {/* Mobile: 2 cols, gap-8 = 32px → inset (100% − 32px)/4 */}
                      <div
                        className="block sm:hidden absolute -top-10 h-px bg-surface-300"
                        style={{
                          left: 'calc((100% - 32px) / 4)',
                          right: 'calc((100% - 32px) / 4)',
                        }}
                      />
                      {/* Desktop: 3 cols, gap-12 = 48px → inset (100% − 96px)/6.
                          When members.length === 2 the grid has only 2
                          populated cells in the 3-col track, so the trunk
                          should match cell-1 and cell-2 centres
                          (1/6 and 1/2): inset L = (100% − 96px)/6, R = 50%. */}
                      <div
                        className="hidden sm:block absolute -top-10 h-px bg-surface-300"
                        style={
                          members.length === 2
                            ? {
                                left: 'calc((100% - 96px) / 6)',
                                right: '50%',
                              }
                            : {
                                left: 'calc((100% - 96px) / 6)',
                                right: 'calc((100% - 96px) / 6)',
                              }
                        }
                      />
                    </>
                  )}

                  {members.map((m, i) => (
                    <div key={m.id} className="relative">
                      {/* Vertical connector — only on row-1 cells. Mobile
                          shows 2 cols so cells 0–1 are row 1; desktop shows
                          3 cols so cells 0–2 are row 1. Connectors are
                          desktop-only (`hidden sm:block`) and only on
                          indices < 3 to avoid dangling drops on row 2+. */}
                      {i < 3 && (
                        <div className="hidden sm:block absolute left-1/2 -top-10 w-px h-10 bg-surface-300 -translate-x-1/2" />
                      )}
                      <TeamCard
                        member={m}
                        isAdmin={isAdmin}
                        onMemberChange={mm =>
                          setTeam(t => t.map(x => (x.id === mm.id ? mm : x)))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
  )
}
