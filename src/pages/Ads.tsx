import React, { useState, useEffect, useRef } from 'react';
import { Plus, Target, TrendingUp, DollarSign, Loader2, Search, Upload, Filter, Trash2 } from 'lucide-react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  writeBatch,
  getDocs,
  serverTimestamp 
} from 'firebase/firestore';
import { db, auth, handleFirestoreError } from '../lib/firebase';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { 
  Select, 
  SelectContent, 
  SelectGroup, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { AdCampaign } from '../types';
import { formatCurrency, formatNumber, cn } from '../lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

export default function AdsPage() {
  const [ads, setAds] = useState<AdCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isClearAllOpen, setIsClearAllOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [selectedYear, setSelectedYear] = useState('all');
  const [selectedShop, setSelectedShop] = useState('all');

  const months = [
    { value: '01', label: 'Januari' },
    { value: '02', label: 'Februari' },
    { value: '03', label: 'Maret' },
    { value: '04', label: 'April' },
    { value: '05', label: 'Mei' },
    { value: '06', label: 'Juni' },
    { value: '07', label: 'Juli' },
    { value: '08', label: 'Agustus' },
    { value: '09', label: 'September' },
    { value: '10', label: 'Oktober' },
    { value: '11', label: 'November' },
    { value: '12', label: 'Desember' },
  ];

  const years = Array.from({ length: 5 }, (_, i) => (new Date().getFullYear() - i).toString());

  useEffect(() => {
    if (!auth.currentUser) return;
    
    const q = query(
      collection(db, 'adCampaigns'), 
      where('userId', '==', auth.currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as AdCampaign[];
      setAds(docs.sort((a, b) => b.date.localeCompare(a.date)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, 'list', 'adCampaigns');
    });

    return () => unsubscribe();
  }, []);

  const handleAddAd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!auth.currentUser) return;

    const formData = new FormData(e.currentTarget);
    
    const cost = Number(formData.get('cost'));
    const salesFromAds = Number(formData.get('salesFromAds'));
    const roas = salesFromAds / (cost || 1);
    const shopName = formData.get('shopName') as string;

    const newAd = {
      date: formData.get('date') as string,
      shopName: shopName || 'Default Store',
      campaignName: formData.get('campaignName') as string,
      cost: cost,
      salesFromAds: salesFromAds,
      roas: Number(roas.toFixed(2)),
      userId: auth.currentUser.uid
    };

    try {
      await addDoc(collection(db, 'adCampaigns'), newAd);
      toast.success("Data iklan dicatat");
      setIsAddOpen(false);
    } catch (error) {
      handleFirestoreError(error, 'create', 'adCampaigns');
    }
  };

  const handleImportAds = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !auth.currentUser) return;

    setIsImporting(true);
    const reader = new FileReader();

    reader.onload = async (evt) => {
      try {
        const dataBuffer = evt.target?.result;
        const wb = XLSX.read(dataBuffer, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        
        const jsonData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        let headerRowIndex = -1;
        
        // Flexible header detection for Shopee Ads exports
        for (let i = 0; i < Math.min(jsonData.length, 20); i++) {
          const row = jsonData[i];
          if (!row || !Array.isArray(row)) continue;
          
          const rowStr = row.map(v => v?.toString().toLowerCase() || '').join(' ');
          if (
            rowStr.includes('nama campaign') || 
            rowStr.includes('campaign name') || 
            rowStr.includes('nama iklan') || 
            rowStr.includes('biaya') || 
            rowStr.includes('penjualan') ||
            rowStr.includes('omzet') ||
            rowStr.includes('roas') ||
            rowStr.includes('efektifitas')
          ) {
            headerRowIndex = i;
            break;
          }
        }

        if (headerRowIndex === -1) {
          toast.error("Format file tidak dikenali. Pastikan file adalah ekspor Iklan Shopee.");
          setIsImporting(false);
          return;
        }

        const data = XLSX.utils.sheet_to_json(ws, { range: headerRowIndex }) as any[];
        const newAds: any[] = [];
        let importedCount = 0;
        let reportEndDate = format(new Date(), 'yyyy-MM-dd'); // Default to today
        let discoveredShopName = '';

        // Look for Period and Shop Name in the top rows
        for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
          const row = jsonData[i];
          if (!row || !Array.isArray(row)) continue;
          
          const rowStr = row.join(' ');
          
          // Shop Name detection
          if (row[0]?.toString().toLowerCase().includes('nama toko')) {
            discoveredShopName = row[1]?.toString() || '';
          }

          if (rowStr.toLowerCase().includes('periode')) {
            // Find something like 17/04/2026 - 23/04/2026
            const dateMatch = rowStr.match(/(\d{2}\/\d{2}\/\d{4})/g);
            if (dateMatch && dateMatch.length > 1) {
              const lastDateStr = dateMatch[dateMatch.length - 1]; // Take the end date
              const [d, m, y] = lastDateStr.split('/');
              reportEndDate = `${y}-${m}-${d}`;
            }
          }
        }

        const sanitizeNum = (val: any) => {
          if (typeof val === 'number') return val;
          if (!val) return 0;
          // Handle Indonesian format (e.g. 1.000,50)
          const clean = val.toString().replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
          return Number(clean);
        };

        data.forEach((row) => {
          const campaignName = row['Nama Iklan'] || row['Nama Campaign'] || row['Campaign Name'] || row['Iklan'] || '';
          const cost = sanitizeNum(row['Biaya'] || row['Cost'] || row['Expense'] || 0);
          const salesFromAds = sanitizeNum(row['Omzet Penjualan'] || row['Penjualan'] || row['Sales'] || row['GMV'] || row['Penjualan (IDR)'] || 0);
          const roas = sanitizeNum(row['Efektifitas Iklan'] || row['ROAS'] || row['Pengembalian Modal'] || 0);
          
          // Use specific Shopee summary dates if available, otherwise use report end date
          let rawDate = row['Tanggal'] || row['Date'] || reportEndDate;
          
          // If it's strictly a Start Date (Tanggal Mulai), prefer the report date 
          // because Stats are for the period, not just the start day
          if (row['Tanggal Mulai'] && !row['Tanggal']) {
            rawDate = reportEndDate;
          }
          
          if (campaignName && cost > 0) {
            newAds.push({
              date: typeof rawDate === 'string' ? rawDate : format(new Date(rawDate), 'yyyy-MM-dd'),
              shopName: discoveredShopName || 'Shopee Store',
              campaignName: campaignName.toString(),
              cost: cost,
              salesFromAds: salesFromAds,
              roas: roas || (salesFromAds / (cost || 1)),
              userId: auth.currentUser!.uid
            });
          }
        });

        if (newAds.length === 0) {
          toast.error("Tidak ada data iklan yang valid ditemukan.");
        } else {
          for (const ad of newAds) {
            await addDoc(collection(db, 'adCampaigns'), ad);
            importedCount++;
          }
          toast.success(`Berhasil mengimpor ${importedCount} data iklan`);
        }
      } catch (error) {
        console.error("Import error:", error);
        toast.error("Gagal mengimpor file. Periksa format data Excel Anda.");
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const handleDeleteAd = async () => {
    if (!deletingId) return;
    try {
      await deleteDoc(doc(db, 'adCampaigns', deletingId));
      toast.success("Data iklan berhasil dihapus");
      setIsDeleteOpen(false);
      setDeletingId(null);
    } catch (error) {
      handleFirestoreError(error, 'delete', 'adCampaigns');
    }
  };

  const handleClearAllAds = async () => {
    if (!auth.currentUser) return;
    try {
      const q = query(collection(db, 'adCampaigns'), where('userId', '==', auth.currentUser.uid));
      const snap = await getDocs(q);
      
      const batch = writeBatch(db);
      snap.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      toast.success("Semua data iklan telah dihapus");
      setIsClearAllOpen(false);
    } catch (error) {
      handleFirestoreError(error, 'delete', 'adCampaigns');
    }
  };

  const [search, setSearch] = useState('');

  const shopNames = Array.from(new Set(ads.map(a => a.shopName || 'Shopee Store'))).filter(Boolean);

  const filteredAds = ads.filter(a => {
    const matchesSearch = a.campaignName.toLowerCase().includes(search.toLowerCase());
    const adDate = new Date(a.date);
    const matchesMonth = selectedMonth === 'all' || (adDate.getMonth() + 1).toString().padStart(2, '0') === selectedMonth;
    const matchesYear = selectedYear === 'all' || adDate.getFullYear().toString() === selectedYear;
    const matchesShop = selectedShop === 'all' || (a.shopName || 'Shopee Store') === selectedShop;
    return matchesSearch && matchesMonth && matchesYear && matchesShop;
  });

  const totalCost = filteredAds.reduce((acc, ad) => acc + ad.cost, 0);
  const totalSalesFromAds = filteredAds.reduce((acc, ad) => acc + ad.salesFromAds, 0);
  const avgRoas = totalSalesFromAds / (totalCost || 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-heading tracking-tight">Performa Iklan</h1>
          <p className="text-slate-500 text-xs sm:text-sm">Pantau efisiensi biaya dan ROI iklan.</p>
        </div>
        <div className="flex flex-row flex-wrap gap-2 w-full md:w-auto">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImportAds} 
            className="hidden" 
            accept=".xlsx, .xls, .csv"
          />
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="flex-1 md:flex-none border-orange-200 text-orange-700 hover:bg-orange-50 h-9 text-[10px] sm:text-xs"
          >
            {isImporting ? <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2 animate-spin" /> : <Upload className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />}
            Import
          </Button>
          <Button 
            variant="ghost" 
            size="sm"
            className="flex-1 md:flex-none text-red-500 hover:text-red-600 hover:bg-red-50 h-9 text-[10px] sm:text-xs"
            onClick={() => setIsClearAllOpen(true)}
          >
            <Trash2 className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" /> Hapus
          </Button>

          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger render={<button className={cn(buttonVariants({ variant: 'default', size: 'sm' }), "flex-1 md:flex-none bg-orange-500 hover:bg-orange-600 h-9 text-[10px] sm:text-xs")} />}>
              <Plus className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" /> Input
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Input Performa Iklan</DialogTitle>
              </DialogHeader>
              <form key={isAddOpen ? 'open' : 'closed'} onSubmit={handleAddAd} className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="date">Tanggal</Label>
                  <Input id="date" name="date" type="date" required defaultValue={format(new Date(), 'yyyy-MM-dd')} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shopName">Nama Toko</Label>
                  <Input id="shopName" name="shopName" placeholder="Contoh: Sajian Padang Instan" defaultValue={selectedShop !== 'all' ? selectedShop : ''} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="campaignName">Nama Campaign</Label>
                  <Input id="campaignName" name="campaignName" placeholder="Contoh: Iklan Kata Kunci T-Shirt" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cost">Biaya Iklan</Label>
                    <Input id="cost" name="cost" type="number" required placeholder="0" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="salesFromAds">Penjualan Iklan</Label>
                    <Input id="salesFromAds" name="salesFromAds" type="number" required placeholder="0" />
                  </div>
                </div>
                <DialogFooter>
                  <button type="submit" className={cn(buttonVariants({ variant: 'default' }), "w-full bg-orange-500 hover:bg-orange-600")}>Simpan Data</button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {[
          { label: 'Total Biaya', value: totalCost, color: 'text-red-600' },
          { label: 'Sales Ads', value: totalSalesFromAds, color: 'text-green-600' },
          { label: 'Avg ROAS', value: `${avgRoas.toFixed(2)}x`, color: 'text-blue-600', isRaw: true },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-3 sm:p-4 rounded-xl border border-gray-200">
            <p className="text-[8px] sm:text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-0.5 sm:mb-1 whitespace-nowrap overflow-hidden text-ellipsis">{stat.label}</p>
            <p className={cn("text-[10px] xs:text-xs sm:text-xl font-bold", stat.color)}>
              {stat.isRaw ? stat.value : formatCurrency(stat.value as number)}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
        <div className="p-3 sm:p-4 border-b border-gray-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 bg-slate-50/30">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400 shrink-0" />
            <h3 className="text-xs font-bold uppercase tracking-tight text-slate-700">Filter Ads</h3>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 items-center gap-2 w-full lg:w-auto">
            {/* Shop Filter */}
            <Select value={selectedShop} onValueChange={setSelectedShop}>
              <SelectTrigger className="h-8 text-[10px] sm:text-[11px] font-medium w-full bg-white text-slate-700">
                <SelectValue placeholder="Toko" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Toko</SelectItem>
                {shopNames.map(name => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="h-8 text-[10px] sm:text-[11px] font-medium w-full bg-white text-slate-700">
                <SelectValue placeholder="Bulan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Bulan</SelectItem>
                {months.map(m => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="h-8 text-[10px] sm:text-[11px] font-medium w-full bg-white text-slate-700">
                <SelectValue placeholder="Tahun" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Tahun</SelectItem>
                {years.map(y => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative w-full col-span-2 md:col-span-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <Input 
                placeholder="Cari..." 
                className="pl-9 h-8 text-[10px] sm:text-[11px] border-gray-200 bg-white w-full"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="block md:hidden overflow-hidden bg-gray-50/50">
          {loading ? (
            <div className="p-8 text-center bg-white border-y border-gray-100">
              <Loader2 className="w-5 h-5 mx-auto animate-spin text-orange-500" />
            </div>
          ) : filteredAds.length === 0 ? (
            <div className="p-8 text-center text-[10px] text-gray-500 font-bold uppercase bg-white border-y border-gray-100">
              Tidak ada data iklan.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredAds.map((ad) => (
                <div key={ad.id} className="p-4 bg-white space-y-3">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 pr-2">
                       <div className="text-[10px] font-bold text-gray-400 mb-0.5">{format(new Date(ad.date), 'dd MMM yyyy')}</div>
                       <div className="text-xs font-bold text-gray-900 leading-tight mb-1">{ad.campaignName}</div>
                       <div className="text-[8px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded uppercase inline-block">
                         {ad.shopName || 'Shopee Store'}
                       </div>
                    </div>
                    <button 
                      className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), "h-7 w-7 p-0 text-red-400 shrink-0")}
                      onClick={() => {
                        setDeletingId(ad.id);
                        setIsDeleteOpen(true);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-50">
                     <div>
                       <div className="text-[8px] text-gray-400 font-bold uppercase">Biaya</div>
                       <div className="text-xs font-bold text-red-600">-{formatCurrency(ad.cost)}</div>
                     </div>
                     <div>
                       <div className="text-[8px] text-gray-400 font-bold uppercase">Sales</div>
                       <div className="text-xs font-bold text-green-600">{formatCurrency(ad.salesFromAds)}</div>
                     </div>
                     <div className="text-right">
                       <div className="text-[8px] text-gray-400 font-bold uppercase">ROAS</div>
                       <div className={cn(
                          "text-xs font-black inline-block px-1.5 py-0.5 rounded",
                          ad.roas >= 4 ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
                        )}>
                          {ad.roas.toFixed(1)}x
                        </div>
                     </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2">Tanggal</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2">Toko</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2">Campaign</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2 text-right">Biaya</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2 text-right">Penjualan</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2 text-center">ROAS</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2 text-center">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs divide-y divide-gray-100">
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <div className="flex items-center justify-center">
                      <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                      <span className="ml-2 text-[10px]">Memuat...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredAds.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-[10px] text-gray-500 font-bold uppercase">
                    Data tidak ditemukan.
                  </TableCell>
                </TableRow>
              ) : (
                filteredAds.map((ad) => (
                  <TableRow key={ad.id} className="hover:bg-gray-50 transition-colors">
                    <TableCell className="px-4 py-2 font-medium">{format(new Date(ad.date), 'dd MMM yyyy')}</TableCell>
                    <TableCell className="px-4 py-2">
                       <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                         {ad.shopName || 'Shopee Store'}
                       </span>
                    </TableCell>
                    <TableCell className="px-4 py-2 font-bold">{ad.campaignName}</TableCell>
                    <TableCell className="px-4 py-2 text-right font-bold text-red-600">-{formatCurrency(ad.cost)}</TableCell>
                    <TableCell className="px-4 py-2 text-right font-bold text-green-600">{formatCurrency(ad.salesFromAds)}</TableCell>
                    <TableCell className="px-4 py-2 text-center">
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-black tracking-tighter",
                        ad.roas >= 4 ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
                      )}>
                        {ad.roas.toFixed(1)}x
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2 text-center">
                      <button 
                        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), "h-7 w-7 p-0 text-red-600")}
                        onClick={() => {
                          setDeletingId(ad.id);
                          setIsDeleteOpen(true);
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-600 font-bold uppercase tracking-tight text-xs">Konfirmasi Hapus</DialogTitle>
          </DialogHeader>
          <div className="py-4 text-xs text-gray-600">
            Apakah Anda yakin ingin menghapus data laporan iklan ini? Tindakan ini tidak dapat dibatalkan.
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <button className={cn(buttonVariants({ variant: 'outline' }), "h-8 text-[10px] font-bold uppercase")} onClick={() => setIsDeleteOpen(false)}>Batal</button>
            <button className={cn(buttonVariants({ variant: 'destructive' }), "h-8 text-[10px] font-bold uppercase")} onClick={handleDeleteAd}>Ya, Hapus</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isClearAllOpen} onOpenChange={setIsClearAllOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-600 font-bold uppercase tracking-tight text-xs">Konfirmasi Hapus Semua</DialogTitle>
          </DialogHeader>
          <div className="py-4 text-xs text-gray-600">
            Apakah Anda yakin ingin menghapus SEMUA data iklan? Tindakan ini tidak dapat dibatalkan.
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <button className={cn(buttonVariants({ variant: 'outline' }), "h-8 text-[10px] font-bold uppercase")} onClick={() => setIsClearAllOpen(false)}>Batal</button>
            <button className={cn(buttonVariants({ variant: 'destructive' }), "h-8 text-[10px] font-bold uppercase")} onClick={handleClearAllAds}>Ya, Hapus Semua</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
