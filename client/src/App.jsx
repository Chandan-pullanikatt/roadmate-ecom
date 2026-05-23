import React, { useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import MasterDashboard from './pages/MasterDashboard';
import StateDashboard from './pages/StateDashboard';
import IndustryStateDashboard from './pages/IndustryStateDashboard';
import DistrictDashboard from './pages/DistrictDashboard';
import RegionalDashboard from './pages/RegionalDashboard';
import ManufacturerDashboard from './pages/ManufacturerDashboard';
import DistributorDashboard from './pages/DistributorDashboard';
import './styles/global.css';

// Map role keys to their URL path prefixes
const roleToPath = {
  MASTER: '/master',
  STATE: '/state',
  IND_STATE: '/industry-state',
  DISTRICT: '/district',
  REGIONAL: '/regional',
  MANUFACTURER: '/manufacturer',
  DISTRIBUTOR: '/distributor'
};

function App() {
  const [currentRole, setCurrentRole] = useState(localStorage.getItem('roadmate_role') || null);

  const handleLogin = (role) => {
    setCurrentRole(role);
    localStorage.setItem('roadmate_role', role);
  };

  const handleLogout = () => {
    setCurrentRole(null);
    localStorage.removeItem('roadmate_role');
    localStorage.removeItem('roadmate_token');
    localStorage.removeItem('roadmate_user');
  };

  return (
    <Router>
      <Routes>
        {/* Public Login Route */}
        <Route 
          path="/" 
          element={
            currentRole ? (
              <Navigate to={roleToPath[currentRole] || '/'} replace />
            ) : (
              <Login onLogin={handleLogin} />
            )
          } 
        />

        {/* Dashboard Routes */}
        <Route 
          path="/master/*" 
          element={
            currentRole === "MASTER" ? (
              <MasterDashboard onLogout={handleLogout} />
            ) : (
              <Navigate to="/" replace />
            )
          } 
        />

        <Route 
          path="/state/*" 
          element={
            currentRole === "STATE" ? (
              <StateDashboard onLogout={handleLogout} />
            ) : (
              <Navigate to="/" replace />
            )
          } 
        />

        <Route 
          path="/industry-state/*" 
          element={
            currentRole === "IND_STATE" ? (
              <IndustryStateDashboard onLogout={handleLogout} />
            ) : (
              <Navigate to="/" replace />
            )
          } 
        />

        <Route 
          path="/district/*" 
          element={
            currentRole === "DISTRICT" ? (
              <DistrictDashboard onLogout={handleLogout} />
            ) : (
              <Navigate to="/" replace />
            )
          } 
        />

        <Route 
          path="/regional/*" 
          element={
            currentRole === "REGIONAL" ? (
              <RegionalDashboard onLogout={handleLogout} />
            ) : (
              <Navigate to="/" replace />
            )
          } 
        />

        <Route 
          path="/manufacturer/*" 
          element={
            currentRole === "MANUFACTURER" ? (
              <ManufacturerDashboard onLogout={handleLogout} />
            ) : (
              <Navigate to="/" replace />
            )
          } 
        />

        <Route 
          path="/distributor/*" 
          element={
            currentRole === "DISTRIBUTOR" ? (
              <DistributorDashboard onLogout={handleLogout} />
            ) : (
              <Navigate to="/" replace />
            )
          } 
        />

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
