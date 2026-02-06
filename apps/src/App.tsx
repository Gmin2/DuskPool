import React, { useState, useEffect } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import Header from './components/Header';
import Home from './components/Home';
import Trade from './components/Trade';
import Dashboard from './components/Dashboard';
import Escrow from './components/Escrow';
import History from './components/History';
import Markets from './components/Markets';
import Admin from './components/Admin';
import BackgroundEffects from './components/BackgroundEffects';
import Sidebar from './components/Sidebar';
import HUDFrame from './components/HUDFrame';
import NotFound from './components/NotFound';
import { useWallet } from './hooks/useWallet';

const App: React.FC = () => {
  const [isLoaded, setIsLoaded] = useState(false);
  const { isConnected } = useWallet();
  const location = useLocation();
  const navigate = useNavigate();

  const currentPath = location.pathname;

  useEffect(() => {
    const timer = setTimeout(() => setIsLoaded(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Navigate to dashboard when connected
  useEffect(() => {
    if (isConnected && currentPath === '/') {
      navigate('/dashboard');
    }
  }, [isConnected, currentPath, navigate]);

  // Determine if we're on the home page
  const isHomePage = currentPath === '/';

  return (
    <div className="relative w-full h-screen bg-black text-white overflow-hidden selection:bg-brand-stellar/30 selection:text-white">
      <BackgroundEffects />

      <HUDFrame />
      <div className={`h-full transition-opacity duration-1000 ease-out ${isLoaded ? 'opacity-100' : 'opacity-0'}`}>
        <Header currentPath={currentPath} />

        {/* Show Sidebar on all pages except home */}
        {!isHomePage && (
          <Sidebar
            currentPath={currentPath}
            isConnected={isConnected}
          />
        )}

        <main id="main-scroll-container" className={`relative z-10 h-full flex flex-col pt-14 overflow-auto ${!isHomePage ? 'ml-20 w-[calc(100%-5rem)]' : 'w-full'}`}>
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<Home />} />
            <Route path="/trade" element={<Trade />} />

            {/* Protected Routes (when connected) */}
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/escrow" element={<Escrow />} />
            <Route path="/history" element={<History />} />
            <Route path="/markets" element={<Markets />} />
            <Route path="/admin" element={<Admin />} />

            {/* 404 Page */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>

      {/* Subtle grain overlay for texture */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-[100] mix-blend-overlay"
           style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}>
      </div>
    </div>
  );
};

export default App;
