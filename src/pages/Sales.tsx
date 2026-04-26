import React, { useState, useEffect } from 'react';
import { Plus, Upload, Download, Search, Filter, Loader2, Trash2 } from 'lucide-react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  getDocs,
  writeBatch,
  serverTimestamp 
} from 'firebase/firestore';
import { db, auth, handleFirestoreError } from '../lib/firebase';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Sale, Product } from '../types';
import { 
  Select, 
  SelectContent, 
  SelectGroup, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { formatCurrency, cn } from '../lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedShop, setSelectedShop] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [selectedYear, setSelectedYear] = useState('all');
  const [isImporting, setIsImporting] = useState(false);
  const [isClearAllOpen, setIsClearAllOpen] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!auth.currentUser) return;
    
    const q = query(
      collection(db, 'sales'), 
      where('userId', '==', auth.currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Sale[];
      setSales(docs.sort((a, b) => b.date.localeCompare(a.date)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, 'list', 'sales');
    });

    const productQ = query(collection(db, 'products'), where('userId', '==', auth.currentUser.uid));
    const unsubscribeProducts = onSnapshot(productQ, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Product[];
      setProducts(docs);
    });

    return () => {
      unsubscribe();
      unsubscribeProducts();
    };
  }, []);

  const handleAddSale = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!auth.currentUser) return;

    const formData = new FormData(e.currentTarget);
    const sku = formData.get('sku') as string;
    
    // Find Product HPP
    let hpp = 0;
    try {
      const productQ = query(collection(db, 'products'), where('sku', '==', sku), where('userId', '==', auth.currentUser.uid));
      const productSnap = await getDocs(productQ);
      if (!productSnap.empty) {
        hpp = (productSnap.docs[0].data() as Product).hpp;
      } else {
        toast.warning("SKU tidak ditemukan di Master Produk, HPP diatur ke 0");
      }
    } catch (error) {
      console.error("Error fetching HPP:", error);
    }
    
    const qty = Number(formData.get('quantity'));
    const price = Number(formData.get('price'));
    const adminFee = Number(formData.get('adminFee'));
    const shipping = Number(formData.get('shippingFee'));
    const shopName = formData.get('shopName') as string;
    
    const omzet = qty * price;
    const profit = omzet - (qty * hpp) - adminFee;

    const newSale = {
      date: formData.get('date') as string,
      shopName: shopName || 'Default Store',
      productName: formData.get('productName') as string,
      sku: sku,
      quantity: qty,
      price: price,
      adminFee: adminFee,
      shippingFee: shipping,
      omzet: omzet,
      profit: profit,
      userId: auth.currentUser.uid
    };

    try {
      await addDoc(collection(db, 'sales'), newSale);
      toast.success("Penjualan dicatat");
      setIsAddOpen(false);
    } catch (error) {
      handleFirestoreError(error, 'create', 'sales');
    }
  };

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
        
        // Shopee exports often have metadata/header info before the actual table
        const jsonData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        let headerRowIndex = -1;
        
        // Flexible header detection
        for (let i = 0; i < Math.min(jsonData.length, 20); i++) {
          const row = jsonData[i];
          if (!row || !Array.isArray(row)) continue;
          
          const rowStr = row.map(v => v?.toString().toLowerCase() || '').join(' ');
          if (
            rowStr.includes('no. pesanan') || 
            rowStr.includes('order id') || 
            rowStr.includes('nama produk') || 
            rowStr.includes('product name') ||
            rowStr.includes('nomor referensi sku')
          ) {
            headerRowIndex = i;
            break;
          }
        }

        if (headerRowIndex === -1) {
          toast.error("Format file tidak dikenali. Pastikan file adalah ekspor pesanan/pendapatan Shopee.");
          setIsImporting(false);
          return;
        }

        const data = XLSX.utils.sheet_to_json(ws, { range: headerRowIndex }) as any[];

        // Fetch products for HPP mapping
        const productSnap = await getDocs(query(collection(db, 'products'), where('userId', '==', auth.currentUser!.uid)));
        const productsMap = new Map<string, number>();
        productSnap.forEach(doc => {
          const p = doc.data() as Product;
          if (p.sku) productsMap.set(p.sku.toLowerCase().trim(), p.hpp);
        });

        const newSales: any[] = [];
        let importedCount = 0;
        let discoveredShopName = '';

        // Shop Name detection in header
        for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
          const row = jsonData[i];
          if (!row || !Array.isArray(row)) continue;
          if (row[0]?.toString().toLowerCase().includes('nama toko')) {
            discoveredShopName = row[1]?.toString() || '';
          }
        }

        const sanitizeNum = (val: any) => {
          if (typeof val === 'number') return val;
          if (!val) return 0;
          // Support multiple formats: 54.000 or 54,000 or 54000
          const str = val.toString().trim();
          // If contains both . and , (e.g. 1.234,56), it's likely European/Indonesian format
          // If only one, we need to guess.
          // Standard Shopee ID: 54.000
          const clean = str.replace(/[^0-9,-]/g, '');
          return Number(clean.replace(',', '.'));
        };

        data.forEach((row) => {
          // Comprehensive mapping based on multiple Shopee report types (Order, Income, etc.)
          const rawProductName = (row['Nama Produk'] || row['Product Name'] || row['Deskripsi Produk'] || row['Product Description'] || '').toString();
          const variationName = (row['Nama Variasi'] || row['Variation Name'] || '').toString();
          const productName = variationName ? `${rawProductName} (${variationName})` : rawProductName;
          
          // Try to find SKU in various possible column names
          const skuRaw = row['SKU Induk'] || row['Nomor Referensi SKU'] || row['No. SKU'] || row['SKU Reference No.'] || row['SKU'] || row['Parent SKU'] || row['Variation SKU'] || '';
          const sku = skuRaw.toString().trim();
          
          const quantity = Number(row['Jumlah'] || row['Quantity'] || row['Kuantitas'] || 1);
          
          // Price column variations
          const price = sanitizeNum(
            row['Harga Setelah Diskon'] || 
            row['Deal Price'] || 
            row['Dibayar Pembeli'] || 
            row['Total Pembayaran'] || 
            row['Order Total Amount'] || 
            row['Harga Asli'] || 
            row['Unit Price'] || 0
          );
          
          // Date mapping
          const rawDate = row['Waktu Pembayaran Dilakukan'] || 
                         row['Waktu Pembayaran Konfirmasi'] || 
                         row['Waktu Pesanan Dibuat'] || 
                         row['Order Creation Time'] || 
                         row['Waktu Selesai'] || 
                         row['Waktu Dana Dilepaskan'] ||
                         new Date().toISOString();
          
          let dateStr = '';
          try {
            // Handle Excel serial date if necessary
            if (typeof rawDate === 'number') {
              const d = new Date((rawDate - 25569) * 86400 * 1000);
              dateStr = format(d, 'yyyy-MM-dd');
            } else {
              const d = new Date(rawDate);
              if (isNaN(d.getTime())) throw new Error();
              dateStr = format(d, 'yyyy-MM-dd');
            }
          } catch {
            dateStr = format(new Date(), 'yyyy-MM-dd');
          }

          // We import as long as there is a product name.
          if (productName && productName.length > 2) {
            const normalize = (val: string) => val?.toLowerCase().replace(/[^a-z0-9]/g, '').trim() || '';
            const cleanWords = (val: string) => val?.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1) || [];

            const nSku = normalize(sku);
            const nName = normalize(productName);
            const wordsName = cleanWords(productName);
            
            let hpp = 0;
            // 1. SKU match
            let product = products.find(p => p.sku && sku !== 'NO-SKU' && normalize(p.sku) === nSku);
            
            // 2. Exact Name match
            if (!product && nName) {
              product = products.find(p => normalize(p.name) === nName);
            }
            
            // 3. Containment match
            if (!product && nName) {
              product = products.find(p => {
                const pNorm = normalize(p.name);
                if (pNorm.length < 4) return false;
                return nName.includes(pNorm) || pNorm.includes(nName);
              });
            }

            // 4. Word-based intersection (Lowered threshold)
            if (!product && wordsName.length > 0) {
              product = products.find(p => {
                const pWords = cleanWords(p.name);
                if (pWords.length === 0) return false;
                const matches = pWords.filter(pw => wordsName.some(wn => wn === pw || wn.includes(pw) || pw.includes(wn)));
                const matchRatio = matches.length / pWords.length;
                if (pWords.length >= 2 && wordsName.length >= 2) {
                  if (pWords[0] === wordsName[0] && pWords[1] === wordsName[1]) return true;
                }
                return matchRatio >= 0.5;
              });
            }

            if (product) {
              hpp = product.hpp;
            }

            const omzet = quantity * price;
            
            // Try to extract fees
            const adminFee = sanitizeNum(row['Biaya Administrasi'] || row['Service Fee'] || row['Commission Fee'] || row['Biaya Layanan'] || 0);
            const shippingFee = sanitizeNum(row['Ongkos Kirim Dibayar oleh Pembeli'] || row['Estimated Shipping Fee'] || row['Ongkos Kirim'] || 0);
            
            const profit = omzet - (quantity * hpp) - Math.abs(adminFee);

            newSales.push({
              date: dateStr,
              shopName: discoveredShopName || 'Shopee Store',
              productName: productName.substring(0, 150),
              sku: sku || 'NO-SKU',
              quantity,
              price,
              adminFee: Math.abs(adminFee),
              shippingFee,
              omzet,
              profit,
              userId: auth.currentUser!.uid,
              source: 'Import'
            });
            importedCount++;
          }
        });

        if (newSales.length > 0) {
          // Batch add docs
          const promises = newSales.map(s => addDoc(collection(db, 'sales'), s));
          await Promise.all(promises);
          toast.success(`Berhasil mengimpor ${importedCount} data penjualan`);
        } else {
          toast.error("Tidak ada data valid yang ditemukan di file.");
        }
      } catch (error) {
        console.error("Import error:", error);
        toast.error("Gagal membaca file CSV/Excel");
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const handleClearAllSales = async () => {
    if (!auth.currentUser) return;
    try {
      const q = query(collection(db, 'sales'), where('userId', '==', auth.currentUser.uid));
      const snap = await getDocs(q);
      
      const batch = writeBatch(db);
      snap.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      toast.success("Semua data penjualan telah dihapus");
      setIsClearAllOpen(false);
    } catch (error) {
      handleFirestoreError(error, 'delete', 'sales');
    }
  };
  
  const shopNames = Array.from(new Set(sales.map(s => s.shopName || 'Shopee Store'))).filter(Boolean);

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

  const filteredSales = sales.filter(s => {
    const matchesSearch = s.productName.toLowerCase().includes(search.toLowerCase()) || s.sku.toLowerCase().includes(search.toLowerCase());
    const saleDate = new Date(s.date);
    const matchesMonth = selectedMonth === 'all' || (saleDate.getMonth() + 1).toString().padStart(2, '0') === selectedMonth;
    const matchesYear = selectedYear === 'all' || saleDate.getFullYear().toString() === selectedYear;
    const matchesShop = selectedShop === 'all' || (s.shopName || 'Shopee Store') === selectedShop;
    return matchesSearch && matchesMonth && matchesYear && matchesShop;
  });

  const totalOmzet = filteredSales.reduce((acc, s) => acc + s.omzet, 0);
  
  const getProductInfo = (sku: string, productName: string) => {
    const normalize = (val: string) => val?.toLowerCase().replace(/[^a-z0-9]/g, '').trim() || '';
    const cleanWords = (val: string) => val?.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1) || [];

    const nSku = normalize(sku);
    const nName = normalize(productName);
    const wordsName = cleanWords(productName);

    if (!nSku && !nName) return null;

    // 1. Match by SKU
    let product = products.find(p => 
      p.sku && 
      sku && 
      sku !== 'NO-SKU' && 
      sku !== 'Tanpa SKU' &&
      normalize(p.sku) === nSku
    );
    
    // 2. Match by exact normalized name
    if (!product && nName) {
      product = products.find(p => normalize(p.name) === nName);
    }
    
    // 3. Match by Containment (HPP name is inside Sales name or vice versa)
    if (!product && nName) {
      product = products.find(p => {
        const pNorm = normalize(p.name);
        if (pNorm.length < 4) return false;
        return nName.includes(pNorm) || pNorm.includes(nName);
      });
    }

    // 4. Word-based intersection (Lowered threshold and better handling)
    if (!product && wordsName.length > 0) {
      product = products.find(p => {
        const pWords = cleanWords(p.name);
        if (pWords.length === 0) return false;
        
        const matches = pWords.filter(pw => wordsName.some(wn => wn === pw || wn.includes(pw) || pw.includes(wn)));
        const matchRatio = matches.length / pWords.length;
        
        // If core words match (first 2 words), be more lenient
        if (pWords.length >= 2 && wordsName.length >= 2) {
          if (pWords[0] === wordsName[0] && pWords[1] === wordsName[1]) return true;
        }
        
        return matchRatio >= 0.5; // Lowered from 0.7 to handle weight variations better
      });
    }

    if (!product) return null;

    const modal = product.hpp || 0;
    const jual = product.hargaJual || 0;
    const diskon = product.diskon || 0;
    const final = jual - diskon;
    
    const byAdmin = final * 0.07;
    const goExtra = final * 0.05;
    const promoXtra = final * 0.04;
    
    const bersih = final - byAdmin - goExtra - promoXtra;
    const labaPerProduk = bersih - modal;

    return { 
      labaPerProduk, 
      matchedName: product.name,
      matchedSku: product.sku
    };
  };

  const totalPenghasilanNet = filteredSales.reduce((acc, s) => acc + (s.quantity * (getProductInfo(s.sku, s.productName)?.labaPerProduk || 0)), 0);
  const totalProfit = filteredSales.reduce((acc, s) => acc + s.profit, 0);
  const totalOrders = filteredSales.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Manajemen Penjualan</h1>
          <p className="text-xs sm:text-sm text-slate-500">Input data penjualan harian dan pantau profit.</p>
        </div>
        <div className="flex flex-row flex-wrap gap-2 w-full md:w-auto">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImportCSV} 
            className="hidden" 
            accept=".csv, .xlsx, .xls"
          />
          <Button 
            variant="outline" 
            size="sm"
            className="flex-1 md:flex-none border-slate-200 dark:border-slate-800 text-[10px] sm:text-xs h-9"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
          >
            {isImporting ? <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2 animate-spin" /> : <Upload className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />}
            Import
          </Button>
          <Button 
            variant="ghost" 
            size="sm"
            className="flex-1 md:flex-none text-red-500 hover:text-red-600 hover:bg-red-50 text-[10px] sm:text-xs h-9"
            onClick={() => setIsClearAllOpen(true)}
          >
            <Trash2 className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" /> Hapus
          </Button>
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger render={<Button size="sm" className="flex-1 md:flex-none bg-orange-500 hover:bg-orange-600 text-[10px] sm:text-xs h-9" />}>
              <Plus className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" /> Input
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Input Penjualan Baru</DialogTitle>
              </DialogHeader>
              <form key={isAddOpen ? 'open' : 'closed'} onSubmit={handleAddSale} className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="date">Tanggal</Label>
                    <Input id="date" name="date" type="date" required defaultValue={format(new Date(), 'yyyy-MM-dd')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="shopName">Nama Toko</Label>
                    <Input id="shopName" name="shopName" placeholder="Contoh: Sajian Padang Instan" defaultValue={selectedShop !== 'all' ? selectedShop : ''} required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="sku">SKU</Label>
                    <Input id="sku" name="sku" placeholder="TS-001" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="productName">Nama Produk</Label>
                    <Input id="productName" name="productName" placeholder="Nama Produk" required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="quantity">Jumlah</Label>
                    <Input id="quantity" name="quantity" type="number" min="1" required defaultValue="1" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="price">Harga Jual (Satuan)</Label>
                    <Input id="price" name="price" type="number" required placeholder="0" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="adminFee">Biaya Admin Shopee</Label>
                    <Input id="adminFee" name="adminFee" type="number" defaultValue="0" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="shippingFee">Ongkir (Opsional)</Label>
                    <Input id="shippingFee" name="shippingFee" type="number" defaultValue="0" />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600">Simpan Penjualan</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: 'Total Omzet', value: totalOmzet, color: 'text-gray-900' },
          { label: 'Profit Kotor', value: totalProfit, color: 'text-orange-600' },
          { label: 'Total Penghasilan', value: totalPenghasilanNet, color: 'text-green-600' },
          { label: 'Total Order', value: totalOrders, color: 'text-blue-600', isRaw: true },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-3 sm:p-4 rounded-xl border border-gray-200">
            <p className="text-[9px] sm:text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-0.5 sm:mb-1">{stat.label}</p>
            <p className={cn("text-sm sm:text-xl font-bold", stat.color)}>
              {stat.isRaw ? stat.value : formatCurrency(stat.value as number)}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
        <div className="p-3 sm:p-4 border-b border-gray-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
          <h3 className="text-xs sm:text-sm font-bold uppercase tracking-tight">Recap Penjualan</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 items-center gap-2 w-full lg:w-auto">
            <Select value={selectedShop} onValueChange={setSelectedShop}>
              <SelectTrigger className="h-8 text-[10px] sm:text-[11px] font-medium w-full border-slate-200">
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
              <SelectTrigger className="h-8 text-[10px] sm:text-[11px] font-medium w-full border-slate-200">
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
              <SelectTrigger className="h-8 text-[10px] sm:text-[11px] font-medium w-full border-slate-200">
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
                placeholder="Cari SKU..." 
                className="pl-9 h-8 text-[10px] sm:text-[11px] border-gray-200 w-full"
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
          ) : filteredSales.length === 0 ? (
            <div className="p-8 text-center text-[10px] text-gray-500 font-bold uppercase bg-white border-y border-gray-100">
              Belum ada data penjualan.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredSales.map((sale) => {
                const info = getProductInfo(sale.sku, sale.productName);
                return (
                  <div key={sale.id} className="p-4 bg-white space-y-2">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 pr-4">
                        <div className="text-[10px] font-bold text-gray-400 mb-0.5">{format(new Date(sale.date), 'dd MMM yyyy')}</div>
                        <div className="text-xs font-bold text-gray-900 leading-tight mb-1">{sale.productName}</div>
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] font-bold bg-slate-100 px-1 py-0.5 rounded text-slate-500 uppercase italic">{sale.sku}</span>
                          <span className="text-[8px] font-bold text-orange-600 bg-orange-50 px-1 py-0.5 rounded uppercase">{sale.shopName || 'Shopee Store'}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] font-bold text-gray-400">JUMLAH</div>
                        <div className="text-sm font-bold text-gray-900">{sale.quantity}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-50">
                       <div>
                         <div className="text-[9px] text-gray-400 font-bold uppercase">Omzet</div>
                         <div className="text-xs font-bold text-gray-700">{formatCurrency(sale.omzet)}</div>
                       </div>
                       <div>
                         <div className="text-[9px] text-gray-400 font-bold uppercase">Profit Kotor</div>
                         <div className="text-xs font-bold text-orange-600">{formatCurrency(sale.profit)}</div>
                       </div>
                       <div>
                         <div className="text-[9px] text-gray-400 font-bold uppercase">Penghasilan</div>
                         <div className="text-xs font-bold text-green-600">
                            {info ? formatCurrency(sale.quantity * info.labaPerProduk) : '-'}
                         </div>
                       </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2">Tanggal</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2">Toko</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2">Nama Produk</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2 text-center">Sold</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2 text-right">Fee Admin</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2 text-right">Omzet</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2 text-right">Profit Kotor</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2 text-right">Total Penghasilan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs divide-y divide-gray-100">
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    <div className="flex items-center justify-center">
                      <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                      <span className="ml-2 text-[10px]">Memuat data...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredSales.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-[10px] text-gray-500 font-bold uppercase">
                    Belum ada data penjualan.
                  </TableCell>
                </TableRow>
              ) : (
                filteredSales.map((sale) => (
                  <TableRow key={sale.id} className="hover:bg-gray-50 transition-colors">
                    <TableCell className="px-4 py-2 font-medium">{format(new Date(sale.date), 'dd MMM yyyy')}</TableCell>
                    <TableCell className="px-4 py-2">
                       <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                         {sale.shopName || 'Shopee Store'}
                       </span>
                    </TableCell>
                    <TableCell className="px-4 py-2">
                      <div className="font-bold">{sale.productName}</div>
                      <div className="text-[10px] text-gray-400 font-mono italic">{sale.sku}</div>
                    </TableCell>
                    <TableCell className="px-4 py-2 text-center font-bold">{sale.quantity}</TableCell>
                    <TableCell className="px-4 py-2 text-right text-gray-400">-{formatCurrency(sale.adminFee)}</TableCell>
                    <TableCell className="px-4 py-2 text-right font-medium text-gray-600">{formatCurrency(sale.omzet)}</TableCell>
                    <TableCell className="px-4 py-2 text-right font-bold text-orange-600">
                      {formatCurrency(sale.profit)}
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right font-bold text-green-600">
                      {(() => {
                        const info = getProductInfo(sale.sku, sale.productName);
                        if (!info) return (
                          <div className="text-[8px] text-red-500 font-normal uppercase leading-tight">
                            Tidak Terbaca<br/>(Cek SKU/HPP)
                          </div>
                        );
                        return formatCurrency(sale.quantity * info.labaPerProduk);
                      })()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <Dialog open={isClearAllOpen} onOpenChange={setIsClearAllOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-600 font-bold uppercase tracking-tight text-xs">Konfirmasi Hapus Semua</DialogTitle>
          </DialogHeader>
          <div className="py-4 text-xs text-gray-600">
            Apakah Anda yakin ingin menghapus SEMUA data penjualan? Tindakan ini tidak dapat dibatalkan.
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <button className={cn(buttonVariants({ variant: 'outline' }), "h-8 text-[10px] font-bold uppercase")} onClick={() => setIsClearAllOpen(false)}>Batal</button>
            <button className={cn(buttonVariants({ variant: 'destructive' }), "h-8 text-[10px] font-bold uppercase")} onClick={handleClearAllSales}>Ya, Hapus Semua</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
