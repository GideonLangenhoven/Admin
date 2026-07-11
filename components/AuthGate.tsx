"use client";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "../app/lib/supabase";
import { sendAdminSetupLink, sha256 } from "../app/lib/admin-auth";
import { BusinessProvider } from "./BusinessContext";
import { BrandMark, BrandWordmark } from "./BrandLogo";

const PUBLIC_PATHS = ["/change-password", "/case-study/cape-kayak", "/compare/manual-vs-disconnected-tools"];
const MARKETING_OPTIONAL_AUTH_PATHS = ["/operators"];
const SESSION_TIMEOUT = 12 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 30 * 60 * 1000;

interface OperatorOption {
  id: string;
  name: string;
  logoUrl: string;
  timezone: string;
  subscriptionStatus: string;
  yocoTestMode: boolean;
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [locked, setLocked] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Business context from login/session
  const [businessId, setBusinessId] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [role, setRole] = useState("");
  const [operators, setOperators] = useState<OperatorOption[]>([]);
  const [subscriptionStatus, setSubscriptionStatus] = useState("ACTIVE");
  const [yocoTestMode, setYocoTestMode] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    validateSession();
    checkLockout();
  }, []);

  function checkLockout() {
    const lockUntil = Number(localStorage.getItem("ck_lock_until") || "0");
    if (lockUntil > Date.now()) {
      setLocked(true);
    } else if (lockUntil > 0) {
      localStorage.removeItem("ck_lock_until");
      localStorage.removeItem("ck_fail_count");
    }
  }

  async function loadBusinessContext(adminRole: string, defaultBusinessId: string) {
    const isMultiOperator = /super/i.test(adminRole);
    const overrideBusinessId = localStorage.getItem("ck_operator_override_business_id") || "";
    const targetBusinessId = isMultiOperator && overrideBusinessId ? overrideBusinessId : defaultBusinessId;

    const baseQuery = supabase
      .from("businesses")
      .select("id, name, business_name, logo_url, timezone, subscription_status, yoco_test_mode, subdomain")
      .order("business_name", { ascending: true });

    const businessesRes = isMultiOperator
      ? await baseQuery
      : await baseQuery.eq("id", defaultBusinessId);

    const businessRows = (businessesRes.data || []) as Array<{
      id: string;
      name: string | null;
      business_name: string | null;
      logo_url: string | null;
      timezone: string | null;
    }>;

    const operatorOptions = businessRows.map((biz) => ({
      id: biz.id,
      name: biz.business_name || biz.name || "Operator",
      logoUrl: biz.logo_url || "",
      timezone: biz.timezone || "UTC",
      subscriptionStatus: (biz as any).subscription_status || "ACTIVE",
      yocoTestMode: (biz as any).yoco_test_mode === true,
    }));

    const activeOperator = operatorOptions.find((biz) => biz.id === targetBusinessId) || operatorOptions[0] || null;

    // Canonical-host redirect: wildcard DNS serves every *.admin subdomain,
    // and tenant resolution comes from the profile — so a typo'd subdomain
    // still logs into the caller's own business. Bounce to the real one so
    // the URL matches the tenant. Supers roam across operators, so skip them.
    const canonicalSub = (businessRows.find((biz) => biz.id === (activeOperator?.id || defaultBusinessId)) as any)?.subdomain || "";
    const hostMatch = window.location.hostname.match(/^([^.]+)\.admin\.bookingtours\.co\.za$/);
    if (!isMultiOperator && canonicalSub && hostMatch && hostMatch[1] !== canonicalSub) {
      window.location.replace("https://" + canonicalSub + ".admin.bookingtours.co.za" + window.location.pathname + window.location.search);
    }

    return {
      businessId: activeOperator?.id || defaultBusinessId,
      businessName: activeOperator?.name || "",
      logoUrl: activeOperator?.logoUrl || "",
      timezone: activeOperator?.timezone || "UTC",
      operators: operatorOptions,
      subscriptionStatus: activeOperator?.subscriptionStatus || "ACTIVE",
      yocoTestMode: activeOperator?.yocoTestMode || false,
    };
  }

  async function validateSession() {
    const savedEmail = localStorage.getItem("ck_admin_email");
    const savedTime = localStorage.getItem("ck_admin_time");

    if (!savedEmail || !savedTime || Date.now() - Number(savedTime) > SESSION_TIMEOUT) {
      await clearSession();
      setChecking(false);
      return;
    }

    // Confirm we still have a Supabase Auth session (set during login or auto-restored from storage).
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) {
      await clearSession();
      setChecking(false);
      return;
    }

    const { data } = await supabase
      .from("admin_users")
      .select("role, business_id, name, settings_permissions")
      .eq("email", savedEmail)
      .maybeSingle();

    if (data && data.business_id) {
      const context = await loadBusinessContext(data.role, data.business_id);
      setRole(data.role);
      setBusinessId(context.businessId);
      setBusinessName(context.businessName);
      setLogoUrl(context.logoUrl);
      setTimezone(context.timezone);
      setOperators(context.operators);
      setSubscriptionStatus(context.subscriptionStatus);
      setYocoTestMode(context.yocoTestMode || false);
      localStorage.setItem("ck_admin_role", data.role);
      localStorage.setItem("ck_admin_business_id", context.businessId);
      localStorage.setItem("ck_admin_timezone", context.timezone);
      localStorage.setItem("ck_admin_name", data.name || "");
      localStorage.setItem("ck_admin_settings_perms", JSON.stringify(data.settings_permissions || {}));
      setAuthed(true);
      document.cookie = "ck_session_hint=1;path=/;max-age=86400;SameSite=Lax";
      document.cookie = "ck_admin_role=" + encodeURIComponent(data.role) + ";path=/;max-age=43200;SameSite=Lax";
    } else if (data) {
      // Admin exists but no business_id — legacy admin, still allow access
      setRole(data.role);
      setTimezone("UTC");
      setOperators([]);
      localStorage.setItem("ck_admin_role", data.role);
      localStorage.setItem("ck_admin_name", data.name || "");
      localStorage.setItem("ck_admin_settings_perms", JSON.stringify(data.settings_permissions || {}));
      setAuthed(true);
      document.cookie = "ck_session_hint=1;path=/;max-age=86400;SameSite=Lax";
      document.cookie = "ck_admin_role=" + encodeURIComponent(data.role) + ";path=/;max-age=43200;SameSite=Lax";
    } else {
      await clearSession();
    }
    setChecking(false);
  }

  async function clearSession() {
    try { await supabase.auth.signOut(); } catch { /* swallow — local cleanup must always run */ }
    localStorage.removeItem("ck_admin_auth");
    localStorage.removeItem("ck_admin_role");
    localStorage.removeItem("ck_admin_email");
    localStorage.removeItem("ck_admin_time");
    localStorage.removeItem("ck_admin_business_id");
    localStorage.removeItem("ck_admin_timezone");
    localStorage.removeItem("ck_operator_override_business_id");
    localStorage.removeItem("ck_admin_name");
    localStorage.removeItem("ck_admin_settings_perms");
    document.cookie = "ck_session_hint=;path=/;max-age=0";
    document.cookie = "ck_admin_role=;path=/;max-age=0";
    setAuthed(false);
    setBusinessId("");
    setBusinessName("");
    setLogoUrl("");
    setTimezone("UTC");
    setRole("");
    setOperators([]);
    setSubscriptionStatus("ACTIVE");
    setYocoTestMode(false);
  }

  async function login() {
    const lockUntil = Number(localStorage.getItem("ck_lock_until") || "0");
    if (lockUntil > Date.now()) {
      setLocked(true);
      setError("");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, password: pass }),
      });
      const data: any = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Special: account exists but needs password setup
        if (data?.code === "MUST_SET_PASSWORD" && data?.admin_id) {
          try {
            await sendAdminSetupLink(
              { id: data.admin_id, email: normalizedEmail, name: data.name },
              "FIRST_LOGIN",
              data.business_id || "",
            );
            setNotice("This admin account still needs a password. A secure setup link has been emailed.");
          } catch (setupError) {
            console.error("Failed to send admin setup link:", setupError);
            setError("This account still needs a password, but the setup email could not be sent.");
          }
          setLoading(false);
          return;
        }

        // Failed credentials — increment counter
        const failCount = Number(localStorage.getItem("ck_fail_count") || "0") + 1;
        localStorage.setItem("ck_fail_count", String(failCount));

        if (failCount >= MAX_ATTEMPTS) {
          localStorage.setItem("ck_lock_until", String(Date.now() + LOCKOUT_DURATION));
          setLocked(true);
          sendResetEmail(normalizedEmail);
        } else {
          setError(data?.error || "Incorrect email or password. " + (MAX_ATTEMPTS - failCount) + " attempt(s) remaining.");
        }
        setLoading(false);
        return;
      }

      const session = data?.session;
      const adminInfo = data?.admin;
      if (!session?.access_token || !adminInfo) {
        setError("Login response was malformed");
        setLoading(false);
        return;
      }

      // Set Supabase Auth session — every subsequent supabase-js call now goes as the authenticated user.
      const setRes = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (setRes.error) {
        setError("Failed to start session: " + setRes.error.message);
        setLoading(false);
        return;
      }

      localStorage.removeItem("ck_fail_count");
      localStorage.removeItem("ck_lock_until");
      localStorage.setItem("ck_admin_auth", "true");
      localStorage.setItem("ck_admin_role", adminInfo.role);
      localStorage.setItem("ck_admin_email", adminInfo.email);
      localStorage.setItem("ck_admin_time", String(Date.now()));
      localStorage.setItem("ck_admin_name", adminInfo.name || "");
      localStorage.setItem("ck_admin_settings_perms", JSON.stringify(adminInfo.settings_permissions || {}));

      setRole(adminInfo.role);
      // Set ck_admin_role cookie immediately so proxy.ts page-gating works on the
      // very next navigation (without waiting for validateSession to run on next mount).
      document.cookie = "ck_admin_role=" + encodeURIComponent(adminInfo.role) + ";path=/;max-age=43200;SameSite=Lax";

      if (adminInfo.business_id) {
        const context = await loadBusinessContext(adminInfo.role, adminInfo.business_id);
        localStorage.setItem("ck_admin_business_id", context.businessId);
        localStorage.setItem("ck_admin_timezone", context.timezone);
        setBusinessId(context.businessId);
        setBusinessName(context.businessName);
        setLogoUrl(context.logoUrl);
        setTimezone(context.timezone);
        setOperators(context.operators);
        setSubscriptionStatus(context.subscriptionStatus);
        setYocoTestMode(context.yocoTestMode || false);
      }

      setAuthed(true);
    } catch (err: any) {
      console.error("LOGIN_ERR", err);
      setError(err?.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function sendResetEmail(targetEmail: string) {
    const { data: admin } = await supabase
      .from("admin_users")
      .select("id, email, name")
      .eq("email", targetEmail)
      .maybeSingle();

    if (!admin) return;

    try {
      await sendAdminSetupLink(admin, "RESET", "");
    } catch { }

    setResetSent(true);
  }

  function switchOperator(nextBusinessId: string) {
    if (!nextBusinessId || nextBusinessId === businessId) return;
    localStorage.setItem("ck_operator_override_business_id", nextBusinessId);
    localStorage.setItem("ck_admin_business_id", nextBusinessId);
    const nextOperator = operators.find((operator) => operator.id === nextBusinessId);
    if (!nextOperator) return;
    setBusinessId(nextOperator.id);
    setBusinessName(nextOperator.name);
    setLogoUrl(nextOperator.logoUrl || "");
    setTimezone(nextOperator.timezone || "UTC");
    setSubscriptionStatus(nextOperator.subscriptionStatus || "ACTIVE");
    setYocoTestMode(nextOperator.yocoTestMode || false);
    localStorage.setItem("ck_admin_timezone", nextOperator.timezone || "UTC");
  }

  if (PUBLIC_PATHS.includes(pathname)) {
    return <BusinessProvider value={{ businessId: "", businessName: "", role: "", logoUrl: "", timezone: "UTC", operators: [] }}>{children}</BusinessProvider>;
  }

  if (checking) {
    const hasHint = typeof document !== "undefined" && document.cookie.includes("ck_session_hint=1");
    if (hasHint) {
      // Skeleton of the real shell: pine rail + paper content
      return (
        <div className="flex min-h-screen">
          <div
            className="hidden md:block w-64 shrink-0 border-r"
            style={{
              background: "linear-gradient(180deg, var(--ck-sidebar-grad-top) 0%, var(--ck-sidebar-grad-bottom) 100%)",
              borderColor: "var(--ck-sidebar-border)",
            }}
          >
            <div className="p-5 space-y-3">
              <div className="h-8 w-3/4 rounded-lg animate-pulse" style={{ background: "rgba(244, 241, 232, 0.08)" }} />
              <div className="pt-4 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-8 rounded-lg animate-pulse" style={{ background: "rgba(244, 241, 232, 0.05)" }} />
                ))}
              </div>
            </div>
          </div>
          <div className="flex-1 p-8">
            <div className="ui-skeleton h-8 w-48 mb-8" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="ui-skeleton h-[130px] !rounded-2xl" />
              ))}
            </div>
            <div className="ui-skeleton h-[280px] !rounded-2xl" />
          </div>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="ui-card w-full max-w-sm p-8 text-center">
          <BrandMark size={40} className="mx-auto mb-4 animate-pulse" />
          <p className="text-sm ui-text-muted">Checking admin session...</p>
        </div>
      </div>
    );
  }

  if (!authed && MARKETING_OPTIONAL_AUTH_PATHS.includes(pathname)) {
    return <BusinessProvider value={{ businessId: "", businessName: "", role: "", logoUrl: "", timezone: "UTC", operators: [] }}>{children}</BusinessProvider>;
  }

  if (!authed) return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="anim-fade-up w-full max-w-sm">
        <div className="ui-card relative overflow-hidden p-8 text-center" style={{ boxShadow: "var(--ck-shadow-lg)" }}>
          {/* Pine crown with the brand trail — the card wears the badge */}
          <div className="absolute inset-x-0 top-0 h-1.5 bg-bt-gradient" aria-hidden="true" />
          <div className="mb-6 mt-1 flex flex-col items-center">
            <BrandMark size={46} className="mb-4" />
            <h1 className="font-display text-[26px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>
              <BrandWordmark />
            </h1>
            <p className="mt-1.5 text-sm ui-text-muted">Sign in to your operator dashboard</p>
          </div>

          {locked ? (
            <div className="text-center">
              <div className="rounded-xl border p-5 mb-4" style={{ background: "var(--ck-danger-soft)", borderColor: "color-mix(in srgb, var(--ck-danger) 25%, transparent)" }}>
                <p className="text-sm font-semibold mb-2" style={{ color: "var(--ck-danger)" }}>Account Locked</p>
                <p className="text-xs leading-relaxed" style={{ color: "var(--ck-danger)" }}>
                  Too many failed attempts. Your account has been locked for 30 minutes.
                  {resetSent
                    ? " A password setup email has been sent."
                    : " If this is your account, a password setup email will be sent."}
                </p>
              </div>
              <a href="/change-password" className="text-xs text-[var(--ck-text-muted)] hover:underline">
                Set up or reset password
              </a>
            </div>
          ) : (
            <>
              <input type="email" value={email}
                onChange={e => { setEmail(e.target.value); setError(""); setNotice(""); }}
                onKeyDown={e => { if (e.key === "Enter") login(); }}
                placeholder="Email address"
                autoComplete="email"
                className="ui-control mb-3 w-full px-4 py-3 text-sm outline-none" />

              <input type="password" value={pass}
                onChange={e => { setPass(e.target.value); setError(""); setNotice(""); }}
                onKeyDown={e => { if (e.key === "Enter") login(); }}
                placeholder="Password"
                autoComplete="current-password"
                className={"ui-control mb-3 w-full px-4 py-3 text-sm outline-none " + (error ? "border-[var(--ck-danger)] bg-[var(--ck-danger-soft)]" : "")} />

              {error && <p className="mb-3 text-xs" style={{ color: "var(--ck-danger)" }}>{error}</p>}
              {notice && <p className="mb-3 text-xs" style={{ color: "var(--ck-success)" }}>{notice}</p>}

              <button onClick={login} disabled={loading} className="ui-btn ui-btn-primary w-full !h-11 !rounded-xl text-sm font-semibold disabled:opacity-50">
                {loading ? "Signing in..." : "Sign In"}
              </button>

              <p className="mt-4 text-xs text-[var(--ck-text-muted)]">
                <a href="/change-password" className="hover:underline">Set up or reset password</a>
              </p>
            </>
          )}
        </div>
        <p className="ui-mono-label mt-5 text-center !text-[9.5px]">Built for adventure operators</p>
      </div>
    </div>
  );

  const allowedWhileSuspended = pathname === "/billing" && role === "MAIN_ADMIN";
  if ((subscriptionStatus === "SUSPENDED" || subscriptionStatus === "PAUSED") && role !== "SUPER_ADMIN" && !allowedWhileSuspended) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="ui-card anim-fade-up w-full max-w-md p-8 text-center space-y-4">
          <div className="ui-icon-chip mx-auto !h-12 !w-12 !rounded-full" style={{ background: "var(--ck-warning-soft)", color: "var(--ck-warning)" }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true"><path d="M216,48V208a16,16,0,0,1-16,16H164a16,16,0,0,1-16-16V48a16,16,0,0,1,16-16h36A16,16,0,0,1,216,48ZM92,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H92a16,16,0,0,0,16-16V48A16,16,0,0,0,92,32Z"></path></svg>
          </div>
          <h1 className="font-display text-[22px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>
            {subscriptionStatus === "PAUSED" ? "Your account is paused" : "Your account has been suspended"}
          </h1>
          <p className="text-sm text-[var(--ck-text-muted)]">
            {subscriptionStatus === "PAUSED"
              ? "Your subscription is paused for the off-season. When you're ready to get back to it, reactivate below."
              : "Your subscription has been suspended. Please contact support or reactivate your subscription to continue."}
          </p>
          {role === "MAIN_ADMIN" && (
            <a href="/billing" className="ui-btn ui-btn-primary mt-4 !h-11 !rounded-xl !px-6 text-sm font-semibold inline-flex">
              Go to Billing
            </a>
          )}
          <button onClick={clearSession} className="block mx-auto mt-3 text-xs text-[var(--ck-text-muted)] hover:underline">
            Sign out
          </button>
        </div>
      </div>
    );
  }

  async function refreshBusiness() {
    // Z1: settings save updates businesses.business_name / logo_url, but the
    // sidebar reads from this provider's state and won't pick the change up
    // until a hard reload. Re-running loadBusinessContext (without any role
    // change) reseeds the active operator and the sidebar updates in place.
    if (!businessId) return;
    try {
      const context = await loadBusinessContext(role, businessId);
      setBusinessId(context.businessId);
      setBusinessName(context.businessName);
      setLogoUrl(context.logoUrl);
      setTimezone(context.timezone);
      setOperators(context.operators);
      setSubscriptionStatus(context.subscriptionStatus);
      setYocoTestMode(context.yocoTestMode || false);
    } catch (e) {
      console.warn("refreshBusiness failed:", e);
    }
  }

  return (
    <BusinessProvider value={{ businessId, businessName, role, logoUrl, timezone, subscriptionStatus, yocoTestMode, operators, switchOperator, refreshBusiness }}>
      {children}
    </BusinessProvider>
  );
}
