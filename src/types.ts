export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
}

export interface Product {
  id?: string;
  sku: string;
  name: string;
  hpp: number;
  hargaJual?: number;
  diskon?: number;
  userId: string;
  updatedAt: string;
}

export interface Sale {
  id?: string;
  date: string;
  shopName?: string;
  productName: string;
  sku: string;
  quantity: number;
  price: number;
  adminFee: number;
  shippingFee: number;
  omzet: number;
  profit: number;
  userId: string;
}

export interface AdCampaign {
  id?: string;
  date: string;
  shopName?: string;
  campaignName: string;
  cost: number;
  salesFromAds: number;
  roas: number;
  userId: string;
}

export interface Receipt {
  id?: string;
  date: string;
  supplier: string;
  total: number;
  note: string;
  imageUrl?: string;
  userId: string;
  updatedAt: string;
}

export interface DashboardStats {
  totalOmzet: number;
  totalProfit: number;
  totalOrders: number;
  totalAdSpend: number;
  totalAdSales: number;
  avgRoas: number;
}
