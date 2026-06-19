import React from 'react';
import { NavLink } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { sidebarConfig, roleDetails } from '../../utils/sidebarConfig';

const Sidebar = ({ role = "MASTER", badges = {}, onLogout, isOpen = false, onNavClick }) => {
  const sections = sidebarConfig[role] || [];
  const userDetails = roleDetails[role] || { name: "User", role: "Partner", themeClass: "theme-master" };
  const activeUser = JSON.parse(localStorage.getItem('roadmate_user') || 'null');
  const displayName = activeUser ? activeUser.name : userDetails.name;

  // Helper to render role badge
  const renderRoleBadge = () => {
    switch (role) {
      case "MASTER":
        return <span className="loc-pill state" style={{ marginTop: '6px' }}>Master Admin</span>;
      case "STATE":
        return <span className="loc-pill state" style={{ marginTop: '6px' }}>State Partner</span>;
      case "IND_STATE":
        return <span className="loc-pill ind" style={{ marginTop: '6px' }}>Industry Partner</span>;
      case "DISTRICT":
        return <span className="loc-pill dist" style={{ marginTop: '6px' }}>District Partner</span>;
      case "REGIONAL":
        return <span className="loc-pill region" style={{ marginTop: '6px' }}>Regional Partner</span>;
      case "MANUFACTURER":
        return <span className="loc-pill ind" style={{ marginTop: '6px' }}>Manufacturer</span>;
      case "DISTRIBUTOR":
        return <span className="loc-pill state" style={{ marginTop: '6px' }}>Distributor</span>;
      default:
        return null;
    }
  };

  // Helper to get initials
  const getInitials = (name) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  };

  // Build set of base dashboard hrefs for "end" matching
  const basePaths = ["/master", "/state", "/industry-state", "/district", "/regional", "/manufacturer", "/distributor"];

  return (
    <div className={`sidebar ${userDetails.themeClass} ${isOpen ? 'open' : ''}`}>
      <div className="sidebar-logo">
        <div className="logo-row">
          <div className="logo-mark">RM</div>
          <div>
            <h2 className="logo-text">RoadMate</h2>
            <p className="logo-sub">Quick Commerce Portal</p>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {renderRoleBadge()}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {sections.map((section, secIdx) => (
          <div key={secIdx} className="sidebar-section">
            <h3 className="sidebar-label">{section.section}</h3>
            {section.items.map((item, itemIdx) => {
              const Icon = item.icon;
              const badgeValue = item.badgeKey ? badges[item.badgeKey] : null;

              return (
                <NavLink 
                  key={itemIdx} 
                  to={item.href}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  end={basePaths.includes(item.href)}
                  onClick={onNavClick}
                >
                  <Icon className="icon" />
                  <span>{item.label}</span>
                  {badgeValue > 0 && (
                    <span className="nav-badge">{badgeValue}</span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="user-card" onClick={onLogout} title="Click to Log Out">
          <div className="avatar">
            {getInitials(displayName)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h4 className="user-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {displayName}
            </h4>
            <p className="user-role">{userDetails.role}</p>
          </div>
          <LogOut size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
