"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/lib/workspace";

export function AccountAccess() {
  const router = useRouter();
  const { user, authReady, signIn, register, signOut } = useWorkspace();
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await (mode === "register" ? register(email, password) : signIn(email, password));
      router.replace("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your local account request failed.");
    } finally { setBusy(false); }
  }

  return <div className="account-page page-content">
    <section className="panel account-card">
      <span className="account-icon"><LockKeyhole size={20}/></span>
      {user ? <>
        <p className="page-kicker">YOUR LOCAL ACCOUNT</p><h1>Welcome back.</h1>
        <p className="muted">Signed in as <strong>{user.email}</strong>. Your projects and exports are scoped to this account.</p>
        <div className="account-privacy"><ShieldCheck size={17}/><span>Files stay in this local workspace. Passwords are stored as one-way hashes.</span></div>
        <div className="form-actions"><Button asChild variant="outline"><Link href="/">Open workspace</Link></Button><Button variant="ghost" onClick={async()=>{setBusy(true);try{await signOut();setError(null);}catch(cause){setError(cause instanceof Error?cause.message:"Could not sign out.");}finally{setBusy(false);}}} disabled={busy}>Sign out</Button></div>
      </> : <>
        <p className="page-kicker">A PRIVATE LOCAL WORKSPACE</p><h1>{mode === "register" ? "Create your account." : "Welcome back."}</h1>
        <p className="muted">Save projects, edits, assets, and MP4 exports in your own workspace.</p>
        <form className="account-form" onSubmit={submit}>
          <div className="field"><Label htmlFor="account-email">Email address</Label><Input id="account-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} placeholder="you@example.com"/></div>
          <div className="field"><Label htmlFor="account-password">Password</Label><Input id="account-password" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={12} maxLength={128} value={password} onChange={event=>setPassword(event.target.value)} placeholder="At least 12 characters"/><small className="field-help">Use at least 12 characters.</small></div>
          {error&&<p className="form-error" role="alert">{error}</p>}
          <Button type="submit" disabled={!authReady||busy}>{!authReady?"Checking account…":busy?"Please wait…":mode === "register" ? "Create local account" : "Sign in"}<ArrowRight size={15}/></Button>
        </form>
        <div className="account-mode"><span>{mode === "register" ? "Already have an account?" : "New to Motion DNA AI?"}</span><button type="button" onClick={()=>{setMode(mode === "register" ? "login" : "register");setError(null);}}>{mode === "register" ? "Sign in" : "Create an account"}</button></div>
        <div className="account-privacy"><ShieldCheck size={17}/><span>Local development account. No payment, email verification, or cloud service is required.</span></div>
      </>}
    </section>
  </div>;
}
