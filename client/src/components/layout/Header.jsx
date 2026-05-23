import React from 'react';
import { Bell, Search, HelpCircle, Menu } from 'lucide-react';

const Header = ({ 
  title, 
  subtitle, 
  showSearch = true, 
  searchValue = "", 
  onSearchChange,
  searchPlaceholder = "Search...",
  actionButton,
  locationChain, // array of { type: 'state' | 'ind' | 'dist' | 'region', label: string }
  onHamburgerClick
}) => {
  return (
    <div className="header">
      {/* Hamburger Menu (visible on mobile only via CSS) */}
      <button className="hamburger-btn" onClick={onHamburgerClick} title="Toggle Menu">
        <Menu size={18} style={{ opacity: 0.7 }} />
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 className="header-title">{title}</h1>
          {locationChain && locationChain.length > 0 && (
            <div className="loc-chain">
              {locationChain.map((loc, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="loc-sep">/</span>}
                  <span className={`loc-pill ${loc.type}`}>
                    {loc.label}
                  </span>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
        {subtitle && <p className="header-sub">{subtitle}</p>}
      </div>

      {showSearch && (
        <div className="search-bar">
          <Search size={16} style={{ opacity: 0.5 }} />
          <input 
            type="text" 
            placeholder={searchPlaceholder} 
            value={searchValue}
            onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
          />
        </div>
      )}

      <button className="icon-btn" title="Help & Support">
        <HelpCircle size={18} style={{ opacity: 0.7 }} />
      </button>

      <button className="icon-btn" title="Notifications">
        <Bell size={18} style={{ opacity: 0.7 }} />
        <span className="notif-dot"></span>
      </button>

      {actionButton && (
        <div style={{ marginLeft: '6px' }}>
          {actionButton}
        </div>
      )}
    </div>
  );
};

export default Header;
