import React, { useState, useEffect } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line,
  Cell,
  PieChart as RePieChart,
  Pie,
} from 'recharts';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  ShoppingCart, 
  Target, 
  ArrowUpRight,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot 
} from 'firebase/firestore';
import { db, auth, handleFirestoreError } from '../lib/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatCurrency, cn } from '../lib/utils';
import { Sale, AdCampaign } from '../types';
import { format, subDays } from 'date-fns';

const COLORS = ['#f97316', '#3b82f6'];

export default function Dashboard() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [ads, setAds] = useState<AdCampaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth.currentUser) return;

    const salesQ = query(collection(db, 'sales'), where('userId', '==', auth.currentUser.uid));
    const adsQ = query(collection(db, 'adCampaigns'), where('userId', '==', auth.currentUser.uid));

    const unsubscribeSales = onSnapshot(salesQ, (snapshot) => {
      setSales(snapshot.docs.map(doc => doc.data() as Sale));
      setLoading(false);
    }, (err) => handleFirestoreError(err, 'list', 'sales'));

    const unsubscribeAds = onSnapshot(adsQ, (snapshot) => {
      setAds(snapshot.docs.map(doc => doc.data() as AdCampaign));
      setLoading(false);
    }, (err) => handleFirestoreError(err, 'list', 'adCampaigns'));

    return () => {
      unsubscribeSales();
      unsubscribeAds();
    };
  }, []);

  // Aggregations
  const totalSalesCount = sales.length;
  const totalOmzet = sales.reduce((acc, s) => acc + s.omzet, 0);
  const totalAdCost = ads.reduce((acc, a) => acc + a.cost, 0);
  const totalProfit = sales.reduce((acc, s) => acc + s.profit, 0) - totalAdCost;
  const roas = totalAdCost > 0 ? (totalOmzet / totalAdCost) : 0;

  // Chart Data: Last 7 Days
  const chartData = Array.from({ length: 7 }).map((_, i) => {
    const date = subDays(new Date(), 6 - i);
    const dayStr = format(date, 'yyyy-MM-dd');
    const daySales = sales.filter(s => s.date === dayStr);
    const dayAds = ads.filter(a => a.date === dayStr);
    
    const omzet = daySales.reduce((acc, s) => acc + s.omzet, 0);
    const profit = daySales.reduce((acc, s) => acc + s.profit, 0) - dayAds.reduce((acc, a) => acc + a.cost, 0);
    const adCost = dayAds.reduce((acc, a) => acc + a.cost, 0);
    
    return {
      name: format(date, 'EEE'),
      omzet,
      profit,
      adCost
    };
  });

  const adsSales = ads.reduce((acc, a) => acc + a.salesFromAds, 0);
  const organicSales = Math.max(0, totalOmzet - adsSales);
  
  const pieData = [
    { name: 'Organik', value: organicSales },
    { name: 'Iklan', value: adsSales },
  ];

  // Top SKUs
  const skuMap = new Map<string, { name: string, profit: number, qty: number }>();
  sales.forEach(s => {
    const current = skuMap.get(s.sku) || { name: s.productName, profit: 0, qty: 0 };
    skuMap.set(s.sku, {
      name: s.productName,
      profit: current.profit + s.profit,
      qty: current.qty + s.quantity
    });
  });
  const topSKUs = Array.from(skuMap.entries())
    .map(([sku, data]) => ({ sku, ...data }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5);

  const stats = [
    { label: 'Total Omzet', value: totalOmzet, icon: DollarSign, trend: 'Gross', color: 'text-gray-900', bg: 'bg-white' },
    { label: 'Total Profit', value: totalProfit, icon: TrendingUp, trend: 'Net', color: 'text-green-600', bg: 'bg-white' },
    { label: 'Biaya Iklan', value: totalAdCost, icon: ShoppingCart, trend: 'Ads', color: 'text-gray-900', bg: 'bg-white' },
    { label: 'Avg ROAS', value: `${roas.toFixed(1)}x`, icon: Target, trend: 'efficiency', color: 'text-blue-600', bg: 'bg-white' },
  ];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 animate-spin text-orange-500 mb-4" />
        <p className="text-slate-500 text-sm font-medium">Menghitung performa...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Key Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {stats.map((stat, i) => (
          <div key={i} className="bg-white p-3 sm:p-4 rounded-xl border border-gray-200">
            <p className="text-[9px] sm:text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-0.5 sm:mb-1">{stat.label}</p>
            <p className={cn("text-base sm:text-2xl font-bold", stat.color)}>
              {typeof stat.value === 'number' ? formatCurrency(stat.value) : stat.value}
            </p>
            <div className="mt-1 sm:mt-2 flex items-center text-[8px] sm:text-[10px] text-gray-400 font-bold uppercase">
              {stat.trend}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-4 sm:p-5 flex flex-col h-[280px] sm:h-[350px]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs sm:text-sm font-bold">Grafik Performa</h3>
            <div className="flex gap-2">
              <span className="flex items-center text-[9px] sm:text-[10px] text-gray-500"><span className="w-2 h-2 rounded-full bg-blue-500 mr-1"></span> Omzet</span>
              <span className="flex items-center text-[9px] sm:text-[10px] text-gray-500"><span className="w-2 h-2 rounded-full bg-green-500 mr-1"></span> Profit</span>
            </div>
          </div>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `Rp${val/1000}k`} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '12px' }}
                  formatter={(value: number) => [formatCurrency(value), '']}
                />
                <Line type="monotone" dataKey="omzet" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} name="Omzet" />
                <Line type="monotone" dataKey="profit" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} name="Profit" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 flex flex-col h-[300px] sm:h-[350px]">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-xs sm:text-sm font-bold">Sumber Penjualan</h3>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center p-4 overflow-hidden">
            <div className="w-full h-[140px] sm:h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={60}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </RePieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 space-y-2 w-full">
              {pieData.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] font-medium">
                  <div className="flex items-center">
                    <div className="w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: COLORS[i] }} />
                    <span className="text-gray-500 uppercase tracking-tight">{item.name}</span>
                  </div>
                  <span className="font-bold">{totalOmzet > 0 ? Math.round(item.value / totalOmzet * 100) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-tight">Top SKU Profit</h3>
        </div>
        <div className="divide-y divide-gray-100 px-4">
          {topSKUs.length === 0 ? (
            <p className="text-center text-gray-500 py-8 text-xs">Belum ada data penjualan.</p>
          ) : topSKUs.map((item, i) => (
            <div key={i} className="flex items-center justify-between py-3">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center font-bold text-orange-600 text-xs">
                  {i + 1}
                </div>
                <div>
                  <p className="text-xs font-bold truncate max-w-[140px] xs:max-w-[180px] sm:max-w-[200px]">{item.name}</p>
                  <p className="text-[10px] text-gray-400 font-mono">{item.sku}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold text-green-600">{formatCurrency(item.profit)}</p>
                <p className="text-[10px] text-gray-400 font-bold">{item.qty} terjual</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
