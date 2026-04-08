"use client";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "../app/lib/supabase";
import { sendAdminSetupLink, sha256 } from "../app/lib/admin-auth";
import { BusinessProvider } from "./BusinessContext";

var PUBLIC_PATHS = ["/change-password", "/case-study/cape-kayak", "/compare/manual-vs-disconnected-tools"];
var MARKETING_OPTIONAL_AUTH_PATHS = ["/operators"];
var SESSION_TIMEOUT = 12 * 60 * 60 * 1000;
var MAX_ATTEMPTS = 5;
var LOCKOUT_DURATION = 30 * 60 * 1000;

interface OperatorOption {
  id: string;
  name: string;
  logoUrl: string;
  timezone: string;
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  var pathname = usePathname();
  var [authed, setAuthed] = useState(false);
  var [email, setEmail] = useState("");
  var [pass, setPass] = useState("");
  var [error, setError] = useState("");
  var [loading, setLoading] = useState(false);
  var [checking, setChecking] = useState(true);
  var [locked, setLocked] = useState(false);
  var [resetSent, setResetSent] = useState(false);

  // Business context from login/session
  var [businessId, setBusinessId] = useState("");
  var [businessName, setBusinessName] = useState("");
  var [logoUrl, setLogoUrl] = useState("");
  var [timezone, setTimezone] = useState("UTC");
  var [role, setRole] = useState("");
  var [operators, setOperators] = useState<OperatorOption[]>([]);
  var [subscriptionStatus, setSubscriptionStatus] = useState("ACTIVE");
  var [notice, setNotice] = useState("");

  useEffect(() => {
    validateSession();
    checkLockout();
  }, []);

  function checkLockout() {
    var lockUntil = Number(localStorage.getItem("ck_lock_until") || "0");
    if (lockUntil > Date.now()) {
      setLocked(true);
    } else if (lockUntil > 0) {
      localStorage.removeItem("ck_lock_until");
      localStorage.removeItem("ck_fail_count");
    }
  }

  async function loadBusinessContext(adminRole: string, defaultBusinessId: string) {
    var isMultiOperator = /super/i.test(adminRole);
    var overrideBusinessId = localStorage.getItem("ck_operator_override_business_id") || "";
    var targetBusinessId = isMultiOperator && overrideBusinessId ? overrideBusinessId : defaultBusinessId;

    var baseQuery = supabase
      .from("businesses")
      .select("id, name, business_name, logo_url, timezone, subscription_status")
      .order("business_name", { ascending: true });

    var businessesRes = isMultiOperator
      ? await baseQuery
      : await baseQuery.eq("id", defaultBusinessId);

    var businessRows = (businessesRes.data || []) as Array<{
      id: string;
      name: string | null;
      business_name: string | null;
      logo_url: string | null;
      timezone: string | null;
    }>;

    var operatorOptions = businessRows.map((biz) => ({
      id: biz.id,
      name: biz.business_name || biz.name || "Operator",
      logoUrl: biz.logo_url || "",
      timezone: biz.timezone || "UTC",
      subscriptionStatus: (biz as any).subscription_status || "ACTIVE",
    }));

    var activeOperator = operatorOptions.find((biz) => biz.id === targetBusinessId) || operatorOptions[0] || null;

    return {
      businessId: activeOperator?.id || defaultBusinessId,
      businessName: activeOperator?.name || "",
      logoUrl: activeOperator?.logoUrl || "",
      timezone: activeOperator?.timezone || "UTC",
      operators: operatorOptions,
      subscriptionStatus: activeOperator?.subscriptionStatus || "ACTIVE",
    };
  }

  async function validateSession() {
    var savedEmail = localStorage.getItem("ck_admin_email");
    var savedTime = localStorage.getItem("ck_admin_time");

    if (!savedEmail || !savedTime || Date.now() - Number(savedTime) > SESSION_TIMEOUT) {
      clearSession();
      setChecking(false);
      return;
    }

    var { data } = await supabase
      .from("admin_users")
      .select("role, business_id, name, settings_permissions")
      .eq("email", savedEmail)
      .maybeSingle();

    if (data && data.business_id) {
      var context = await loadBusinessContext(data.role, data.business_id);
      setRole(data.role);
      setBusinessId(context.businessId);
      setBusinessName(context.businessName);
      setLogoUrl(context.logoUrl);
      setTimezone(context.timezone);
      setOperators(context.operators);
      setSubscriptionStatus(context.subscriptionStatus);
      localStorage.setItem("ck_admin_role", data.role);
      localStorage.setItem("ck_admin_business_id", context.businessId);
      localStorage.setItem("ck_admin_timezone", context.timezone);
      localStorage.setItem("ck_admin_name", data.name || "");
      localStorage.setItem("ck_admin_settings_perms", JSON.stringify(data.settings_permissions || {}));
      setAuthed(true);
    } else if (data) {
      // Admin exists but no business_id — legacy admin, still allow access
      setRole(data.role);
      setTimezone("UTC");
      setOperators([]);
      localStorage.setItem("ck_admin_role", data.role);
      localStorage.setItem("ck_admin_name", data.name || "");
      localStorage.setItem("ck_admin_settings_perms", JSON.stringify(data.settings_permissions || {}));
      setAuthed(true);
    } else {
      clearSession();
    }
    setChecking(false);
  }

  function clearSession() {
    localStorage.removeItem("ck_admin_auth");
    localStorage.removeItem("ck_admin_role");
    localStorage.removeItem("ck_admin_email");
    localStorage.removeItem("ck_admin_time");
    localStorage.removeItem("ck_admin_business_id");
    localStorage.removeItem("ck_admin_timezone");
    localStorage.removeItem("ck_operator_override_business_id");
    localStorage.removeItem("ck_admin_name");
    localStorage.removeItem("ck_admin_settings_perms");
    setAuthed(false);
    setBusinessId("");
    setBusinessName("");
    setLogoUrl("");
    setTimezone("UTC");
    setRole("");
    setOperators([]);
    setSubscriptionStatus("ACTIVE");
  }

  async function login() {
    var lockUntil = Number(localStorage.getItem("ck_lock_until") || "0");
    if (lockUntil > Date.now()) {
      setLocked(true);
      setError("");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");
    var { data: user } = await supabase
      .from("admin_users")
      .select("id, role, email, business_id, name, password_hash, must_set_password, settings_permissions")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();

    if (user && (user.must_set_password || !user.password_hash)) {
      try {
        await sendAdminSetupLink({ id: user.id, email: user.email, name: user.name }, "FIRST_LOGIN", user.business_id || "");
        setNotice("This admin account still needs a password. A secure setup link has been emailed.");
      } catch (setupError) {
        console.error("Failed to send admin setup link:", setupError);
        setError("This account still needs a password, but the setup email could not be sent.");
      }
      setLoading(false);
      return;
    }

    var hash = await sha256(pass);

    setLoading(false);

    if (user && user.password_hash === hash) {
      localStorage.removeItem("ck_fail_count");
      localStorage.removeItem("ck_lock_until");
      localStorage.setItem("ck_admin_auth", "true");
      localStorage.setItem("ck_admin_role", user.role);
      localStorage.setItem("ck_admin_email", email.trim().toLowerCase());
      localStorage.setItem("ck_admin_time", String(Date.now()));
      localStorage.setItem("ck_admin_name", user.name || "");
      localStorage.setItem("ck_admin_settings_perms", JSON.stringify(user.settings_permissions || {}));

      setRole(user.role);
      setNotice("");

      if (user.business_id) {
        var context = await loadBusinessContext(user.role, user.business_id);
        localStorage.setItem("ck_admin_business_id", context.businessId);
        localStorage.setItem("ck_admin_timezone", context.timezone);
        setBusinessId(context.businessId);
        setBusinessName(context.businessName);
        setLogoUrl(context.logoUrl);
        setTimezone(context.timezone);
        setOperators(context.operators);
        setSubscriptionStatus(context.subscriptionStatus);
      }

      setAuthed(true);
    } else {
      var failCount = Number(localStorage.getItem("ck_fail_count") || "0") + 1;
      localStorage.setItem("ck_fail_count", String(failCount));

      if (failCount >= MAX_ATTEMPTS) {
        localStorage.setItem("ck_lock_until", String(Date.now() + LOCKOUT_DURATION));
        setLocked(true);
        sendResetEmail(email.trim().toLowerCase());
      } else {
        setError("Incorrect email or password. " + (MAX_ATTEMPTS - failCount) + " attempt(s) remaining.");
      }
    }
  }

  async function sendResetEmail(targetEmail: string) {
    var { data: admin } = await supabase
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
    var nextOperator = operators.find((operator) => operator.id === nextBusinessId);
    if (!nextOperator) return;
    setBusinessId(nextOperator.id);
    setBusinessName(nextOperator.name);
    setLogoUrl(nextOperator.logoUrl || "");
    setTimezone(nextOperator.timezone || "UTC");
    localStorage.setItem("ck_admin_timezone", nextOperator.timezone || "UTC");
  }

  if (PUBLIC_PATHS.includes(pathname)) {
    return <BusinessProvider value={{ businessId: "", businessName: "", role: "", logoUrl: "", timezone: "UTC", operators: [] }}>{children}</BusinessProvider>;
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--ck-bg)] px-4">
        <div className="ui-surface-elevated w-full max-w-sm p-8 text-center">
          <div className="mx-auto h-10 w-10 animate-pulse rounded-full bg-[var(--ck-border-subtle)]" />
          <p className="mt-4 text-sm ui-text-muted">Checking admin session...</p>
        </div>
      </div>
    );
  }

  if (!authed && MARKETING_OPTIONAL_AUTH_PATHS.includes(pathname)) {
    return <BusinessProvider value={{ businessId: "", businessName: "", role: "", logoUrl: "", timezone: "UTC", operators: [] }}>{children}</BusinessProvider>;
  }

  if (!authed) return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--ck-bg)] px-4">
      <div className="ui-surface-elevated w-full max-w-sm p-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--ck-text-strong)] mb-1">Admin Dashboard</h1>
        <p className="mb-6 text-sm ui-text-muted">Enter your email and password</p>

        {locked ? (
          <div className="text-center">
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-4">
              <p className="text-sm font-semibold text-red-700 mb-2">Account Locked</p>
              <p className="text-xs text-red-600 leading-relaxed">
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

            {error && <p className="mb-3 text-xs text-[var(--ck-danger)]">{error}</p>}
            {notice && <p className="mb-3 text-xs text-emerald-700">{notice}</p>}

            <button onClick={login} disabled={loading} className="w-full rounded-xl bg-[var(--ck-text-strong)] py-3 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 disabled:opacity-50">
              {loading ? "Signing in..." : "Sign In"}
            </button>

            <p className="mt-4 text-xs text-[var(--ck-text-muted)]">
              <a href="/change-password" className="hover:underline">Set up or reset password</a>
            </p>
          </>
        )}
      </div>
    </div>
  );

  return (
    <BusinessProvider value={{ businessId, businessName, role, logoUrl, timezone, subscriptionStatus, operators, switchOperator }}>
      {children}
    </BusinessProvider>
  );
}
