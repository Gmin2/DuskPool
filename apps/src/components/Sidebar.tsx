import React from 'react';
import { Link } from 'react-router-dom';
import { Home, BarChart2, Terminal, Wallet, History, Settings } from 'lucide-react';

interface SidebarProps {
  currentPath?: string;
  isConnected?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ currentPath = '/', isConnected = false }) => {

  const publicNavItems = [
    { label: 'HOME', path: '/', icon: Home },
    { label: 'TERMINAL', path: '/trade', icon: Terminal },
  ];

  const privateNavItems = [
    { label: 'DASHBOARD', path: '/dashboard', icon: Home },
    { label: 'TRADE', path: '/trade', icon: Terminal },
    { label: 'ASSETS', path: '/markets', icon: BarChart2 },
    { label: 'ESCROW', path: '/escrow', icon: Wallet },
    { label: 'HISTORY', path: '/history', icon: History },
    { label: 'ADMIN', path: '/admin', icon: Settings },
  ];

  const navItems = isConnected ? privateNavItems : publicNavItems;

  return (
    <aside className="fixed left-6 top-1/2 -translate-y-1/2 z-40 hidden lg:flex flex-col items-center gap-1">
      {/* Navigation Items */}
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = currentPath === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            className={`w-12 h-12 border flex items-center justify-center transition-colors group relative ${
              isActive
                ? 'border-brand-stellar/50 bg-brand-stellar/10'
                : 'border-white/10 hover:border-white/30'
            }`}
            title={item.label}
          >
            <Icon className={`w-4 h-4 ${isActive ? 'text-brand-stellar' : 'text-white/30 group-hover:text-white/60'}`} />
            {/* Tooltip */}
            <span className="absolute left-full ml-3 px-2 py-1 bg-black/80 border border-white/10 text-[10px] text-white uppercase tracking-wider whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              {item.label}
            </span>
          </Link>
        );
      })}

      {/* Divider */}
      <div className="w-[1px] h-6 bg-white/10 my-2"></div>

      {/* Decorative/Status indicator */}
      <div className="w-12 h-12 border border-white/10 flex items-center justify-center">
        <div className="w-2 h-2 bg-green-500 animate-pulse"></div>
      </div>
    </aside>
  );
};

export default Sidebar;
