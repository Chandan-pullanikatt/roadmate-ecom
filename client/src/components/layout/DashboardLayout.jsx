import React, { useState, useCallback } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
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
    </div>
  );
};

export default DashboardLayout;
