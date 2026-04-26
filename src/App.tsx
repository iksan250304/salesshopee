/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { 
  BarChart3, 
  ShoppingCart, 
  Target, 
  Receipt as ReceiptIcon, 
  Package, 
  PieChart, 
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  User as UserIcon,
  Sun,
  Moon,
  Calendar as CalendarIcon
} from 'lucide-react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  User as FirebaseUser 
} from 'firebase/auth';
import { format } from 'date-fns';
import { auth, googleProvider } from './lib/firebase';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';

// Pages
import Dashboard from './pages/Dashboard';
import Sales from './pages/Sales';
import Ads from './pages/Ads';
import Receipts from './pages/Receipts';
import Products from './pages/Products';
import Reports from './pages/Reports';
import { Toaster } from "@/components/ui/sonner"

const Auth = ({ onLogin, loading }: { onLogin: () => void, loading: boolean }) => (
  <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-50 dark:bg-slate-950">
    <div className="w-full max-w-md p-8 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-center mb-8 space-x-2">
        <ShoppingCart className="w-10 h-10 text-orange-500" />
        <h1 className="text-2xl font-bold tracking-tight">Shopee Hub</h1>
      </div>
      <h2 className="text-xl font-semibold mb-6 text-center">Login to your account</h2>
      <div className="space-y-4">
        <Button 
          className="w-full bg-orange-500 hover:bg-orange-600 h-12 text-lg" 
          onClick={onLogin}
          disabled={loading}
        >
          {loading ? 'Logging in...' : 'Sign in with Google'}
        </Button>
        <p className="text-sm text-center text-slate-500">
          Manage your Shopee sales, ads, and profits in one place.
        </p>
      </div>
    </div>
  </div>
);

interface LayoutProps {
  children: ReactNode;
  user: any;
  onLogout: () => void;
}

const Layout = ({ children, user, onLogout }: LayoutProps) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const location = useLocation();

  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    { icon: ShoppingCart, label: 'Penjualan', path: '/sales' },
    { icon: Target, label: 'Shopee Ads', path: '/ads' },
    { icon: Package, label: 'Manajemen HPP', path: '/products' },
    { icon: ReceiptIcon, label: 'Nota Supplier', path: '/receipts' },
    { icon: PieChart, label: 'Laporan', path: '/reports' },
  ];

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-slate-950 text-gray-800 dark:text-slate-100 font-sans overflow-hidden transition-colors">
      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            onClick={toggleSidebar}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-60 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 transform transition-transform duration-300 lg:relative lg:translate-x-0 overflow-y-auto flex flex-col pt-2",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">S</div>
          <span className="font-bold text-xl tracking-tight text-orange-600">ShopeeHub</span>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1">
          {navItems.map((item) => (
            <Link 
              key={item.path} 
              to={item.path}
              onClick={() => setIsSidebarOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md transition-all text-xs font-medium",
                location.pathname === item.path 
                  ? "bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 font-semibold"
                  : "text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800"
              )}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-slate-800 flex items-center justify-center">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="User" className="w-full h-full rounded-full" />
              ) : (
                <UserIcon className="w-5 h-5 text-gray-500" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold truncate">{user?.displayName || 'Admin UMKM'}</p>
              <p className="text-[9px] text-gray-500 truncate">{user?.email}</p>
            </div>
            <Button variant="ghost" size="icon" className="w-6 h-6 p-0 text-gray-400" onClick={onLogout}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between px-3 md:px-6 shrink-0 z-10 transition-colors">
          <div className="flex items-center">
            <Button variant="ghost" size="icon" className="lg:hidden mr-2 p-0 w-8 h-8" onClick={toggleSidebar}>
              <Menu className="w-5 h-5 text-gray-500" />
            </Button>
            <h2 className="text-sm font-bold md:text-base truncate max-w-[150px] sm:max-w-none">
              {navItems.find(i => i.path === location.pathname)?.label || 'Dashboard Overview'}
            </h2>
          </div>
          <div className="flex items-center space-x-2 md:space-x-3">
             <div className="hidden md:flex items-center bg-gray-100 dark:bg-slate-800 rounded-lg px-2 py-1 text-[9px] md:text-[10px] font-bold text-gray-600 dark:text-slate-400">
                <CalendarIcon className="w-3 h-3 md:w-3.5 md:h-3.5 mr-1.5 md:mr-2" />
                {format(new Date(), 'dd MMM yyyy')}
             </div>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="w-8 h-8 p-0 text-gray-400"
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" /> }
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 transition-colors">
          <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const login = async () => {
    try {
      setAuthLoading(true);
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Login failed:', error);
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (loading) return null;

  return (
    <BrowserRouter>
      {!user ? (
        <Auth onLogin={login} loading={authLoading} />
      ) : (
        <Layout user={user} onLogout={logout}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/sales" element={<Sales />} />
            <Route path="/ads" element={<Ads />} />
            <Route path="/products" element={<Products />} />
            <Route path="/receipts" element={<Receipts />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      )}
      <Toaster position="top-right" richColors />
    </BrowserRouter>
  );
}
