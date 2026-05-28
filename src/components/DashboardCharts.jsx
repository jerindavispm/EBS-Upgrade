import React from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts'

// Lazy-loaded by src/App.jsx so recharts (~80 KB gzipped) is only
// downloaded when the Dashboard route mounts. All four chart cards
// live here so the chunk is one cohesive bundle.
export default function DashboardCharts({
  byStatus, byPriority, ownerData, byPhase,
  PIE_COLORS, PRI_PIE_COLORS,
  onPieClick, drillOwner, drillPhase,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      <div data-accent="status" className="bg-white rounded-2xl p-6 border border-surface-200 shadow-sm">
        <h3 className="text-sm font-semibold text-surface-700 mb-1">Status Breakdown</h3>
        <p className="text-xs text-surface-400 mb-4">Click a segment to see projects</p>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={byStatus} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value"
              label={({ name, value }) => `${name} (${value})`} labelLine={false}
              onClick={(d) => onPieClick(d, 'status')} cursor="pointer">
              {byStatus.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Pie>
            <RTooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div data-accent="priority" className="bg-white rounded-2xl p-6 border border-surface-200 shadow-sm">
        <h3 className="text-sm font-semibold text-surface-700 mb-1">Priority Breakdown</h3>
        <p className="text-xs text-surface-400 mb-4">Click a segment to see projects</p>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={byPriority} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value"
              label={({ name, value }) => `${name} (${value})`} labelLine={false}
              onClick={(d) => onPieClick(d, 'priority')} cursor="pointer">
              {byPriority.map((_, i) => <Cell key={i} fill={PRI_PIE_COLORS[i % PRI_PIE_COLORS.length]} />)}
            </Pie>
            <RTooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div data-accent="owner" className="bg-white rounded-2xl p-6 border border-surface-200 shadow-sm">
        <h3 className="text-sm font-semibold text-surface-700 mb-1">Projects by Owner</h3>
        <p className="text-xs text-surface-400 mb-4">Click a bar to see projects</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={ownerData} layout="vertical" margin={{ left: 10, right: 20 }}>
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 10 }} />
            <RTooltip />
            <Bar dataKey="value" fill="#4c6ef5" radius={[0, 6, 6, 0]} barSize={18}
              onClick={(d) => drillOwner(d.fullName || d.name)} cursor="pointer" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div data-accent="phase" className="bg-white rounded-2xl p-6 border border-surface-200 shadow-sm">
        <h3 className="text-sm font-semibold text-surface-700 mb-1">Projects by Phase</h3>
        <p className="text-xs text-surface-400 mb-4">Click a bar to see projects</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={byPhase} margin={{ bottom: 20 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11, angle: -20, textAnchor: 'end' }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <RTooltip />
            {/* Bar fill is brighter than the panel's emerald tint so it glows against the surface */}
            <Bar dataKey="value" fill="#a3e635" radius={[6, 6, 0, 0]} barSize={32}
              onClick={(d) => drillPhase(d.name)} cursor="pointer" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
