import React from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

const StatCard = ({
  label,
  value,
  delta,
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
          {isUp ? (
            <ArrowUpRight size={14} className="delta-up" />
          ) : (
            <ArrowDownRight size={14} className="delta-down" />
          )}
          <span className={`stat-delta ${isUp ? 'delta-up' : 'delta-down'}`}>
            {delta}
          </span>
        </div>
      )}
    </div>
  );
};

export default StatCard;
