import React, { useState, useEffect } from 'react';
import { Plus, Search, Edit2, Trash2, Loader2, Upload, FileSpreadsheet } from 'lucide-react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc,
  writeBatch,
  getDocs,
  serverTimestamp 
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db, auth, handleFirestoreError } from '../lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Product } from '../types';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isClearAllOpen, setIsClearAllOpen] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const filteredProducts = products.filter(p => 
    p.sku.toLowerCase().includes(search.toLowerCase()) || 
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    if (!auth.currentUser) return;
    
    const q = query(
      collection(db, 'products'), 
      where('userId', '==', auth.currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Product[];
      setProducts(docs);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, 'list', 'products');
    });

    return () => unsubscribe();
  }, []);

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!auth.currentUser) return;

    const formData = new FormData(e.currentTarget);
    const sku = formData.get('sku') as string;
    const name = formData.get('name') as string;
    const hpp = Number(formData.get('hpp'));
    const hargaJual = Number(formData.get('hargaJual'));
    const diskon = Number(formData.get('diskon') || 0);

    const data = {
      sku,
      name,
      hpp,
      hargaJual,
      diskon,
      userId: auth.currentUser.uid,
      updatedAt: new Date().toISOString()
    };

    try {
      if (editingProduct?.id) {
        await updateDoc(doc(db, 'products', editingProduct.id), data);
        toast.success("Produk diperbarui");
      } else {
        await addDoc(collection(db, 'products'), data);
        toast.success("Produk ditambahkan");
      }
      setIsAddOpen(false);
      setEditingProduct(null);
    } catch (error) {
      handleFirestoreError(error, editingProduct ? 'update' : 'create', 'products');
    }
  };

  const handleDelete = async (id: string | undefined) => {
    if (!id) return;
    if (confirm('Hapus produk ini?')) {
      try {
        await deleteDoc(doc(db, 'products', id));
        toast.success("Produk dihapus");
      } catch (error) {
        handleFirestoreError(error, 'delete', 'products');
      }
    }
  };

  const handleImportHpp = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
        
        const data = XLSX.utils.sheet_to_json(ws) as any[];
        let importedCount = 0;

        const sanitizeNum = (val: any) => {
          if (typeof val === 'number') return val;
          if (!val) return 0;
          const str = val.toString().trim();
          // Indonesian format: 60.127 or 60.127,00
          // Remove all dots (thousands separator) and replace comma with dot (decimal)
          const clean = str.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
          return Number(clean);
        };
        
        const findValue = (row: any, keywords: string[]) => {
          const keys = Object.keys(row);
          for (const key of keys) {
            const lowerKey = key.toLowerCase().trim();
            if (keywords.every(kw => lowerKey.includes(kw.toLowerCase()))) {
              return row[key];
            }
          }
          return null;
        };
        
        for (const row of data) {
          const name = (findValue(row, ['Nama Produk']) || findValue(row, ['Nama']) || findValue(row, ['product_name']) || '').toString().trim();
          if (!name) continue;

          const sku = (findValue(row, ['SKU']) || name).toString().trim();
          const hpp = sanitizeNum(findValue(row, ['Harga Modal']) || findValue(row, ['HPP']) || findValue(row, ['Modal']) || findValue(row, ['cost']) || 0);
          const hargaJual = sanitizeNum(findValue(row, ['Harga Jual']) || findValue(row, ['Jual']) || findValue(row, ['price']) || 0);
          const hargaFinal = sanitizeNum(findValue(row, ['Harga Final']) || findValue(row, ['Final']) || 0);
          const diskon = hargaFinal > 0 && hargaJual > 0 ? (hargaJual - hargaFinal) : sanitizeNum(findValue(row, ['Diskon']) || 0);

          if (sku && name) {
            const q = query(collection(db, 'products'), where('sku', '==', sku), where('userId', '==', auth.currentUser!.uid));
            const snap = await getDocs(q);
            
            const productData = {
              sku,
              name,
              hpp,
              hargaJual,
              diskon,
              userId: auth.currentUser!.uid,
              updatedAt: new Date().toISOString()
            };

            if (!snap.empty) {
              await updateDoc(doc(db, 'products', snap.docs[0].id), productData);
            } else {
              await addDoc(collection(db, 'products'), productData);
            }
            importedCount++;
          }
        }

        toast.success(`Berhasil mengimpor ${importedCount} data HPP`);
      } catch (error) {
        console.error("Import error:", error);
        toast.error("Gagal mengimpor file HPP");
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const handleClearAll = async () => {
    if (!auth.currentUser) return;
    try {
      const q = query(collection(db, 'products'), where('userId', '==', auth.currentUser.uid));
      const snap = await getDocs(q);
      
      const batch = writeBatch(db);
      snap.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      toast.success("Semua data produk telah dihapus");
      setIsClearAllOpen(false);
    } catch (error) {
      handleFirestoreError(error, 'delete', 'products');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Master Produk & HPP</h1>
          <p className="text-xs sm:text-sm text-slate-500">Kelola SKU dan Harga Pokok untuk kalkulasi profit.</p>
        </div>
        <div className="flex flex-row flex-wrap gap-2 w-full md:w-auto">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImportHpp} 
            className="hidden" 
            accept=".xlsx, .xls, .csv"
          />
          <Button 
            variant="outline" 
            size="sm"
            className="flex-1 md:flex-none border-slate-200 text-[10px] sm:text-xs h-9"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
          >
            {isImporting ? <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2 animate-spin" /> : <FileSpreadsheet className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />}
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

          <Dialog open={isAddOpen || !!editingProduct} onOpenChange={(open) => {
            if (!open) {
              setIsAddOpen(false);
              setEditingProduct(null);
            }
          }}>
            <DialogTrigger render={<Button size="sm" className="flex-1 md:flex-none bg-orange-500 hover:bg-orange-600 text-[10px] sm:text-xs h-9" onClick={() => setIsAddOpen(true)} />}>
              <Plus className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" /> Tambah
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingProduct ? 'Edit Produk' : 'Tambah Produk Baru'}</DialogTitle>
              </DialogHeader>
              <form key={editingProduct?.id || 'new'} onSubmit={handleSave} className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="sku">SKU</Label>
                  <Input id="sku" name="sku" defaultValue={editingProduct?.sku} placeholder="Contoh: TS-001" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Nama Produk</Label>
                  <Input id="name" name="name" defaultValue={editingProduct?.name} placeholder="Nama lengkap produk" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hpp">HPP (Harga Pokok)</Label>
                  <Input id="hpp" name="hpp" type="number" defaultValue={editingProduct?.hpp} placeholder="0" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hargaJual">Harga Jual</Label>
                  <Input id="hargaJual" name="hargaJual" type="number" defaultValue={editingProduct?.hargaJual} placeholder="0" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="diskon">Diskon</Label>
                  <Input id="diskon" name="diskon" type="number" defaultValue={editingProduct?.diskon} placeholder="0" />
                </div>
                <DialogFooter>
                  <Button type="submit" className="bg-orange-500 hover:bg-orange-600">Simpan</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Dialog open={isClearAllOpen} onOpenChange={setIsClearAllOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-600 font-bold uppercase tracking-tight text-xs">Konfirmasi Hapus Semua</DialogTitle>
          </DialogHeader>
          <div className="py-4 text-xs text-gray-600">
            Apakah Anda yakin ingin menghapus SEMUA data produk? Tindakan ini tidak dapat dibatalkan.
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <button className="h-8 px-4 text-[10px] font-bold uppercase border border-gray-200 rounded-md hover:bg-gray-50" onClick={() => setIsClearAllOpen(false)}>Batal</button>
            <button className="h-8 px-4 text-[10px] font-bold uppercase bg-red-600 text-white rounded-md hover:bg-red-700" onClick={handleClearAll}>Ya, Hapus Semua</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
        <div className="p-3 sm:p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <h3 className="text-xs sm:text-sm font-bold uppercase tracking-tight">Katalog Produk</h3>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <Input 
              placeholder="Cari SKU atau nama..." 
              className="pl-9 h-8 text-[10px] sm:text-[11px] border-gray-200 focus-visible:ring-orange-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="block md:hidden overflow-hidden bg-gray-50/50">
          {loading ? (
            <div className="p-8 text-center bg-white border-y border-gray-100">
              <Loader2 className="w-5 h-5 mx-auto animate-spin text-orange-500" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="p-8 text-center text-[10px] text-gray-500 font-bold uppercase bg-white border-y border-gray-100">
              Tidak ada data produk.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredProducts.map((product) => {
                const modal = product.hpp || 0;
                const jual = product.hargaJual || 0;
                const diskon = product.diskon || 0;
                const final = jual - diskon;
                const byAdmin = final * 0.07;
                const goExtra = final * 0.05;
                const promoXtra = final * 0.04;
                const bersih = final - byAdmin - goExtra - promoXtra;
                const laba = bersih - modal;

                return (
                  <div key={product.id} className="p-4 bg-white space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 pr-2">
                        <div className="text-[10px] font-bold text-gray-400 mb-0.5 tracking-wider font-mono">#{product.sku}</div>
                        <div className="text-xs font-bold text-gray-900 leading-tight">{product.name}</div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="outline" size="icon" className="h-7 w-7 p-0 border-gray-100" onClick={() => setEditingProduct(product)}>
                          <Edit2 className="w-3 h-3" />
                        </Button>
                        <Button variant="outline" size="icon" className="h-7 w-7 p-0 border-gray-100 text-red-500" onClick={() => handleDelete(product.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-50">
                      <div>
                        <div className="text-[9px] text-gray-400 font-bold uppercase">Harga Modal</div>
                        <div className="text-xs font-bold text-gray-700">{formatCurrency(modal)}</div>
                      </div>
                      <div>
                         <div className="text-[9px] text-gray-400 font-bold uppercase">Harga Jual</div>
                         <div className="text-xs font-bold text-blue-600">{formatCurrency(jual)}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 p-3 bg-green-50 rounded-lg">
                      <div>
                        <div className="text-[9px] text-green-600/70 font-bold uppercase">Bersih</div>
                        <div className="text-xs font-bold text-green-700">{formatCurrency(Math.round(bersih))}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-green-600/70 font-bold uppercase">Laba</div>
                        <div className="text-sm font-black text-green-700">{formatCurrency(Math.round(laba))}</div>
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
            <TableHeader>
              <TableRow className="bg-[#FFFF00] hover:bg-[#FFFF00]">
                <TableHead className="text-[10px] uppercase font-bold text-black border border-gray-200">No.</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-black border border-gray-200">Nama Produk</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-black border border-gray-200 text-center">Harga Modal</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-black border border-gray-200 text-center">Harga Jual</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-black border border-gray-200 text-center">Diskon</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-black border border-gray-200 text-center">Harga Final</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-black border border-gray-200 text-center">% Keuntungan Kotor</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-black border border-gray-200 text-center">By Admin (7%)</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-black border border-gray-200 text-center">GO Extra (5%)</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-black border border-gray-200 text-center">Promo Xtra (4%)</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-black border border-gray-200 text-center">Penjualan Bersih</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-black border border-gray-200 text-center">Laba per Produk</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-black border border-gray-200 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs divide-y divide-gray-100">
              {loading ? (
                <TableRow>
                  <TableCell colSpan={13} className="h-24 text-center">
                    <div className="flex items-center justify-center">
                      <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                      <span className="ml-2 text-[10px]">Memuat...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredProducts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="h-24 text-center text-[10px] text-gray-500 font-bold uppercase">
                    Tidak ada data produk.
                  </TableCell>
                </TableRow>
              ) : (
                filteredProducts.map((product, index) => {
                  const modal = product.hpp || 0;
                  const jual = product.hargaJual || 0;
                  const diskon = product.diskon || 0;
                  const final = jual - diskon;
                  
                  // % Keuntungan kotor = (Harga Final - Harga Modal) / Harga Final
                  const untungKotorPersen = final > 0 ? ((final - modal) / final) * 100 : 0;
                  
                  const byAdmin = final * 0.07;
                  const goExtra = final * 0.05;
                  const promoXtra = final * 0.04;
                  
                  const bersih = final - byAdmin - goExtra - promoXtra;
                  const laba = bersih - modal;

                  return (
                    <TableRow key={product.id} className="hover:bg-gray-50 transition-colors border-b border-gray-100">
                      <TableCell className="px-4 py-2 text-center font-bold border-r border-gray-100">{index + 1}</TableCell>
                      <TableCell className="px-4 py-2 font-bold border-r border-gray-100">
                        {product.name}
                        <span className="block text-[8px] text-gray-400 font-mono mt-0.5">{product.sku}</span>
                      </TableCell>
                      <TableCell className="px-4 py-2 text-center font-medium bg-[#E2EFDA] border-r border-gray-100">{formatCurrency(modal)}</TableCell>
                      <TableCell className="px-4 py-2 text-center font-medium bg-[#D9E1F2] border-r border-gray-100">{formatCurrency(jual)}</TableCell>
                      <TableCell className="px-4 py-2 text-center text-gray-400 border-r border-gray-100">{diskon > 0 ? formatCurrency(diskon) : '-'}</TableCell>
                      <TableCell className="px-4 py-2 text-center font-bold border-r border-gray-100">{formatCurrency(final)}</TableCell>
                      <TableCell className="px-4 py-2 text-center font-medium border-r border-gray-100">{untungKotorPersen.toFixed(2).replace('.', ',')}%</TableCell>
                      <TableCell className="px-4 py-2 text-center text-gray-600 border-r border-gray-100">{formatCurrency(Math.round(byAdmin))}</TableCell>
                      <TableCell className="px-4 py-2 text-center text-gray-600 border-r border-gray-100">{formatCurrency(Math.round(goExtra))}</TableCell>
                      <TableCell className="px-4 py-2 text-center text-gray-600 border-r border-gray-100">{formatCurrency(Math.round(promoXtra))}</TableCell>
                      <TableCell className="px-4 py-2 text-center font-bold text-slate-700 border-r border-gray-100">{formatCurrency(Math.round(bersih))}</TableCell>
                      <TableCell className="px-4 py-2 text-center font-bold text-green-600 border-r border-gray-100">{formatCurrency(Math.round(laba))}</TableCell>
                      <TableCell className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditingProduct(product)}>
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-600" onClick={() => handleDelete(product.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
