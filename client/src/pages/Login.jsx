import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ShieldAlert, 
  Map, 
  Layers, 
  FolderTree, 
  MapPin, 
  Building2, 
  Truck 
} from 'lucide-react';

const Login = ({ onLogin }) => {
  const navigate = useNavigate();

  const demoAccounts = [
    { role: "MASTER", label: "Master Admin Dashboard", desc: "National Ecosystem & Finance Control", icon: ShieldAlert, color: "#1C6A4E", badge: "Level 1" },
    { role: "STATE", label: "State Partner Dashboard", desc: "State-wide Expansion & Approvals", icon: Map, color: "#2563EB", badge: "Level 2" },
    { role: "IND_STATE", label: "Industry State Dashboard", desc: "Single Industry State Hub Management", icon: Layers, color: "#7C3AED", badge: "Level 3" },
    { role: "DISTRICT", label: "District Partner Dashboard", desc: "District Logistics & Distributors Creation", icon: FolderTree, color: "#0891B2", badge: "Level 4" },
    { role: "REGIONAL", label: "Regional Partner Dashboard", desc: "Field Force & Retail Shop Listing", icon: MapPin, color: "#D97706", badge: "Level 5" },
    { role: "MANUFACTURER", label: "Manufacturer Dashboard", desc: "Product Listings & Distributor Networks", icon: Building2, color: "#7C3AED", badge: "Commercial" },
    { role: "DISTRIBUTOR", label: "Distributor Dashboard", desc: "Retail Orders Fulfillment & Warehousing", icon: Truck, color: "#2563EB", badge: "Commercial" },
  ];

  const handleSelectRole = async (role) => {
    try {
      // Map roles to their seeded emails
      let email = "master@roadmate.com";
      if (role === "STATE") email = "state@roadmate.com";
      if (role === "IND_STATE") email = "indstate@roadmate.com";
      if (role === "DISTRICT") email = "district@roadmate.com";
      if (role === "REGIONAL") email = "regional@roadmate.com";
      if (role === "MANUFACTURER") email = "manufacturer@roadmate.com";
      if (role === "DISTRIBUTOR") email = "distributor@roadmate.com";

      const { loginUser } = await import('../utils/api');
      await loginUser(email, "password123");

      onLogin(role);
      
      // Route to appropriate dashboard path
      switch (role) {
        case "MASTER": navigate("/master"); break;
        case "STATE": navigate("/state"); break;
        case "IND_STATE": navigate("/industry-state"); break;
        case "DISTRICT": navigate("/district"); break;
        case "REGIONAL": navigate("/regional"); break;
        case "MANUFACTURER": navigate("/manufacturer"); break;
        case "DISTRIBUTOR": navigate("/distributor"); break;
        default: navigate("/");
      }
    } catch (error) {
      console.error("Login failed, falling back to mock mode:", error);
      // Fallback to local session storage to guarantee dashboard continues rendering
      onLogin(role);
      switch (role) {
        case "MASTER": navigate("/master"); break;
        case "STATE": navigate("/state"); break;
        case "IND_STATE": navigate("/industry-state"); break;
        case "DISTRICT": navigate("/district"); break;
        case "REGIONAL": navigate("/regional"); break;
        case "MANUFACTURER": navigate("/manufacturer"); break;
        case "DISTRIBUTOR": navigate("/distributor"); break;
        default: navigate("/");
      }
    }
  };

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      width: '100vw',
      background: 'radial-gradient(circle at 10% 20%, rgb(239, 246, 255) 0%, rgb(247, 247, 245) 90.1%)',
      padding: '40px 20px',
      boxSizing: 'border-box'
    }}>
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #E6E5E1',
        borderRadius: '20px',
        boxShadow: '0 20px 50px rgba(0,0,0,0.08)',
        width: '900px',
        maxWidth: '100%',
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: '1.2fr 1.8fr'
      }} className="login-card-layout">
        
        {/* Left Side: Branding Banner */}
        <div style={{
          background: 'linear-gradient(135deg, #1C6A4E, #2D8F69)',
          padding: '40px',
          color: '#FFFFFF',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '400px'
        }} className="login-banner">
          <div>
            <div style={{
              width: '40px',
              height: '40px',
              background: 'rgba(255,255,255,0.2)',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: '700',
              fontSize: '18px',
              marginBottom: '20px'
            }}>RM</div>
            <h1 style={{ fontSize: '28px', fontWeight: '600', lineHeight: '1.2', letterSpacing: '-0.5px' }}>RoadMate</h1>
            <p style={{ opacity: 0.8, fontSize: '13px', marginTop: '6px' }}>Multi-Industry B2B2C E-Commerce System</p>
          </div>
          
          <div>
            <p style={{ fontSize: '12px', opacity: 0.7 }}>Secure Partner Gateway</p>
            <p style={{ fontSize: '11px', opacity: 0.5, marginTop: '2px' }}>Authorized Personnel Only &copy; 2026</p>
          </div>
        </div>

        {/* Right Side: Role Selector */}
        <div style={{ padding: '40px', overflowY: 'auto', maxHeight: '90vh' }}>
          <h2 style={{ fontSize: '20px', fontWeight: '600', letterSpacing: '-0.3px', color: '#1A1A18' }}>Welcome Back</h2>
          <p style={{ color: '#6B6A64', fontSize: '13px', marginTop: '4px', marginBottom: '24px' }}>
            Select your role to access your custom-branded dashboard and manage transactions.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {demoAccounts.map((account, idx) => {
              const IconComp = account.icon;
              return (
                <div 
                  key={idx} 
                  onClick={() => handleSelectRole(account.role)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '12px 16px',
                    border: '1px solid #E6E5E1',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    background: '#FFFFFF'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = account.color;
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.04)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#E6E5E1';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.transform = 'none';
                  }}
                >
                  <div style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: `${account.color}15`,
                    color: account.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <IconComp size={18} />
                  </div>
                  
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h4 style={{ fontSize: '13.5px', fontWeight: '500', color: '#1A1A18' }}>{account.label}</h4>
                      <span style={{ 
                        fontSize: '9px', 
                        fontWeight: '600', 
                        padding: '1px 5px', 
                        borderRadius: '20px', 
                        background: '#F2F1EE', 
                        color: '#6B6A64' 
                      }}>{account.badge}</span>
                    </div>
                    <p style={{ fontSize: '11.5px', color: '#9B9A94', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {account.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
};

export default Login;
