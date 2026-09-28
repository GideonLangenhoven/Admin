"use client";
import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabase";
import { driveCallbackUrl, isAllowedDriveReturnOrigin } from "../../supabase/functions/_shared/google-drive-oauth";

function CallbackHandler() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("Connecting Google Drive...");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const returnToSettings = (delay: number) => setTimeout(() => window.location.replace(new URL("/settings", window.location.origin).href), delay);
    async function exchange() {
      const code = searchParams.get("code");
      const stateRaw = searchParams.get("state");
      const error = searchParams.get("error");

      if (!stateRaw) {
        setStatus("Missing authorization data.");
        returnToSettings(2000);
        return;
      }

      try {
        const stateData = JSON.parse(atob(stateRaw));
        const returnOrigin = String(stateData.return_origin || "");
        if (!isAllowedDriveReturnOrigin(returnOrigin)) throw new Error("Invalid operator return address");

        // Google returns to one registered URL; continue on the operator's
        // subdomain so its existing admin session can finish the exchange.
        if (window.location.origin !== returnOrigin) {
          window.location.replace(driveCallbackUrl(returnOrigin, stateRaw, code, error));
          return;
        }

        if (!stateData.nonce || sessionStorage.getItem("google-drive-oauth-nonce") !== stateData.nonce) {
          throw new Error("Google connection was not started in this browser tab");
        }
        sessionStorage.removeItem("google-drive-oauth-nonce");
        window.history.replaceState(null, "", "/google-callback");
        if (error) {
          setStatus("Google authorization was denied.");
          returnToSettings(2000);
          return;
        }
        if (!code || !stateData.business_id) throw new Error("Missing authorization data");

        const { data, error: fnErr } = await supabase.functions.invoke("google-drive", {
          body: { action: "exchange", business_id: stateData.business_id, code },
        });

        if (fnErr || data?.error) {
          setStatus("Connection failed: " + (data?.error || fnErr?.message));
          returnToSettings(3000);
          return;
        }

        setStatus("Google Drive connected as " + (data.email || "unknown") + "!");
        returnToSettings(1500);
      } catch (e: any) {
        setStatus("Connection failed: " + (e.message || "unknown error"));
        returnToSettings(2500);
      }
    }

    exchange();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center bg-white rounded-2xl border border-gray-200 p-10 shadow-sm max-w-sm">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-blue-500 mx-auto mb-4" />
        <p className="text-sm text-gray-600">{status}</p>
      </div>
    </div>
  );
}

export default function GoogleCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-blue-500" />
      </div>
    }>
      <CallbackHandler />
    </Suspense>
  );
}
