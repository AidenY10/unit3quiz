import './App.css'
import { useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import { auth, db } from './firebase'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const csvUrl = new URL('./assets/Warehouse_and_Retail_Sales.csv', import.meta.url).href

const METRIC_CONFIG = {
  retailSales: {
    key: 'RETAIL SALES',
    label: 'Retail Sales',
    color: '#38bdf8',
  },
  retailTransfers: {
    key: 'RETAIL TRANSFERS',
    label: 'Retail Transfers',
    color: '#a855f7',
  },
  warehouseSales: {
    key: 'WAREHOUSE SALES',
    label: 'Warehouse Sales',
    color: '#22c55e',
  },
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function groupByMonth(records, filters, metricKey) {
  const metricField = METRIC_CONFIG[metricKey].key

  const buckets = new Map()

  for (const row of records) {
    if (filters.itemType !== 'ALL' && row['ITEM TYPE'] !== filters.itemType) continue
    if (filters.year !== 'ALL' && String(row.YEAR) !== String(filters.year)) continue

    const year = Number(row.YEAR)
    const month = Number(row.MONTH)
    if (!year || !month) continue

    const ymKey = `${year}-${String(month).padStart(2, '0')}`
    const existing = buckets.get(ymKey) || {
      year,
      month,
      label: `${MONTH_LABELS[month - 1]} ${year}`,
      retailSales: 0,
      retailTransfers: 0,
      warehouseSales: 0,
    }

    const retailSales = Number(row['RETAIL SALES'] ?? 0) || 0
    const retailTransfers = Number(row['RETAIL TRANSFERS'] ?? 0) || 0
    const warehouseSales = Number(row['WAREHOUSE SALES'] ?? 0) || 0

    existing.retailSales += retailSales
    existing.retailTransfers += retailTransfers
    existing.warehouseSales += warehouseSales

    buckets.set(ymKey, existing)
  }

  const result = Array.from(buckets.values())
  result.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year
    return a.month - b.month
  })
  return result
}

function SalesDashboard() {
  const [currentUser, setCurrentUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authModeLogin, setAuthModeLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [userVote, setUserVote] = useState(null)
  const [voteBusy, setVoteBusy] = useState(false)
  const [voteJustCast, setVoteJustCast] = useState(null)

  const [rawRows, setRawRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [itemTypeFilter, setItemTypeFilter] = useState('ALL')
  const [yearFilter, setYearFilter] = useState('ALL')
  const [metric, setMetric] = useState('retailSales')
  const [showAllSeries, setShowAllSeries] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user)
      setAuthLoading(false)
      setAuthError('')
      setUserVote(null)

      if (user) {
        try {
          const voteRef = doc(db, 'votes', user.uid)
          const snap = await getDoc(voteRef)
          if (snap.exists()) {
            const data = snap.data()
            if (data && data.vote) {
              setUserVote(data.vote)
            }
          }
        } catch (err) {
          console.error('Error loading vote', err)
        }
      }
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(csvUrl)
      .then((res) => {
        if (!res.ok) throw new Error('Unable to load CSV data')
        return res.text()
      })
      .then((text) => {
        if (cancelled) return
        const parsed = Papa.parse(text, {
          header: true,
          dynamicTyping: false,
          skipEmptyLines: true,
        })

        if (parsed.errors && parsed.errors.length > 0) {
          console.warn('CSV parse errors', parsed.errors.slice(0, 3))
        }

        const rows = parsed.data.map((row) => ({
          ...row,
          YEAR: Number(row.YEAR),
          MONTH: Number(row.MONTH),
          'RETAIL SALES': Number(row['RETAIL SALES'] ?? 0),
          'RETAIL TRANSFERS': Number(row['RETAIL TRANSFERS'] ?? 0),
          'WAREHOUSE SALES': Number(row['WAREHOUSE SALES'] ?? 0),
        }))

        setRawRows(rows)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        console.error(err)
        setError('Something went wrong while loading the sales data.')
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const itemTypes = useMemo(() => {
    const types = new Set()
    for (const row of rawRows) {
      if (row['ITEM TYPE']) types.add(row['ITEM TYPE'])
    }
    return Array.from(types).sort()
  }, [rawRows])

  const years = useMemo(() => {
    const ys = new Set()
    for (const row of rawRows) {
      if (row.YEAR) ys.add(row.YEAR)
    }
    return Array.from(ys).sort()
  }, [rawRows])

  const monthlyData = useMemo(
    () =>
      groupByMonth(
        rawRows,
        { itemType: itemTypeFilter, year: yearFilter },
        metric,
      ),
    [rawRows, itemTypeFilter, yearFilter, metric],
  )

  const summary = useMemo(() => {
    if (!monthlyData.length) {
      return {
        months: 0,
        totalRetailSales: 0,
        totalTransfers: 0,
        totalWarehouse: 0,
      }
    }
    return monthlyData.reduce(
      (acc, row) => {
        acc.months += 1
        acc.totalRetailSales += row.retailSales
        acc.totalTransfers += row.retailTransfers
        acc.totalWarehouse += row.warehouseSales
        return acc
      },
      {
        months: 0,
        totalRetailSales: 0,
        totalTransfers: 0,
        totalWarehouse: 0,
      },
    )
  }, [monthlyData])

  const activeMetric = METRIC_CONFIG[metric]

  async function handleAuthSubmit(event) {
    event.preventDefault()
    if (!email || !password) {
      setAuthError('Please enter both email and password.')
      return
    }
    setAuthBusy(true)
    setAuthError('')
    try {
      if (authModeLogin) {
        await signInWithEmailAndPassword(auth, email, password)
      } else {
        await createUserWithEmailAndPassword(auth, email, password)
      }
    } catch (err) {
      console.error(err)
      let message = 'Something went wrong. Please try again.'
      if (err.code === 'auth/user-not-found') {
        message = 'No account found for this email.'
      } else if (err.code === 'auth/wrong-password') {
        message = 'Incorrect password. Try again.'
      } else if (err.code === 'auth/email-already-in-use') {
        message = 'An account already exists for this email.'
      } else if (err.code === 'auth/weak-password') {
        message = 'Password should be at least 6 characters.'
      }
      setAuthError(message)
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleVote(choice) {
    if (!currentUser || userVote || voteBusy) return
    setVoteBusy(true)
    try {
      const voteRef = doc(db, 'votes', currentUser.uid)
      const existing = await getDoc(voteRef)
      if (existing.exists()) {
        const data = existing.data()
        if (data && data.vote) {
          setUserVote(data.vote)
          return
        }
      }
      await setDoc(voteRef, {
        vote: choice,
        createdAt: serverTimestamp(),
        email: currentUser.email ?? null,
      })
      setUserVote(choice)
      setVoteJustCast(choice)
    } catch (err) {
      console.error('Error saving vote', err)
    } finally {
      setVoteBusy(false)
    }
  }

  return (
    <main className="app-root">
      <div className="app-shell">
        <header className="app-header">
          <h1 className="app-title">Warehouse &amp; Retail Sales Pulse</h1>
          <p className="app-subtitle">
            Explore sales performance across warehouse, retail, and transfers. Segment by product
            type and year to see how volume shifts month over month.
          </p>
        </header>

        <section className="glass-panel" aria-label="Sales analytics dashboard">
          <div className="glass-inner">
            <div>
              <div className="auth-card" aria-label="Login and vote">
                <div className="auth-header">
                  <div>
                    <div className="auth-title">Sign in &amp; cast your vote</div>
                    <p className="auth-tagline">
                      Use email and password. Once you vote, your choice is locked in.
                    </p>
                  </div>
                  <div className="auth-mode-toggle">
                    {authModeLogin ? 'Need an account?' : 'Already registered?'}{' '}
                    <button type="button" onClick={() => setAuthModeLogin((v) => !v)}>
                      {authModeLogin ? 'Create one' : 'Sign in'}
                    </button>
                  </div>
                </div>

                {!authLoading && !currentUser && (
                  <form onSubmit={handleAuthSubmit}>
                    <div className="auth-form-row">
                      <div className="auth-field">
                        <input
                          type="email"
                          className="auth-input"
                          placeholder="you@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          autoComplete="email"
                          required
                        />
                      </div>
                      <div className="auth-field">
                        <input
                          type="password"
                          className="auth-input"
                          placeholder="Password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          autoComplete={authModeLogin ? 'current-password' : 'new-password'}
                          required
                        />
                      </div>
                      <button className="auth-submit" type="submit" disabled={authBusy}>
                        {authBusy
                          ? authModeLogin
                            ? 'Signing in…'
                            : 'Creating account…'
                          : authModeLogin
                            ? 'Sign in'
                            : 'Create account'}
                      </button>
                    </div>
                    {authError && <p className="auth-error">{authError}</p>}
                  </form>
                )}

                {!authLoading && currentUser && (
                  <div className="auth-status">
                    Signed in as <strong>{currentUser.email}</strong>.{' '}
                    <button
                      type="button"
                      className="auth-submit"
                      style={{ paddingInline: '0.8rem', fontSize: '0.76rem' }}
                      onClick={() => signOut(auth)}
                    >
                      Sign out
                    </button>
                  </div>
                )}

                {authLoading && <p className="auth-status">Checking sign-in status…</p>}

                {currentUser && (
                  <div className="vote-card">
                    <div className="vote-header">Your one-time vote</div>
                    {!userVote && (
                      <>
                        <p className="vote-helper">
                          Choose <strong>Yay</strong> or <strong>Nay</strong>. Once saved, this vote
                          cannot be changed.
                        </p>
                        <div className="vote-buttons">
                          <button
                            type="button"
                            className="vote-button yay"
                            disabled={voteBusy}
                            onClick={() => handleVote('yay')}
                          >
                            Yay
                          </button>
                          <button
                            type="button"
                            className="vote-button nay"
                            disabled={voteBusy}
                            onClick={() => handleVote('nay')}
                          >
                            Nay
                          </button>
                        </div>
                      </>
                    )}
                    {userVote && (
                      <p className={`vote-result ${userVote === 'nay' ? 'nay' : 'yay'}`}>
                        Your one-time vote
                        <br />
                        You voted <strong>{userVote.toUpperCase()}</strong>. Thank you — your vote
                        is locked in and cannot be changed.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="chart-card">
              <div className="chart-header">
      <div>
                  <div className="chart-title">Monthly Volume by Channel</div>
                </div>
                <span className="chart-pill">
                  {itemTypeFilter === 'ALL' ? 'All item types' : itemTypeFilter}{' '}
                  {yearFilter !== 'ALL' ? `• ${yearFilter}` : ''}
                </span>
              </div>

              <div className="chart-meta">
                <span>
                  <span className="chart-meta-label">Metric:</span>{' '}
                  <span className="chart-meta-value">{activeMetric.label}</span>
                </span>
                <span>
                  <span className="chart-meta-label">View:</span>{' '}
                  <span className="chart-meta-value">
                    {showAllSeries ? 'All channels overlay' : 'Focused single series'}
                  </span>
                </span>
                <span>
                  <span className="chart-meta-label">Months:</span>{' '}
                  <span className="chart-meta-value">{monthlyData.length}</span>
                </span>
              </div>

              <div className="chart-wrapper">
                {loading && <p>Loading sales data…</p>}
                {!loading && error && <p>{error}</p>}
                {!loading && !error && monthlyData.length === 0 && (
                  <p>No data found for the selected filters.</p>
                )}
                {!loading && !error && monthlyData.length > 0 && (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthlyData} margin={{ top: 10, right: 18, left: 0, bottom: 6 }}>
                      <defs>
                        <linearGradient id="retailSalesFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="retailTransfersFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#a855f7" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="#a855f7" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="warehouseSalesFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22c55e" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke="rgba(148, 163, 184, 0.25)"
                        vertical={false}
                        strokeDasharray="3 3"
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10, fill: 'rgba(148, 163, 184, 0.95)' }}
                        tickMargin={8}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: 'rgba(148, 163, 184, 0.95)' }}
                        tickMargin={6}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgba(15, 23, 42, 0.95)',
                          border: '1px solid rgba(51, 65, 85, 0.9)',
                          borderRadius: 10,
                          padding: '0.5rem 0.75rem',
                          fontSize: 12,
                          color: '#e5e7eb',
                        }}
                        labelStyle={{ marginBottom: 4, color: '#cbd5f5', fontWeight: 500 }}
                        formatter={(value, name) => {
                          const labelMap = {
                            retailSales: 'Retail sales',
                            retailTransfers: 'Retail transfers',
                            warehouseSales: 'Warehouse sales',
                          }
                          return [Number(value).toLocaleString(), labelMap[name] ?? name]
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        align="right"
                        iconType="circle"
                        wrapperStyle={{
                          paddingBottom: 8,
                          fontSize: 11,
                          color: 'rgba(148, 163, 184, 0.95)',
                        }}
                      />

                      {(showAllSeries || metric === 'retailSales') && (
                        <Area
                          type="monotone"
                          dataKey="retailSales"
                          name="Retail sales"
                          stroke="#38bdf8"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#retailSalesFill)"
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                      )}
                      {(showAllSeries || metric === 'retailTransfers') && (
                        <Area
                          type="monotone"
                          dataKey="retailTransfers"
                          name="Retail transfers"
                          stroke="#a855f7"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#retailTransfersFill)"
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                      )}
                      {(showAllSeries || metric === 'warehouseSales') && (
                        <Area
                          type="monotone"
                          dataKey="warehouseSales"
                          name="Warehouse sales"
                          stroke="#22c55e"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#warehouseSalesFill)"
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
              </div>
            </div>

            <aside className="sidebar" aria-label="Segmentation and settings">
              <div className="sidebar-section">
                <h2 className="sidebar-heading">Segmentation</h2>
                <p className="sidebar-helper">
                  Slice the CSV by item type and year. The graph always rolls up results by month.
                </p>

                <div className="select-row">
                  <div className="field-group">
                    <label className="field-label" htmlFor="item-type-select">
                      Item type
                    </label>
                    <select
                      id="item-type-select"
                      className="field-select"
                      value={itemTypeFilter}
                      onChange={(e) => setItemTypeFilter(e.target.value)}
                    >
                      <option value="ALL">All item types</option>
                      {itemTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field-group">
                    <label className="field-label" htmlFor="year-select">
                      Year
                    </label>
                    <select
                      id="year-select"
                      className="field-select"
                      value={yearFilter}
                      onChange={(e) => setYearFilter(e.target.value)}
                    >
                      <option value="ALL">All years</option>
                      {years.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="sidebar-section">
                <h2 className="sidebar-heading">Metric focus</h2>
                <p className="sidebar-helper">
                  Choose the primary metric and whether to compare channels or zoom into one.
                </p>

                <div className="select-row">
                  <div className="field-group">
                    <label className="field-label" htmlFor="metric-select">
                      Primary metric
                    </label>
                    <select
                      id="metric-select"
                      className="field-select"
                      value={metric}
                      onChange={(e) => setMetric(e.target.value)}
                    >
                      <option value="retailSales">Retail sales</option>
                      <option value="retailTransfers">Retail transfers</option>
                      <option value="warehouseSales">Warehouse sales</option>
                    </select>
                  </div>
                </div>

                <div className="toggle-row" aria-label="Series visibility toggle">
                  <label className="toggle-pill">
                    <input
                      type="checkbox"
                      checked={showAllSeries}
                      onChange={(e) => setShowAllSeries(e.target.checked)}
                    />
                    Show all channels together
                  </label>
                </div>

                <div className="stats-row">
                  <div className="stat-chip">
                    Months in view: <span>{summary.months}</span>
                  </div>
                  <div className="stat-chip">
                    Σ Retail: <span>{Math.round(summary.totalRetailSales).toLocaleString()}</span>
                  </div>
                  <div className="stat-chip">
                    Σ Transfers:{' '}
                    <span>{Math.round(summary.totalTransfers).toLocaleString()}</span>
                  </div>
                  <div className="stat-chip">
                    Σ Warehouse:{' '}
                    <span>{Math.round(summary.totalWarehouse).toLocaleString()}</span>
                  </div>
                </div>

                <div className="status-bar" aria-label="Data status">
                  <div className="status-label">
                    <span className="status-dot" />
                    <span>Live from CSV snapshot</span>
                  </div>
                  <span className="status-meta">
                    {rawRows.length.toLocaleString()} rows loaded
                  </span>
                </div>
              </div>
            </aside>
      </div>

          <footer className="intent-footer">
            <p>
              <span className="intent-label">Statement of intent:</span>{' '}
              This dashboard is designed to surface how product mix and channel choice shape
              month-over-month sales so that stakeholders can make more confident inventory and
              purchasing decisions.
            </p>
            <p className="intent-meta">
              Data source: `Warehouse_and_Retail_Sales.csv` • View: monthly rollups with optional
              segmentation by item type and year.
            </p>
          </footer>
        </section>
        {voteJustCast && (
          <div className="vote-modal-backdrop" role="alertdialog" aria-modal="true">
            <div className={`vote-modal ${voteJustCast === 'yay' ? 'yay' : 'nay'}`}>
              <h2 className="vote-modal-title">
                You voted {voteJustCast.toUpperCase()}!
              </h2>
              <p className="vote-modal-text">Thanks for your support!</p>
              <button
                type="button"
                className="vote-modal-button"
                onClick={() => setVoteJustCast(null)}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

export default SalesDashboard
