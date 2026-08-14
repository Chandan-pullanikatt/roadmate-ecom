import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ChevronDown, ChevronUp, LogIn, AlertCircle } from 'lucide-react';
import { loginUser } from '../utils/api';

const DEMO_ACCOUNTS = [
  { role: 'Master Admin',       email: 'master@roadmate.com'       },
  { role: 'State Partner',      email: 'state@roadmate.com'        },
  { role: 'Industry State',     email: 'indstate@roadmate.com'     },
  { role: 'District Partner',   email: 'district@roadmate.com'     },
  { role: 'Regional Partner',   email: 'regional@roadmate.com'     },
  { role: 'Manufacturer',       email: 'manufacturer@roadmate.com' },
  { role: 'Distributor',        email: 'distributor@roadmate.com'  },
];

const ROLE_TO_PATH = {
  MASTER:       '/master',
  STATE:        '/state',
  IND_STATE:    '/industry-state',
  DISTRICT:     '/district',
  REGIONAL:     '/regional',
  MANUFACTURER: '/manufacturer',
  DISTRIBUTOR:  '/distributor',
};

const Login = ({ onLogin }) => {
  const navigate = useNavigate();

  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [showPwd,     setShowPwd]     = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [showDemo,    setShowDemo]    = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setError('');
    setLoading(true);
    try {
      const data = await loginUser(email.trim().toLowerCase(), password);
      const role = data.user.role;
      onLogin(role);
      navigate(ROLE_TO_PATH[role] || '/');
    } catch (err) {
      setError(
        err.response?.data?.message ||
        'Invalid email or password. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (demoEmail) => {
    setEmail(demoEmail);
    setPassword('password123');
    setError('');
  };

  /* ─── Inline styles (keeps parity with the rest of the project) ─── */
  const s = {
    page: {
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      minHeight: '100vh', width: '100vw',
      background: 'radial-gradient(circle at 10% 20%, #FDF8E3 0%, var(--bg) 90.1%)',
      padding: '40px 20px', boxSizing: 'border-box',
    },
    card: {
      background: '#FFFFFF', border: '1px solid #E6E5E1',
      borderRadius: '20px', boxShadow: '0 20px 50px rgba(0,0,0,0.08)',
      width: '860px', maxWidth: '100%', overflow: 'hidden',
      display: 'grid', gridTemplateColumns: '1.2fr 1.8fr',
    },
    banner: {
      background: 'linear-gradient(135deg, var(--panel-from), var(--panel-to))',
      padding: '40px', color: 'var(--on-panel)',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      minHeight: '420px',
    },
    // 16:9 and `contain`, not `cover`: the asset is a wordmark, and `cover` on a
    // 2.3:1 box was cropping the ends off it. The yellow behind it is the same
    // yellow the artwork sits on, so `contain` on a box a pixel off ratio shows
    // more logo rather than a hairline of panel charcoal down one edge.
    logo: {
      display: 'block', width: '174px', height: '98px', objectFit: 'contain',
      objectPosition: 'center', background: 'var(--accent)',
      borderRadius: '12px', marginBottom: '20px',
      boxShadow: '0 8px 18px rgba(0,0,0,0.24)',
    },
    mobileBrand: {
      display: 'none', marginBottom: '26px', alignItems: 'center', gap: '12px',
    },
    mobileLogo: {
      display: 'block', width: '122px', height: '69px', objectFit: 'contain',
      objectPosition: 'center', background: 'var(--accent)',
      borderRadius: '10px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    },
    formPanel: {
      padding: '44px 40px', display: 'flex', flexDirection: 'column',
      justifyContent: 'center',
    },
    label: {
      display: 'block', fontSize: '12px', fontWeight: '600',
      color: '#4B4A44', marginBottom: '6px', letterSpacing: '0.02em',
    },
    input: {
      width: '100%', padding: '10px 13px', fontSize: '14px',
      border: '1px solid #D9D8D3', borderRadius: '10px',
      outline: 'none', boxSizing: 'border-box',
      background: '#FAFAF8', color: '#1A1A18',
      transition: 'border-color 0.15s',
    },
    pwdWrap: { position: 'relative' },
    eyeBtn: {
      position: 'absolute', right: '12px', top: '50%',
      transform: 'translateY(-50%)',
      background: 'none', border: 'none', cursor: 'pointer',
      color: '#9B9A94', padding: '2px', display: 'flex',
    },
    errorBox: {
      display: 'flex', alignItems: 'flex-start', gap: '8px',
      background: '#FEF2F2', border: '1px solid #FECACA',
      borderRadius: '10px', padding: '10px 13px',
      color: '#B91C1C', fontSize: '13px', marginBottom: '18px',
    },
    submitBtn: {
      width: '100%', padding: '11px', borderRadius: '10px',
      border: 'none', cursor: 'pointer',
      background: loading ? 'var(--accent-dim)' : 'var(--accent)',
      color: 'var(--on-accent)', fontWeight: '600', fontSize: '14.5px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: '8px', transition: 'background 0.15s',
    },
    demoToggle: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      cursor: 'pointer', padding: '10px 13px',
      background: '#F5F4F0', borderRadius: '10px', marginTop: '20px',
      border: '1px solid #E6E5E1', userSelect: 'none',
    },
    demoGrid: {
      display: 'grid', gridTemplateColumns: '1fr 1fr',
      gap: '6px', marginTop: '8px',
    },
    demoItem: {
      padding: '8px 11px', borderRadius: '8px',
      border: '1px solid #E6E5E1', cursor: 'pointer',
      background: '#FAFAF8', transition: 'all 0.12s',
    },
  };

  return (
    <div style={s.page}>
      <div style={s.card} className="login-card-layout">

        {/* ── Left: Branding ── */}
        <div style={s.banner} className="login-banner">
          <div>
            <img src="/roadmatelogo.jpeg" alt="RoadMate" style={s.logo} />
            {/* The muted token rather than white-at-opacity: --on-panel-muted is
                picked to sit on this panel, and 50%-white over the dark end of
                the gradient lands under 4.5:1 at 11px. */}
            <p style={{ color: 'var(--on-panel-muted)', fontSize: '13px', marginTop: '6px' }}>
              Multi-Industry B2B2C Quick Commerce System
            </p>
          </div>
          <div>
            <p style={{ fontSize: '12px', color: 'var(--on-panel-muted)' }}>Secure Partner Gateway</p>
            <p style={{ fontSize: '11px', color: 'var(--on-panel-muted)', opacity: 0.75, marginTop: '2px' }}>
              Authorized Personnel Only &copy; 2026
            </p>
          </div>
        </div>

        {/* ── Right: Form ── */}
        <div style={s.formPanel}>
          <div style={s.mobileBrand} className="login-mobile-brand">
            <img src="/roadmatelogo.jpeg" alt="RoadMate" style={s.mobileLogo} />
            <span style={{ color: '#1A1A18', fontSize: '13px', fontWeight: '600' }}>Partner Portal</span>
          </div>
          <h2 style={{ fontSize: '21px', fontWeight: '600', letterSpacing: '-0.3px', color: '#1A1A18', marginBottom: '4px' }}>
            Welcome Back
          </h2>
          <p style={{ color: '#6B6A64', fontSize: '13px', marginBottom: '28px' }}>
            Sign in to access your dashboard.
          </p>

          <form onSubmit={handleSubmit} noValidate>
            {/* Email */}
            <div style={{ marginBottom: '16px' }}>
              <label style={s.label} htmlFor="rm-email">Email address</label>
              <input
                id="rm-email"
                type="email"
                autoComplete="email"
                placeholder="you@roadmate.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                style={s.input}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                onBlur={(e)  => e.target.style.borderColor = '#D9D8D3'}
                required
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: '22px' }}>
              <label style={s.label} htmlFor="rm-password">Password</label>
              <div style={s.pwdWrap}>
                <input
                  id="rm-password"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  style={{ ...s.input, paddingRight: '40px' }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                  onBlur={(e)  => e.target.style.borderColor = '#D9D8D3'}
                  required
                />
                <button
                  type="button"
                  style={s.eyeBtn}
                  onClick={() => setShowPwd(p => !p)}
                  tabIndex={-1}
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                >
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={s.errorBox}>
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              style={s.submitBtn}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = 'var(--accent-hover)'; }}
              onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = 'var(--accent)'; }}
            >
              {loading ? (
                <>
                  <span style={{
                    width: '14px', height: '14px', borderRadius: '50%',
                    border: '2px solid rgba(26,26,24,0.25)',
                    borderTopColor: 'var(--on-accent)', animation: 'rm-spin 0.7s linear infinite',
                    display: 'inline-block',
                  }} />
                  Signing in…
                </>
              ) : (
                <>
                  <LogIn size={16} />
                  Sign In
                </>
              )}
            </button>
          </form>

          {/* ── Demo Accounts (collapsible) ── */}
          <div
            style={s.demoToggle}
            onClick={() => setShowDemo(p => !p)}
            role="button"
            aria-expanded={showDemo}
          >
            <span style={{ fontSize: '12px', fontWeight: '600', color: '#4B4A44' }}>
              Demo Accounts
            </span>
            {showDemo
              ? <ChevronUp size={14} color="#9B9A94" />
              : <ChevronDown size={14} color="#9B9A94" />
            }
          </div>

          {showDemo && (
            <>
              <p style={{ fontSize: '11px', color: '#9B9A94', margin: '8px 0 6px', paddingLeft: '2px' }}>
                Password for all accounts: <strong style={{ color: '#4B4A44' }}>password123</strong>
                &nbsp;· Click any row to fill the form.
              </p>
              <div style={s.demoGrid}>
                {DEMO_ACCOUNTS.map((acc) => (
                  <div
                    key={acc.email}
                    style={s.demoItem}
                    onClick={() => fillDemo(acc.email)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--accent)';
                      e.currentTarget.style.background  = 'var(--accent-soft)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#E6E5E1';
                      e.currentTarget.style.background  = '#FAFAF8';
                    }}
                  >
                    <p style={{ fontSize: '11.5px', fontWeight: '600', color: '#1A1A18', margin: 0 }}>
                      {acc.role}
                    </p>
                    <p style={{ fontSize: '10.5px', color: '#6B6A64', margin: '2px 0 0', wordBreak: 'break-all' }}>
                      {acc.email}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

      </div>

      {/* Spinner keyframe */}
      <style>{`
        @keyframes rm-spin {
          to { transform: rotate(360deg); }
        }
        @media (max-width: 640px) {
          .login-card-layout { grid-template-columns: 1fr !important; }
          .login-banner { display: none !important; }
          .login-mobile-brand { display: flex !important; }
        }
      `}</style>
    </div>
  );
};

export default Login;
