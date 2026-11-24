import { BarChart3, Boxes, Home, ReceiptText, Settings, ShoppingCart, Users, ScanLine, PackagePlus, RefreshCw, ShieldCheck, CalendarClock } from "lucide-react";

export const NAV = [
  { href: "/dashboard", label: "Dashboard", short: "Home", icon: Home, mobile: true },
  { href: "/sell", label: "Sell", short: "Sell", icon: ShoppingCart, mobile: true },
  { href: "/scan", label: "Scan", short: "Scan", icon: ScanLine, mobile: true, primary: true },
  { href: "/products", label: "Products & Stock", short: "Stock", icon: Boxes, mobile: true },
  { href: "/stock-in", label: "Stock-in", short: "Stock-in", icon: PackagePlus, mobile: false },
  { href: "/expiry", label: "Expiry", short: "Expiry", icon: CalendarClock, mobile: false },
  { href: "/receipts", label: "Receipts", short: "Receipts", icon: ReceiptText, mobile: false },
  { href: "/customers", label: "Customers & Utang", short: "Utang", icon: Users, mobile: true },
  { href: "/reports", label: "Reports", short: "Reports", icon: BarChart3, mobile: false },
  { href: "/sync", label: "Offline sync", short: "Sync", icon: RefreshCw, mobile: false },
  { href: "/audit", label: "Audit log", short: "Audit", icon: ShieldCheck, mobile: false },
  { href: "/settings", label: "Settings", short: "Settings", icon: Settings, mobile: false },
] as const;
