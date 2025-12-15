import React, { useState } from 'react'
import './index.css'

function App() {
    const [tasks] = useState([
        { id: '1', title: 'Refactor Auth-Service', status: 'working', agent: 'Architect', time: '2 mins ago' },
        { id: '2', title: 'Fix CSS Grid Issue', status: 'done', agent: 'Frontend', time: '1 hour ago' },
        { id: '3', title: 'Database Migration v2', status: 'blocked', agent: 'DB-Admin', time: 'Pending Approval' },
    ])

    return (
        <div className="container animate-enter">
            <header style={{ marginBottom: '3rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: 700, background: 'linear-gradient(to right, var(--primary), var(--accent))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        AgentMesh Console
                    </h1>
                    <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>Orchestrate your intelligent swarm.</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button className="btn">Settings</button>
                    <button className="btn btn-primary">+ New Task</button>
                </div>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem' }}>

                {/* Main Panel: Active Tasks */}
                <section className="glass-panel" style={{ padding: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Active Tasks</h2>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Running: 1</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {tasks.map(task => (
                            <div key={task.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    <div style={{
                                        width: '40px', height: '40px', borderRadius: '8px',
                                        background: 'var(--bg-app)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        border: '1px solid var(--border)'
                                    }}>
                                        🐞
                                    </div>
                                    <div>
                                        <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{task.title}</h3>
                                        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{task.agent}</p>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                                    <span style={{ fontSize: '0.875rem', color: 'var(--text-dim)' }}>{task.time}</span>
                                    <span className={`status-badge status-${task.status === 'working' ? 'active' : task.status === 'blocked' ? 'blocked' : 'waiting'}`}>
                                        {task.status.toUpperCase()}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Side Panel: System Status */}
                <aside style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div className="glass-panel" style={{ padding: '1.5rem' }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Cluster Status</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Orchestrator</span>
                                <span style={{ color: 'var(--status-success)' }}>● Online</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Codex Adapter</span>
                                <span style={{ color: 'var(--status-success)' }}>● Connected</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Active Agents</span>
                                <span>3 / 10</span>
                            </div>
                        </div>
                    </div>

                    <div className="glass-panel" style={{ padding: '1.5rem' }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Recent Events</h3>
                        <ul style={{ listStyle: 'none', fontSize: '0.875rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <li><span style={{ color: 'var(--primary)' }}>[10:42]</span> Task #1 created</li>
                            <li><span style={{ color: 'var(--primary)' }}>[10:45]</span> Architect started analysis</li>
                            <li><span style={{ color: 'var(--status-error)' }}>[10:48]</span> Gate blocked: Migration</li>
                        </ul>
                    </div>
                </aside>

            </div>
        </div>
    )
}

export default App
