import React from 'react';
import { NavLink } from 'react-router-dom';
import { LogOut, Pencil } from 'lucide-react';
import { sidebarConfig, roleDetails } from '../../utils/sidebarConfig';

// `displayName` and `onEditName` come from `DashboardLayout`, which owns both.
// The name is *rendered* here and edited from here, but the modal cannot live
// here: on mobile `.sidebar` carries `transform: translateX(-100%)`, and a
// transformed ancestor is a containing block for `position: fixed` — the modal
// would slide off-screen with the drawer it was opened from.
const Sidebar = ({
  role = "MASTER",
  badges = {},
  onLogout,
  isOpen = false,
  onNavClick,
  displayName: displayNameProp,
  onEditName
}) => {
  const sections = sidebarConfig[role] || [];
  const userDetails = roleDetails[role] || { name: "User", role: "Partner", themeClass: "theme-master" };
  const activeUser = JSON.parse(localStorage.getItem('roadmate_user') || 'null');
  const displayName = displayNameProp || (activeUser ? activeUser.name : userDetails.name);

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
          <div>
            <img className="roadmate-sidebar-logo" src="/roadmatelogo.jpeg" alt="RoadMate" />
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
          {/* Inside a card whose own click logs you out, so the click must stop
              here — otherwise editing your name ends your session. */}
          <button
            type="button"
            title="Change display name"
            aria-label="Change display name"
            onClick={(e) => {
              e.stopPropagation();
              onEditName?.();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '4px',
              border: 'none',
              borderRadius: '4px',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              opacity: 0.5,
              flexShrink: 0
            }}
          >
            <Pencil size={14} />
          </button>
          <LogOut size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
