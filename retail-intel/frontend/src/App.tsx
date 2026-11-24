import { Link, NavLink, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { OnlineBadge, Toast } from "./components/ui";
import { useApp } from "./state/AppContext";
import CaptureHub from "./pages/store/Capture";
import Catalog from "./pages/store/Catalog";
import StoreOrders from "./pages/store/Orders";
import RewardsPage from "./pages/store/Rewards";
import SyncQueue from "./pages/store/SyncQueue";
import Overview from "./pages/portal/Overview";
import PortalOrders from "./pages/portal/Orders";
import AuditLog from "./pages/portal/Audit";

const Logo = () => (
  <Link to="/" className="flex items-center gap-2 font-bold tracking-wide text-slate-900">
    <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-500 text-xs text-white">KW</span>
    <span className="hidden sm:inline">KWADERNO <span className="font-medium text-slate-500">Retail Intelligence</span></span>
  </Link>
);

function StorePicker() {
  const { stores, storeId, setStoreId } = useApp();
  return (
    <select aria-label="Store" className="input w-auto max-w-[11rem] py-1.5" value={storeId ?? ""} onChange={(e) => setStoreId(Number(e.target.value))}>
      {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

const STORE_TABS = [["capture", "Capture"], ["catalog", "Stock"], ["orders", "Restock"], ["rewards", "Rewards"], ["sync", "Sync"]] as const;

function StoreLayout() {
  return (
    <div className="min-h-screen pb-20 md:pb-6">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2.5"><Logo /><div className="ml-auto flex items-center gap-2"><StorePicker /><OnlineBadge /></div></div>
        <nav className="mx-auto hidden max-w-5xl gap-1 px-4 pb-2 md:flex" aria-label="Store">
          {STORE_TABS.map(([to, label]) => <NavLink key={to} to={`/store/${to}`} className={({ isActive }) => `rounded-lg px-3 py-1.5 text-sm font-semibold ${isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"}`}>{label}</NavLink>)}
          <Link to="/portal" className="ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Operations portal →</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-4"><Outlet /></main>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-slate-200 bg-white md:hidden" aria-label="Store">
        {STORE_TABS.map(([to, label]) => <NavLink key={to} to={`/store/${to}`} className={({ isActive }) => `py-3 text-center text-xs font-semibold ${isActive ? "text-brand-600" : "text-slate-500"}`}>{label}</NavLink>)}
      </nav>
      <Toast />
    </div>
  );
}

const PORTAL_TABS = [["overview", "Overview"], ["orders", "Wholesale orders"], ["audit", "Verification log"]] as const;

function PortalLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-3"><Logo /><span className="chip bg-slate-900 text-white">Brand & operations portal</span>
          <div className="ml-auto flex items-center gap-2"><Link to="/store/capture" className="btn btn-sm">Merchant app</Link><OnlineBadge /></div></div>
        <nav className="mx-auto flex max-w-7xl gap-1 px-6 pb-2" aria-label="Portal">
          {PORTAL_TABS.map(([to, label]) => <NavLink key={to} to={`/portal/${to}`} className={({ isActive }) => `rounded-lg px-3 py-1.5 text-sm font-semibold ${isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"}`}>{label}</NavLink>)}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6"><Outlet /></main>
      <Toast />
    </div>
  );
}

function Home() {
  const { visionProvider } = useApp();
  return (
    <div className="mx-auto grid min-h-screen max-w-3xl content-center gap-6 px-4 py-10">
      <div><Logo /><h1 className="mt-4 text-3xl font-bold">Shelf photos, receipts and ledgers → live stock, restock orders and brand insight.</h1>
        <p className="mt-2 text-slate-600">Vision provider: <b>{visionProvider}</b>. Works offline; changes sync when you are back online.</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/store/capture" className="card hover:border-brand-500"><div className="text-lg font-bold">Merchant app</div><p className="mt-1 text-sm text-slate-600">Capture photos, scan barcodes, update stock, build restock orders, earn points. Mobile-first.</p></Link>
        <Link to="/portal/overview" className="card hover:border-brand-500"><div className="text-lg font-bold">Operations portal</div><p className="mt-1 text-sm text-slate-600">All stores: share of shelf, stock health, out-of-stock alerts, wholesale queue, verification log.</p></Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/store" element={<StoreLayout />}>
        <Route index element={<Navigate to="capture" replace />} />
        <Route path="capture" element={<CaptureHub />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="orders" element={<StoreOrders />} />
        <Route path="rewards" element={<RewardsPage />} />
        <Route path="sync" element={<SyncQueue />} />
      </Route>
      <Route path="/portal" element={<PortalLayout />}>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<Overview />} />
        <Route path="orders" element={<PortalOrders />} />
        <Route path="audit" element={<AuditLog />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
