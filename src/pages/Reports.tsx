import React, { useState, useEffect } from 'react';
import { 
  Download, 
  Filter, 
  Calendar, 
  FileSpreadsheet, 
  TrendingUp, 
  ArrowRight,
  Loader2
} from 'lucide-react';
import { 
  collection, 
  query, 
  where, 
  getDocs 
} from 'firebase/firestore';
import { db, auth, handleFirestoreError } from '../lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency, cn } from '../lib/utils';
import { Sale, AdCampaign, Receipt } from '../types';
import { format, startOfMonth, endOfMonth, subMonths, isWithinInterval } from 'date-fns';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';

export default function ReportsPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [ads, setAds] = useState<AdCampaign[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('this-month');

  useEffect(() => {
    fetchData();
  }, [period]);

  const fetchData = async () => {
    if (!auth.currentUser) return;
    setLoading(true);

    try {
      const salesQ = query(collection(db, 'sales'), where('userId', '==', auth.currentUser.uid));
      const adsQ = query(collection(db, 'adCampaigns'), where('userId', '==', auth.currentUser.uid));
      const receiptsQ = query(collection(db, 'receipts'), where('userId', '==', auth.currentUser.uid));

      const [salesSnap, adsSnap, receiptsSnap] = await Promise.all([
        getDocs(salesQ),
        getDocs(adsQ),
        getDocs(receiptsQ)
      ]);

      let salesData = salesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale));
      let adsData = adsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AdCampaign));
      let receiptsData = receiptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Receipt));

      // Filter by period
      const now = new Date();
      let start = startOfMonth(now);
      let end = endOfMonth(now);

      if (period === 'last-month') {
        const lastMonth = subMonths(now, 1);
        start = startOfMonth(lastMonth);
        end = endOfMonth(lastMonth);
      }

      const isInRange = (dateStr: string) => {
        try {
          const d = new Date(dateStr);
          return isWithinInterval(d, { start, end });
        } catch (e) {
          return false;
        }
      };

      setSales(salesData.filter(s => isInRange(s.date)));
      setAds(adsData.filter(a => isInRange(a.date)));
      setReceipts(receiptsData.filter(r => isInRange(r.date)));
      setLoading(false);
    } catch (error) {
      handleFirestoreError(error, 'list', 'reports');
    }
  };

  const totalOmzet = sales.reduce((acc, s) => acc + s.omzet, 0);
  const totalAds = ads.reduce((acc, s) => acc + s.cost, 0);
  const totalProfitFromSales = sales.reduce((acc, s) => acc + s.profit, 0);
  const totalAdmin = sales.reduce((acc, s) => acc + s.adminFee, 0);
  const totalReceipts = receipts.reduce((acc, s) => acc + s.total, 0);
  
  // netProfit = totalProfitFromSales - totalAds
  const netProfit = totalProfitFromSales - totalAds;
  const totalHpp = sales.reduce((acc, s) => acc + (s.omzet - s.profit - s.adminFee), 0);

  const exportToExcel = () => {
    const reportData = [
      ['LAPORAN PENJUALAN SHOPEE HUB'],
      ['Periode', period === 'this-month' ? format(new Date(), 'MMMM yyyy') : format(subMonths(new Date(), 1), 'MMMM yyyy')],
      ['Pengambil Laporan', auth.currentUser?.email || 'Unknown'],
      [],
      ['RINGKASAN FINANSIAL'],
      ['Total Omzet (Penjualan Bruto)', totalOmzet],
      ['Total Estimasi HPP', totalHpp],
      ['Total Biaya Admin Shopee', totalAdmin],
      ['Total Biaya Iklan Shopee', totalAds],
      ['Laba Bersih Akhir', netProfit],
      ['Total Pengadaan Stok (Supplier)', totalReceipts],
      [],
      ['DETAIL TRANSAKSI PENJUALAN'],
      ['Tanggal', 'Nama Produk', 'SKU', 'Qty', 'Omzet', 'Profit'],
      ...sales.map(s => [s.date, s.productName, s.sku, s.quantity, s.omzet, s.profit]),
    ];

    const ws = XLSX.utils.aoa_to_sheet(reportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Laporan_Shopee");
    XLSX.writeFile(wb, `ShopeeHub_Report_${period}_${format(new Date(), 'yyyyMMdd')}.xlsx`);
    toast.success("Laporan XLSX berhasil diunduh");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Laporan Finansial</h1>
          <p className="text-slate-500">Analisa laba rugi dan efisiensi operasional.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[180px] h-9 text-[11px] font-bold border-gray-200">
              <Calendar className="w-3.5 h-3.5 mr-2" />
              <SelectValue placeholder="Pilih Periode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="this-month">Bulan Ini</SelectItem>
              <SelectItem value="last-month">Bulan Lalu</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" className="h-9 text-[11px] border-gray-200" onClick={fetchData} disabled={loading}>
            <Filter className="w-3.5 h-3.5 mr-2" /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="lg:col-span-3 flex flex-col items-center justify-center p-20 bg-white rounded-xl border border-gray-200">
            <Loader2 className="w-10 h-10 animate-spin text-orange-500 mb-4" />
            <p className="text-gray-500 font-bold uppercase text-[10px] tracking-widest">Menyusun Laporan...</p>
          </div>
        ) : (
          <>
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
              <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                <h3 className="text-sm font-bold uppercase tracking-tight">Ringkasan Laba Rugi</h3>
                <p className="text-[10px] text-gray-500 font-medium">Periode: {period === 'this-month' ? format(new Date(), 'MMMM yyyy') : format(subMonths(new Date(), 1), 'MMMM yyyy')}</p>
              </div>
              <div className="p-4 space-y-3">
                {[
                  { label: 'Total Omzet (Gross Sales)', value: totalOmzet, color: 'text-gray-900' },
                  { label: 'Total Modal Barang (HPP)', value: -totalHpp, color: 'text-red-500' },
                  { label: 'Total Fee Admin Shopee', value: -totalAdmin, color: 'text-red-500' },
                  { label: 'Biaya Iklan (Ads Spent)', value: -totalAds, color: 'text-orange-500' },
                ].map((item, i) => (
                  <div key={i} className="flex justify-between items-center py-2 border-b border-gray-50 text-xs">
                    <span className="text-gray-600 font-medium">{item.label}</span>
                    <span className={cn("font-bold", item.color)}>{formatCurrency(item.value)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center p-4 bg-gray-900 rounded-lg mt-4 shadow-xl">
                  <span className="text-xs font-bold text-gray-400">NET PROFIT AKHIR</span>
                  <span className={cn(
                    "text-lg font-black",
                    netProfit >= 0 ? "text-green-400" : "text-red-400"
                  )}>{formatCurrency(netProfit)}</span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-white p-4 rounded-xl border border-gray-200">
                <p className="text-[10px] uppercase font-bold text-gray-500 mb-1">Advertising Efficiency (ROAS)</p>
                <div className="text-3xl font-black tracking-tighter">
                  {totalAds > 0 ? (totalOmzet / totalAds).toFixed(2) : 0}x
                </div>
                <div className="mt-2 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-green-500" 
                    style={{ width: `${Math.min((totalAds > 0 ? (totalOmzet / totalAds) : 0) * 10, 100)}%` }} 
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-2 italic font-medium">Ideal Benchmark: &gt; 4.00x</p>
              </div>

              <div className="bg-white p-4 rounded-xl border border-gray-200">
                <p className="text-[10px] uppercase font-bold text-gray-500 mb-1">Uang Keluar (Supplier)</p>
                <div className="text-2xl font-black text-red-600 tracking-tight">
                  {formatCurrency(totalReceipts)}
                </div>
                <p className="text-[10px] text-gray-400 mt-1 font-medium">Total pengadaan stok barang</p>
              </div>

              <div className="bg-orange-600 p-4 rounded-xl text-white shadow-lg shadow-orange-200">
                <h4 className="text-xs font-black uppercase tracking-widest mb-1">Export Data</h4>
                <p className="text-[10px] text-orange-100 mb-4 font-medium">Unduh laporan Excel untuk arsip offline.</p>
                <Button variant="secondary" className="w-full text-[11px] font-black h-9 text-orange-700 bg-white hover:bg-orange-50 border-none uppercase tracking-tighter" onClick={exportToExcel}>
                  <Download className="w-3.5 h-3.5 mr-2" /> Download .XLSX
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
