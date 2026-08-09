/*
 * Platform Settings — the Master-only screen for every tunable number.
 *
 * WHY THIS EXISTS: all of these values already lived in `PlatformConfig` and
 * were already read through `getConfigNumber()`, so the platform was tunable in
 * principle. In practice each one needed a developer running a script, which
 * made every commercial answer the client gave ("set it from the dashboard at
 * the end") undeliverable. This is that dashboard.
 *
 * Three things it is careful about:
 *
 *  · **Blank is not zero.** An empty field CLEARS the setting and the platform
 *    falls back to what is behind it — an industry override to the global row,
 *    the global row to the code's documented default. A 0 is a decision ("this
 *    is free"); a blank is the absence of one ("nobody has said"). The
 *    manufacturer's subscription fee is blank for exactly that reason.
 *  · **Nothing is retroactive.** A delivered order's commission split and a
 *    delivered job's rider pay are frozen columns. Changing a rate here changes
 *    what happens next; it never reprices what already happened. The screen says
 *    so, because that is the first thing anyone editing a commission rate wonders.
 *  · **The screen does not know what the keys are.** Labels, groups, units and
 *    help text all come from the server (`CONFIG_META`), so a new tunable number
 *    appears here with no change to this file.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Save, RotateCcw, X, AlertTriangle } from 'lucide-react';
import { getPlatformConfig, savePlatformConfig, clearPlatformConfig } from '../utils/api';

/* A stable identity for one editable field — the global row, or one override. */
const fieldId = (key, industryId) => `${key}::${industryId ?? 'global'}`;

const displayValue = (v) => (v === null || v === undefined ? '' : String(v));

export default function PlatformSettings() {
  const [groups, setGroups] = useState([]);
  const [industries, setIndustries] = useState([]);
  const [drafts, setDrafts] = useState({});     // fieldId -> string the user typed
  const [expanded, setExpanded] = useState({}); // key -> bool, per-industry panel
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await getPlatformConfig();
      setGroups(data.groups || []);
      setIndustries(data.industries || []);
      setDrafts({});
      setError('');
    } catch {
      setError('Could not load platform settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const allKeys = useMemo(() => groups.flatMap((g) => g.keys), [groups]);

  /* The saved value a field started from, so an edit back to it is not an edit. */
  const savedValueFor = (key, industryId) => {
    const entry = allKeys.find((k) => k.key === key);
    if (!entry) return '';
    if (industryId == null) return displayValue(entry.value);
    const override = entry.overrides.find((o) => o.industryId === industryId);
    return displayValue(override ? override.value : null);
  };

  const valueFor = (key, industryId) => {
    const id = fieldId(key, industryId);
    return id in drafts ? drafts[id] : savedValueFor(key, industryId);
  };

  const setDraft = (key, industryId, next) => {
    const id = fieldId(key, industryId);
    setSaved('');
    setDrafts((prev) => {
      const copy = { ...prev };
      if (next === savedValueFor(key, industryId)) delete copy[id]; // typed back to where it was
      else copy[id] = next;
      return copy;
    });
  };

  const pendingEdits = Object.entries(drafts).map(([id, value]) => {
    const [key, scope] = id.split('::');
    return { key, industryId: scope === 'global' ? null : Number(scope), value };
  });

  const invalid = pendingEdits.filter((e) => e.value !== '' && !Number.isFinite(Number(e.value)));

  const handleSave = async () => {
    if (!pendingEdits.length || invalid.length) return;
    setSaving(true);
    setError('');
    try {
      await savePlatformConfig(pendingEdits);
      setSaved(`${pendingEdits.length} setting${pendingEdits.length === 1 ? '' : 's'} saved.`);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save those settings.');
    } finally {
      setSaving(false);
    }
  };

  /* Remove an override row outright, rather than blanking it in place. */
  const handleClearOverride = async (key, industryId) => {
    setSaving(true);
    try {
      await clearPlatformConfig(key, industryId);
      await load();
    } catch {
      setError('Could not clear that override.');
    } finally {
      setSaving(false);
    }
  };

  const addOverride = (key, industryId) => {
    if (!industryId) return;
    // Seeds an empty draft row; it becomes real when Save is pressed with a value.
    setDrafts((prev) => ({ ...prev, [fieldId(key, industryId)]: '' }));
    setExpanded((prev) => ({ ...prev, [key]: true }));
  };

  if (loading) {
    return <div className="card full-col"><div className="card-body">Loading platform settings…</div></div>;
  }

  const dirty = pendingEdits.length > 0;

  return (
    <div className="full-col" style={{ paddingBottom: dirty ? '72px' : 0 }}>
      {/* The one thing anyone editing a commission rate needs to be told. */}
      <div style={{
        display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '12px 14px',
        background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', marginBottom: '16px'
      }}>
        <AlertTriangle size={16} style={{ color: '#B45309', flexShrink: 0, marginTop: '1px' }} />
        <div style={{ fontSize: '12px', color: '#92400E', lineHeight: 1.5 }}>
          Changes apply to <strong>what happens next</strong>. Orders already delivered keep the
          commission split and rider pay they were settled at — nothing here rewrites them.
          Leaving a field <strong>blank clears it</strong>, which is not the same as entering 0:
          blank means nobody has decided, 0 means it costs nothing.
        </div>
      </div>

      {error ? (
        <div style={{
          padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA',
          borderRadius: '10px', color: '#B91C1C', fontSize: '12px', marginBottom: '16px'
        }}>{error}</div>
      ) : null}

      {saved ? (
        <div style={{
          padding: '10px 14px', background: '#ECFDF5', border: '1px solid #A7F3D0',
          borderRadius: '10px', color: '#065F46', fontSize: '12px', marginBottom: '16px'
        }}>{saved}</div>
      ) : null}

      {groups.map((group) => (
        <div className="card" key={group.name} style={{ marginBottom: '16px' }}>
          <div className="card-header">
            <div>
              <h2 className="section-title">{group.name}</h2>
            </div>
          </div>
          <div className="card-body">
            {group.keys.map((entry) => {
              const raw = valueFor(entry.key, null);
              const bad = raw !== '' && !Number.isFinite(Number(raw));
              const overrides = entry.overrides.map((o) => o.industryId);
              const drafted = Object.keys(drafts)
                .filter((id) => id.startsWith(`${entry.key}::`) && !id.endsWith('::global'))
                .map((id) => Number(id.split('::')[1]));
              const shown = [...new Set([...overrides, ...drafted])];
              const available = industries.filter((i) => !shown.includes(i.id));

              return (
                <div key={entry.key} style={{
                  padding: '14px 0', borderBottom: '1px solid var(--border, #EEF0F4)'
                }}>
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 320px', minWidth: '240px' }}>
                      <label className="form-label" style={{ marginBottom: '2px' }}>{entry.label}</label>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>
                        {entry.key}
                      </div>
                      {entry.help ? (
                        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '5px', lineHeight: 1.5 }}>
                          {entry.help}
                        </div>
                      ) : null}
                    </div>

                    <div style={{ flex: '0 0 240px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {entry.unit === '₹' ? <span style={{ color: 'var(--text-muted)' }}>₹</span> : null}
                        <input
                          className="form-input"
                          inputMode="decimal"
                          value={raw}
                          placeholder={entry.hasDefault ? String(entry.default) : 'not set'}
                          onChange={(e) => setDraft(entry.key, null, e.target.value)}
                          style={{ borderColor: bad ? '#F87171' : undefined }}
                        />
                        {entry.unit && entry.unit !== '₹'
                          ? <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{entry.unit}</span>
                          : null}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        {bad
                          ? <span style={{ color: '#B91C1C' }}>Must be a number.</span>
                          : entry.isSet
                            ? 'Set on this platform'
                            : entry.hasDefault
                              ? `Not set — the platform uses ${entry.default}`
                              : 'Not set, and no default. Shown as “—” everywhere.'}
                      </div>
                    </div>
                  </div>

                  {entry.perIndustry ? (
                    <div style={{ marginTop: '10px' }}>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => setExpanded((p) => ({ ...p, [entry.key]: !p[entry.key] }))}
                      >
                        Per-industry {shown.length ? `(${shown.length})` : ''}
                      </button>

                      {expanded[entry.key] ? (
                        <div style={{ marginTop: '10px', paddingLeft: '12px', borderLeft: '2px solid #EEF0F4' }}>
                          {shown.length === 0 ? (
                            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                              No overrides — every industry uses the value above.
                            </div>
                          ) : null}

                          {shown.map((industryId) => {
                            const industry = industries.find((i) => i.id === industryId);
                            const overrideRaw = valueFor(entry.key, industryId);
                            return (
                              <div key={industryId} style={{
                                display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px'
                              }}>
                                <div style={{ flex: '1 1 200px', fontSize: '12.5px' }}>
                                  {industry?.name ?? `Industry ${industryId}`}
                                </div>
                                <input
                                  className="form-input"
                                  inputMode="decimal"
                                  style={{ flex: '0 0 140px' }}
                                  value={overrideRaw}
                                  placeholder="inherits"
                                  onChange={(e) => setDraft(entry.key, industryId, e.target.value)}
                                />
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  title="Remove this override — the industry goes back to the value above"
                                  onClick={() => handleClearOverride(entry.key, industryId)}
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            );
                          })}

                          {available.length ? (
                            <select
                              className="form-select"
                              value=""
                              style={{ maxWidth: '260px' }}
                              onChange={(e) => addOverride(entry.key, Number(e.target.value))}
                            >
                              <option value="">+ Add an industry override…</option>
                              {available.map((i) => (
                                <option key={i.id} value={i.id}>{i.name}</option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* One save for the whole screen: these are independent settings and a
          per-row save button would mean ten round trips to price a launch. */}
      {dirty ? (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30,
          background: '#fff', borderTop: '1px solid #E5E7EB', padding: '12px 20px',
          display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'flex-end',
          boxShadow: '0 -4px 16px rgba(0,0,0,0.06)'
        }}>
          <div style={{ marginRight: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>
            {pendingEdits.length} unsaved change{pendingEdits.length === 1 ? '' : 's'}
            {invalid.length ? <span style={{ color: '#B91C1C' }}> · {invalid.length} not a number</span> : null}
          </div>
          <button type="button" className="btn btn-outline" onClick={() => setDrafts({})} disabled={saving}>
            <RotateCcw size={14} /> Discard
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || invalid.length > 0}
          >
            <Save size={14} /> {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
