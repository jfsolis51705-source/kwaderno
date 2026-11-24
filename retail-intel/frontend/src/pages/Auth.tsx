import { useState, type FormEvent, type InputHTMLAttributes } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../state/AppContext";

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { login, register, online } = useApp();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [f, setF] = useState({ email: "", password: "", name: "", store_name: "", barangay: "", city: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      if (mode === "login") await login(f.email, f.password);
      else await register({ email: f.email, password: f.password, name: f.name, store_name: f.store_name, barangay: f.barangay || undefined, city: f.city || undefined });
      nav(from && from !== "/login" ? from : "/store/capture", { replace: true });
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };
  const field = (k: keyof typeof f, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label><span className="label">{label}</span><input className="input py-2.5" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></label>
  );
  return (
    <div className="mx-auto grid min-h-screen max-w-md content-center gap-5 px-4 py-10">
      <Link to="/" className="flex items-center gap-2 font-bold"><span className="grid h-8 w-8 place-items-center rounded-md bg-brand-500 text-xs text-white">KW</span>KWADERNO</Link>
      <h1 className="text-2xl font-bold">{mode === "login" ? "Log in" : "Create your store account"}</h1>
      <form className="card grid gap-3" onSubmit={submit} aria-label={mode === "login" ? "Log in" : "Register"}>
        {mode === "register" ? <>{field("name", "Your name", { required: true, autoComplete: "name" })}{field("store_name", "Store name", { required: true, placeholder: "e.g. Aling Nena Sari-sari" })}
          <div className="grid grid-cols-2 gap-3">{field("barangay", "Barangay")}{field("city", "City")}</div></> : null}
        {field("email", "Email", { type: "email", required: true, autoComplete: "email" })}
        {field("password", "Password", { type: "password", required: true, minLength: mode === "register" ? 8 : 1, autoComplete: mode === "login" ? "current-password" : "new-password" })}
        {mode === "register" ? <p className="-mt-1 text-xs text-slate-500">At least 8 characters.</p> : null}
        {err ? <div role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-800">{err}</div> : null}
        {!online ? <div className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900">You're offline — logging in needs a connection.</div> : null}
        <button className="btn-primary py-3" disabled={busy} type="submit">{busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}</button>
      </form>
      <p className="text-center text-sm text-slate-600">{mode === "login" ? <>New store? <Link className="font-semibold text-brand-600" to="/register">Create an account</Link></> : <>Have an account? <Link className="font-semibold text-brand-600" to="/login">Log in</Link></>}</p>
    </div>
  );
}
