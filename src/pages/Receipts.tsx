import React, { useState, useRef, useEffect } from 'react';
import { Plus, Receipt as ReceiptIcon, Image as ImageIcon, Search, Calendar, User, Eye, Trash2, Loader2, Upload, Edit2, Download, Filter } from 'lucide-react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  serverTimestamp 
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, auth, storage, handleFirestoreError } from '../lib/firebase';
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
import { Textarea } from '@/components/ui/textarea';
import { Receipt } from '../types';
import { formatCurrency, cn } from '../lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<Receipt | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState('');

  useEffect(() => {
    if (!auth.currentUser) return;
    
    const q = query(
      collection(db, 'receipts'), 
      where('userId', '==', auth.currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Receipt[];
      setReceipts(docs.sort((a, b) => b.date.localeCompare(a.date)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, 'list', 'receipts');
    });

    return () => unsubscribe();
  }, []);

  const getDirectLink = (url: string | undefined) => {
    if (!url) return '';
    if (url.includes('drive.google.com')) {
      const driveIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (driveIdMatch && driveIdMatch[1]) {
        // Use lh3 service which is more reliable for direct embeds
        return `https://lh3.googleusercontent.com/d/${driveIdMatch[1]}`;
      }
    }
    return url;
  };

  const getDownloadLink = (url: string | undefined) => {
    if (!url) return '';
    if (url.includes('drive.google.com')) {
      const driveIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (driveIdMatch && driveIdMatch[1]) {
        return `https://drive.google.com/uc?export=download&id=${driveIdMatch[1]}`;
      }
    }
    return url;
  };

  const handleAddReceipt = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!auth.currentUser) return;

    setIsUploading(true);
    const formData = new FormData(e.currentTarget);
    
    // Auto-convert Google Drive links to direct image links
    const finalImageUrl = getDirectLink(imageUrlInput);

    const newReceipt: any = {
      date: formData.get('date') as string,
      supplier: formData.get('supplier') as string,
      total: Number(formData.get('total')),
      note: formData.get('note') as string,
      imageUrl: finalImageUrl || undefined,
      userId: auth.currentUser.uid,
      updatedAt: new Date().toISOString(),
    };

    try {
      await addDoc(collection(db, 'receipts'), newReceipt);
      toast.success("Nota disimpan");
      setIsAddOpen(false);
      setImageUrlInput('');
    } catch (error: any) {
      console.error("Firestore save error:", error);
      try {
        handleFirestoreError(error, 'create', 'receipts');
      } catch (innerError: any) {
        toast.error(`Gagal menyimpan data: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleEditReceipt = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!auth.currentUser || !editingReceipt?.id) return;

    setIsUploading(true);
    const formData = new FormData(e.currentTarget);
    const finalImageUrl = getDirectLink(imageUrlInput);
    
    try {
      const receiptRef = doc(db, 'receipts', editingReceipt.id);
      await updateDoc(receiptRef, {
        date: formData.get('date') as string,
        supplier: formData.get('supplier') as string,
        total: Number(formData.get('total')),
        note: formData.get('note') as string,
        imageUrl: finalImageUrl || null,
        updatedAt: new Date().toISOString(),
      });
      
      toast.success("Nota berhasil diperbarui");
      setIsEditOpen(false);
      setEditingReceipt(null);
      setImageUrlInput('');
    } catch (error: any) {
      console.error("Firestore update error:", error);
      try {
        handleFirestoreError(error, 'update', `receipts/${editingReceipt.id}`);
      } catch (innerError: any) {
        toast.error(`Gagal memperbarui data: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const startEdit = (receipt: Receipt) => {
    setEditingReceipt(receipt);
    setImageUrlInput(receipt.imageUrl || '');
    setIsEditOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    
    try {
      setIsUploading(true);
      await deleteDoc(doc(db, 'receipts', deletingId));
      toast.success("Nota berhasil dihapus");
      setIsDeleteOpen(false);
      setDeletingId(null);
    } catch (error: any) {
      console.error("Delete error details:", error);
      try {
        handleFirestoreError(error, 'delete', `receipts/${deletingId}`);
      } catch (innerError: any) {
        toast.error(`Gagal menghapus nota: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const confirmDelete = (id: string | undefined) => {
    if (!id) return;
    setDeletingId(id);
    setIsDeleteOpen(true);
  };

  const [viewingReceipt, setViewingReceipt] = useState<Receipt | null>(null);
  const [search, setSearch] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [selectedYear, setSelectedYear] = useState('all');

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">Nota Pembelian Supplier</h1>
          <p className="text-slate-500">Rekap pengadaan stok barang dari supplier.</p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={(open) => {
          setIsAddOpen(open);
          if (!open) {
            setImageUrlInput('');
          }
        }}>
          <DialogTrigger render={<button className={cn(buttonVariants({ variant: 'default' }), "bg-orange-500 hover:bg-orange-600")} />}>
            <Plus className="w-4 h-4 mr-2" /> Tambah Nota
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Upload Nota Pembelian</DialogTitle>
            </DialogHeader>
            <form key={isAddOpen ? 'open' : 'closed'} onSubmit={handleAddReceipt} className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="date">Tanggal Pembelian</Label>
                  <Input id="date" name="date" type="date" required defaultValue={format(new Date(), 'yyyy-MM-dd')} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="supplier">Nama Supplier</Label>
                  <Input id="supplier" name="supplier" placeholder="Contoh: Toko Kain XYZ" required />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="total">Total Pembelian</Label>
                <Input id="total" name="total" type="number" required placeholder="0" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="note">Catatan</Label>
                <Textarea id="note" name="note" placeholder="Daftar barang yang dibeli..." />
              </div>

              <div className="space-y-2">
                <Label htmlFor="imageUrl">URL Gambar Nota (Opsional)</Label>
                <div className="relative">
                  <ImageIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input 
                    id="imageUrl" 
                    name="imageUrl" 
                    placeholder="Contoh: https://link-gambar.com/nota.jpg" 
                    className="pl-9"
                    value={imageUrlInput}
                    onChange={(e) => setImageUrlInput(e.target.value)}
                  />
                </div>
                <p className="text-[10px] text-gray-500 italic">Tips: Anda bisa salin link gambar dari Google Drive, Imgur, atau kirim foto ke WA sendiri lalu salin link-nya.</p>
                {imageUrlInput && (
                  <div className="mt-2 border rounded-lg p-2 bg-gray-50 flex flex-col items-center">
                    <p className="text-[10px] font-bold text-gray-500 mb-1 uppercase self-start">Preview:</p>
                    <img 
                      src={getDirectLink(imageUrlInput)} 
                      alt="Preview" 
                      className="max-h-24 rounded object-cover" 
                      referrerPolicy="no-referrer"
                      onError={(e) => (e.target as any).style.display = 'none'} 
                    />
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button type="submit" className="w-full bg-orange-600 hover:bg-orange-700" disabled={isUploading}>
                  {isUploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : 'Simpan Nota'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/30">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <h3 className="text-xs font-bold uppercase tracking-tight text-slate-700">Filter & Cari Data</h3>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {/* Month Filter */}
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="h-8 text-[11px] font-medium w-[120px] bg-white">
                <SelectValue placeholder="Pilih Bulan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Bulan</SelectItem>
                {months.map(m => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Year Filter */}
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="h-8 text-[11px] font-medium w-[100px] bg-white">
                <SelectValue placeholder="Pilih Tahun" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Tahun</SelectItem>
                {years.map(y => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative w-full sm:w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <Input 
                placeholder="Cari Supplier..." 
                className="pl-9 h-8 text-[11px] border-gray-200 bg-white"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2">Tanggal</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2">Supplier</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2 text-right">Total</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2 text-center">Nota</TableHead>
                <TableHead className="text-[10px] uppercase font-bold text-gray-500 px-4 py-2 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs divide-y divide-gray-100">
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    <Loader2 className="w-5 h-5 animate-spin text-orange-500 mx-auto" />
                  </TableCell>
                </TableRow>
              ) : receipts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-[10px] text-gray-500 font-bold uppercase">
                    Belum ada data nota.
                  </TableCell>
                </TableRow>
              ) : (
                receipts
                  .filter(r => {
                    const matchesSearch = r.supplier.toLowerCase().includes(search.toLowerCase());
                    const receiptDate = new Date(r.date);
                    const matchesMonth = selectedMonth === 'all' || (receiptDate.getMonth() + 1).toString().padStart(2, '0') === selectedMonth;
                    const matchesYear = selectedYear === 'all' || receiptDate.getFullYear().toString() === selectedYear;
                    return matchesSearch && matchesMonth && matchesYear;
                  })
                  .map((receipt) => (
                  <TableRow key={receipt.id} className="hover:bg-gray-50 transition-colors">
                    <TableCell className="px-4 py-2 font-medium">{format(new Date(receipt.date), 'dd MMM yyyy')}</TableCell>
                    <TableCell className="px-4 py-2 font-bold">{receipt.supplier}</TableCell>
                    <TableCell className="px-4 py-2 text-right font-bold text-orange-600">{formatCurrency(receipt.total)}</TableCell>
                    <TableCell className="px-4 py-2 text-center">
                      {receipt.imageUrl ? (
                        <Dialog>
                          <DialogTrigger render={<button className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), "h-7 px-2 text-[10px] font-bold uppercase tracking-tight")} />}>
                            <ImageIcon className="w-3 h-3 mr-1" /> Lihat
                          </DialogTrigger>
                          <DialogContent className="max-w-3xl">
                            <div className="flex justify-between items-center mb-2">
                              <h3 className="text-[10px] font-bold uppercase text-gray-500">Bukti Nota</h3>
                              <Button variant="outline" size="sm" className="h-7 px-2 text-[10px] font-bold uppercase transition-all hover:bg-orange-50 active:scale-95" nativeButton={false} render={<a href={getDownloadLink(receipt.imageUrl)} target="_blank" rel="noopener noreferrer" />}>
                                <Download className="w-3 h-3 mr-1" /> Simpan Gambar
                              </Button>
                            </div>
                            <img 
                              src={getDirectLink(receipt.imageUrl)} 
                              alt="Nota" 
                              className="w-full h-auto rounded-lg shadow-inner border border-gray-100" 
                              referrerPolicy="no-referrer"
                            />
                          </DialogContent>
                        </Dialog>
                      ) : (
                        <span className="text-[10px] text-gray-400 font-bold">MISSING</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 w-7 p-0"
                          onClick={() => setViewingReceipt(receipt)}
                        >
                          <Eye className="w-3.5 h-3.5 text-gray-400" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 w-7 p-0"
                          onClick={() => startEdit(receipt)}
                        >
                          <Edit2 className="w-3.5 h-3.5 text-gray-400" />
                        </Button>
                        {receipt.imageUrl && (
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-500" title="Download Gambar" nativeButton={false} render={<a href={getDownloadLink(receipt.imageUrl)} target="_blank" rel="noopener noreferrer" />}>
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 w-7 p-0 text-red-500"
                          onClick={() => confirmDelete(receipt.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* View Details Modal */}
      <Dialog open={!!viewingReceipt} onOpenChange={() => setViewingReceipt(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase">Detail Nota Supplier</DialogTitle>
          </DialogHeader>
          {viewingReceipt && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-500">Supplier</p>
                  <p className="text-sm font-bold">{viewingReceipt.supplier}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-500">Tanggal</p>
                  <p className="text-sm font-bold">{format(new Date(viewingReceipt.date), 'dd MMM yyyy')}</p>
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-gray-500">Total Pembelian</p>
                <p className="text-xl font-black text-orange-600">{formatCurrency(viewingReceipt.total)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-gray-500">Catatan</p>
                <p className="text-xs text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100 italic">
                  {viewingReceipt.note || 'Tidak ada catatan.'}
                </p>
              </div>
              {viewingReceipt.imageUrl && (
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 mt-2">
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-[10px] uppercase font-bold text-gray-500">Lampiran Bukti</p>
                    <Button variant="link" className="h-auto p-0 text-[10px] font-bold uppercase text-blue-600 hover:text-blue-700" nativeButton={false} render={<a href={getDownloadLink(viewingReceipt.imageUrl)} target="_blank" rel="noopener noreferrer" />}>
                      <Download className="w-3 h-3 mr-1" /> Unduh Gambar
                    </Button>
                  </div>
                  <img 
                    src={getDirectLink(viewingReceipt.imageUrl)} 
                    alt="Nota" 
                    className="w-full h-auto rounded-lg border border-gray-200 shadow-sm" 
                    referrerPolicy="no-referrer"
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="w-full text-xs font-bold" onClick={() => setViewingReceipt(null)}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Receipt Modal */}
      <Dialog open={isEditOpen} onOpenChange={(open) => {
        setIsEditOpen(open);
        if (!open) {
          setEditingReceipt(null);
          setImageUrlInput('');
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase text-blue-600">Edit Informasi Nota</DialogTitle>
          </DialogHeader>
          {editingReceipt && (
            <form onSubmit={handleEditReceipt} className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-date" className="text-[10px] uppercase font-bold text-gray-500">Tanggal Pembelian</Label>
                  <Input id="edit-date" name="date" type="date" required defaultValue={editingReceipt.date} className="h-9 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-supplier" className="text-[10px] uppercase font-bold text-gray-500">Nama Supplier</Label>
                  <Input id="edit-supplier" name="supplier" required defaultValue={editingReceipt.supplier} className="h-9 text-xs" />
                </div>
              </div>
              
              <div className="space-y-1.5">
                <Label htmlFor="edit-total" className="text-[10px] uppercase font-bold text-gray-500">Total Pembelian</Label>
                <Input id="edit-total" name="total" type="number" required defaultValue={editingReceipt.total} className="h-9 text-xs" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-note" className="text-[10px] uppercase font-bold text-gray-500">Catatan/Keterangan</Label>
                <Textarea id="edit-note" name="note" defaultValue={editingReceipt.note} className="text-xs min-h-[80px]" placeholder="Misal: Beli kain seragam" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-imageUrl" className="text-[10px] uppercase font-bold text-gray-500">URL Gambar Nota (G-Drive/Imgur)</Label>
                <div className="relative">
                  <ImageIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                  <Input 
                    id="edit-imageUrl" 
                    name="imageUrl" 
                    placeholder="Tempel link gambar di sini..." 
                    className="pl-9 h-9 text-xs"
                    value={imageUrlInput}
                    onChange={(e) => setImageUrlInput(e.target.value)}
                  />
                </div>
                {imageUrlInput && (
                  <div className="mt-2 border rounded-lg p-2 bg-slate-50 flex flex-col items-center">
                    <p className="text-[10px] font-bold text-slate-500 mb-1 uppercase self-start">Preview:</p>
                    <img 
                      src={getDirectLink(imageUrlInput)} 
                      alt="Preview" 
                      className="max-h-24 rounded object-cover shadow-sm" 
                      referrerPolicy="no-referrer"
                      onError={(e) => (e.target as any).style.display = 'none'} 
                    />
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-[11px] font-bold uppercase tracking-wider" disabled={isUploading}>
                  {isUploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : 'Simpan Perubahan'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-600">Konfirmasi Hapus</DialogTitle>
          </DialogHeader>
          <div className="py-4 text-sm text-gray-600">
            Apakah Anda yakin ingin menghapus data nota ini? Tindakan ini tidak dapat dibatalkan.
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)} disabled={isUploading}>Batal</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isUploading}>
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : 'Ya, Hapus'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
