// Option C: Living Dock
// Metaphor: a home dock with an attention theater at the top.
// When a session needs attention, its creature "rises" into a focus pane
// with big YES/NO/ALWAYS targets. Calm state is a gentle horizontal dock
// of creature chips. Services/devices collapse into scannable rows.

const { Creature: CreatureC } = window;

function OptionC({ scenario }) {
  const { AGENTS, STATE_COLOR, SCENARIOS, SERVICES, RATE_LIMITS, DEVICES } = window.AD;
  const sessions = SCENARIOS[scenario] || [];
  const attn = sessions.filter(s => s.state === 'awaiting');
  const proc = sessions.filter(s => s.state === 'processing');
  const featured = attn[0];

  return (
    <div style={{
      width: 360, height: 600,
      background: '#f6f3ee',
      color: '#1a1a1f',
      fontFamily: '-apple-system, "SF Pro", sans-serif',
      fontSize: 12,
      borderRadius: 14,
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      boxShadow: '0 18px 60px rgba(0,0,0,0.22), 0 0 0 0.5px rgba(0,0,0,0.08)',
    }}>
      {/* attention theater */}
      {featured ? (
        <AttentionTheater session={featured} />
      ) : (
        <CalmHeader count={sessions.length} proc={proc.length} />
      )}

      {/* dock of creatures */}
      <div style={{
        padding: '10px 14px 8px',
        borderBottom: '0.5px solid rgba(0,0,0,0.06)',
        background: 'rgba(255,255,255,0.6)',
      }}>
        <LabelC>Sessions</LabelC>
        {sessions.length === 0 ? (
          <div style={{ padding: '16px 6px', textAlign: 'center', color: '#7a7a82' }}>
            <div style={{ fontSize: 20, opacity: 0.3 }}>·</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>No sessions running</div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
            {sessions.map(s => <DockChip key={s.id} session={s} featured={featured && s.id === featured.id}/>)}
            <LaunchChip />
          </div>
        )}
      </div>

      {/* content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
        {/* live log (for processing sessions) */}
        {proc.length > 0 && (
          <>
            <LabelC>Activity</LabelC>
            <div style={{
              background: 'rgba(0,0,0,0.03)',
              borderRadius: 8,
              padding: '8px 10px',
              marginBottom: 10,
              fontFamily: 'ui-monospace, monospace',
              fontSize: 10.5,
              color: '#4a4a52',
            }}>
              {proc.map(s => {
                const a = AGENTS[s.agent];
                return (
                  <div key={s.id} style={{ display: 'flex', gap: 6, padding: '2px 0' }}>
                    <span style={{ color: a.color, width: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.project}</span>
                    <span>›</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.tool || '…'}</span>
                    <span style={{ color: '#9a9aa2' }}>{s.started}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <LabelC>Rate Limits</LabelC>
        <RateRowC label="5h" {...RATE_LIMITS.fiveHour}/>
        <RateRowC label="7d" {...RATE_LIMITS.sevenDay}/>

        <LabelC>Models & Services</LabelC>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10,
        }}>
          {SERVICES.map(svc => <ServiceCardC key={svc.key} svc={svc}/>)}
        </div>

        <LabelC>Devices · 14 surfaces</LabelC>
        <DeviceConstellation/>
      </div>

      {/* footer */}
      <div style={{
        padding: '8px 12px',
        borderTop: '0.5px solid rgba(0,0,0,0.08)',
        background: 'rgba(255,255,255,0.7)',
        display: 'flex', gap: 6, alignItems: 'center',
      }}>
        <PillBtn primary label="Launch Session"/>
        <PillBtn label="Dashboard"/>
        <PillBtn label="Evaluation"/>
        <div style={{ flex: 1 }}/>
        <PillBtn icon={<GearIcon size={15} color="#1a1a1f" />}/>
      </div>
    </div>
  );
}

function AttentionTheater({ session }) {
  const { AGENTS } = window.AD;
  const a = AGENTS[session.agent];
  return (
    <div style={{
      padding: '14px 14px 14px',
      background: 'linear-gradient(135deg, #FFE9C7 0%, #FFD9A0 100%)',
      borderBottom: '0.5px solid rgba(0,0,0,0.08)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: -20, right: -20, width: 120, height: 120,
        background: 'radial-gradient(circle, rgba(255,255,255,0.5), transparent)',
      }}/>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, position: 'relative' }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14,
          background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          animation: 'breathe 1.8s ease-in-out infinite',
        }}>
          <CreatureC kind={a.creature} size={40} color={a.color} animate state="awaiting"/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: '#8a6a20', letterSpacing: 1, fontWeight: 700 }}>NEEDS ATTENTION</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{session.project}</div>
          <div style={{ fontSize: 11, color: '#6a5a30', marginTop: 1 }}>{a.label} · {session.model} · {session.started}</div>
          <div style={{
            marginTop: 8, padding: '8px 10px',
            background: 'rgba(255,255,255,0.7)',
            borderRadius: 8, fontSize: 12, color: '#1a1a1f',
            lineHeight: 1.4,
          }}>
            {session.attention}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <BigBtn bg="#1a9d4a" label="Yes" hint="⌘Y"/>
        <BigBtn bg="#c93030" label="No" hint="⌘N"/>
        <BigBtn bg="#2a6fd8" label="Always" hint="⌘A"/>
      </div>
    </div>
  );
}

function CalmHeader({ count, proc }) {
  return (
    <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8,
        background: 'linear-gradient(135deg, #0a6a8a, #0a3a5a)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <CreatureC kind="claudecode" size={18} color="#9ad8f0"/>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>All calm</div>
        <div style={{ fontSize: 10, color: '#7a7a82' }}>
          {count} session{count !== 1 ? 's' : ''}{proc > 0 ? ` · ${proc} active` : ''}
        </div>
      </div>
      <div style={{
        fontSize: 10, color: '#52D988', padding: '3px 8px',
        background: 'rgba(82,217,136,0.12)', borderRadius: 10, fontFamily: 'ui-monospace, monospace',
      }}>● :9120</div>
    </div>
  );
}

function DockChip({ session, featured }) {
  const { AGENTS, STATE_COLOR } = window.AD;
  const a = AGENTS[session.agent];
  const color = STATE_COLOR[session.state];
  return (
    <div style={{
      flexShrink: 0, width: 62, padding: '6px 4px',
      borderRadius: 8, textAlign: 'center', cursor: 'pointer',
      background: featured ? 'rgba(255,169,61,0.15)' : 'rgba(0,0,0,0.03)',
      border: featured ? '0.5px solid rgba(255,169,61,0.4)' : '0.5px solid transparent',
      position: 'relative',
    }}>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <CreatureC kind={a.creature} size={28} color={a.color} animate state={session.state}/>
        <div style={{
          position: 'absolute', top: -2, right: -4,
          width: 8, height: 8, borderRadius: '50%', background: color,
          border: '1.5px solid #f6f3ee',
          boxShadow: `0 0 4px ${color}`,
        }}/>
      </div>
      <div style={{
        fontSize: 9, color: '#4a4a52', marginTop: 2,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{session.project}</div>
    </div>
  );
}

function LaunchChip() {
  return (
    <div style={{
      flexShrink: 0, width: 62, padding: '6px 4px',
      borderRadius: 8, textAlign: 'center', cursor: 'pointer',
      border: '0.5px dashed rgba(0,0,0,0.2)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      color: '#7a7a82',
    }}>
      <div style={{ fontSize: 20, lineHeight: 1, marginTop: 4 }}>+</div>
      <div style={{ fontSize: 9, marginTop: 2 }}>New</div>
    </div>
  );
}

function LabelC({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
      color: '#7a7a82', marginBottom: 6, marginTop: 4,
      textTransform: 'uppercase',
    }}>{children}</div>
  );
}

function RateRowC({ label, pct, resetIn, trend }) {
  const color = pct >= 90 ? '#c93030' : pct >= 70 ? '#d88930' : '#1a9d4a';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      <div style={{ width: 22, fontSize: 11, color: '#7a7a82', fontFamily: 'ui-monospace, monospace' }}>{label}</div>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ width: pct+'%', height: '100%', background: color }}/>
      </div>
      <div style={{ fontSize: 10, color, fontFamily: 'ui-monospace, monospace', width: 30, textAlign: 'right' }}>{pct}%</div>
      <div style={{ fontSize: 10, color: '#9a9aa2', width: 44, textAlign: 'right' }}>{resetIn}</div>
    </div>
  );
}

function ServiceCardC({ svc }) {
  const color = svc.status === 'ok' ? '#1a9d4a' : svc.status === 'warn' ? '#d88930' : '#c93030';
  return (
    <div style={{
      padding: '6px 8px',
      background: 'white',
      borderRadius: 6,
      border: '0.5px solid rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }}/>
        <div style={{ fontSize: 11, fontWeight: 600 }}>{svc.label}</div>
      </div>
      <div style={{ fontSize: 9.5, color: '#7a7a82', lineHeight: 1.3 }}>{svc.detail}</div>
    </div>
  );
}

function DeviceConstellation() {
  const { DEVICES } = window.AD;
  return (
    <div style={{
      background: 'white', borderRadius: 8, padding: 8,
      border: '0.5px solid rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {DEVICES.map(d => {
          const color = d.status === 'connected' ? '#1a9d4a' : d.status === 'reconnecting' ? '#d88930' : '#9a9aa2';
          return (
            <div key={d.kind} style={{
              padding: '6px 4px', textAlign: 'center', borderRadius: 6,
              background: 'rgba(0,0,0,0.02)',
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', background: color,
                margin: '0 auto 3px',
                animation: d.status === 'reconnecting' ? 'attnPulse 1.2s infinite' : 'none',
              }}/>
              <div style={{ fontSize: 9, color: '#4a4a52', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BigBtn({ bg, label, hint }) {
  return (
    <button style={{
      flex: 1, background: bg, color: 'white',
      border: 'none', borderRadius: 8,
      padding: '10px 8px',
      fontSize: 13, fontWeight: 600,
      fontFamily: 'inherit', cursor: 'pointer',
      boxShadow: `0 2px 6px ${bg}55`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
    }}>
      <span>{label}</span>
      <span style={{ fontSize: 9, opacity: 0.8, fontFamily: 'ui-monospace, monospace' }}>{hint}</span>
    </button>
  );
}

function PillBtn({ label, primary, icon }) {
  return (
    <button style={{
      background: primary ? '#1a1a1f' : 'rgba(0,0,0,0.05)',
      color: primary ? 'white' : '#1a1a1f',
      border: 'none', borderRadius: 14,
      padding: icon ? '6px 9px' : '5px 11px',
      fontSize: 11, fontWeight: 500,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'inherit', cursor: 'pointer',
    }}>{icon || label}</button>
  );
}

window.OptionC = OptionC;
