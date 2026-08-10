import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Shown above a dashboard whose data failed to load.
 *
 * It sits *above* the stat cards rather than replacing them, because a portal
 * that blanks itself on a transient error is worse than one that admits the
 * numbers are stale. The point is only that nobody reads 0 as a fact when it
 * is really an unanswered request.
 */
const ErrorBanner = ({ title, detail, onRetry }) => (
  <div
    role="alert"
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
      padding: '14px 16px',
      marginBottom: '20px',
      border: '1px solid #fca5a5',
      borderLeft: '4px solid #dc2626',
      borderRadius: '8px',
      background: '#fef2f2'
    }}
  >
    <AlertTriangle size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: '2px' }} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <p style={{ margin: 0, fontWeight: 600, color: '#991b1b' }}>{title}</p>
      {detail && (
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#7f1d1d', lineHeight: 1.5 }}>
          {detail}
        </p>
      )}
    </div>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          border: '1px solid #dc2626',
          borderRadius: '6px',
          background: 'transparent',
          color: '#991b1b',
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer',
          flexShrink: 0
        }}
      >
        <RefreshCw size={14} />
        Retry
      </button>
    )}
  </div>
);

export default ErrorBanner;
