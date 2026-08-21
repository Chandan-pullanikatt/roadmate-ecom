import React, { useState, useCallback } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import EditNameModal from '../EditNameModal';
import { roleDetails } from '../../utils/sidebarConfig';

const DashboardLayout = ({ 
  role = "MASTER", 
  badges = {}, 
  onLogout,
  title,
  subtitle,
  locationChain,
  actionButton,
  showSearch = true,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  children 
}) => {
  const userDetails = roleDetails[role] || { name: "User", role: "Partner", themeClass: "theme-master" };
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // The signed-in user's own display name, editable from the sidebar's user card
  // by all seven roles. It is held here rather than in `Sidebar` because the
  // modal has to render outside the sidebar's transformed subtree (see the note
  // in `Sidebar.jsx`), and one owner for the name and the modal is simpler than
  // two.
  //
  // Seeded from the stored session and kept in state so a rename appears at once
  // — `updateMyName` has already rewritten `roadmate_user`, so a reload agrees.
  const activeUser = JSON.parse(localStorage.getItem('roadmate_user') || 'null');
  const [displayName, setDisplayName] = useState(
    (activeUser && activeUser.name) || userDetails.name
  );
  const [isEditNameOpen, setIsEditNameOpen] = useState(false);

  const toggleMobileSidebar = useCallback(() => {
    setIsMobileSidebarOpen(prev => !prev);
  }, []);

  const closeMobileSidebar = useCallback(() => {
    setIsMobileSidebarOpen(false);
  }, []);

  return (
    <div className={`app-wrapper ${userDetails.themeClass}`} style={{ display: 'flex', width: '100%', minHeight: '100vh' }}>
      {/* Mobile sidebar overlay */}
      <div 
        className={`sidebar-overlay ${isMobileSidebarOpen ? 'visible' : ''}`} 
        onClick={closeMobileSidebar}
      />

      {/* Dynamic Sidebar */}
      <Sidebar
        role={role}
        badges={badges}
        onLogout={onLogout}
        isOpen={isMobileSidebarOpen}
        onNavClick={closeMobileSidebar}
        displayName={displayName}
        onEditName={() => {
          // On mobile the card is only reachable with the drawer open, and the
          // drawer would otherwise sit on top of the modal it just opened.
          closeMobileSidebar();
          setIsEditNameOpen(true);
        }}
      />
      
      {/* Main Panel Content Area */}
      <div className="main">
        {title && (
          <Header 
            title={title}
            subtitle={subtitle}
            locationChain={locationChain}
            actionButton={actionButton}
            showSearch={showSearch}
            searchValue={searchValue}
            onSearchChange={onSearchChange}
            searchPlaceholder={searchPlaceholder}
            onHamburgerClick={toggleMobileSidebar}
          />
        )}
        {children}
      </div>

      {/* Outside `Sidebar` on purpose — see the note on the `displayName` state. */}
      <EditNameModal
        isOpen={isEditNameOpen}
        currentName={displayName}
        onClose={() => setIsEditNameOpen(false)}
        onSaved={setDisplayName}
      />
    </div>
  );
};

export default DashboardLayout;
