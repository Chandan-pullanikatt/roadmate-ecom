import React from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

const StatCard = ({
  label,
  value,
  delta,
  // `true` / `false` draw the up / down arrow. `null` means the delta is a
  // plain description of the number, not a movement — no arrow, no colour.
  isUp = true,
  color = "", // "green", "blue", "amber", "purple", "teal", "red"
  onClick,
  title
}) => {
  return (
    <div
      className={`stat-card ${color}`}
      onClick={onClick}
      title={title}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <p className="stat-label">{label}</p>
      <h3 className="stat-value">{value}</h3>
      {delta && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {isUp === null ? null : isUp ? (
            <ArrowUpRight size={14} className="delta-up" />
          ) : (
            <ArrowDownRight size={14} className="delta-down" />
          )}
          <span className={`stat-delta ${isUp === null ? '' : isUp ? 'delta-up' : 'delta-down'}`}>
            {delta}
          </span>
        </div>
      )}
    </div>
  );
};

export default StatCard;
