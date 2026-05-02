"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabase";

function CallbackHandler() {
  var searchParams = useSearchParams();
  var [status, setStatus] = useState("Connecting Google Drive...");

  useEffect(() => {
    async function exchange() {
      var code = searchParams.get("code");
      var stateRaw = searchParams.get("state");
      var error = searchParams.get("error");

      if (error) {
        setStatus("Google authorization was denied.");
        setTimeout(() => (window.location.href = "/settings"), 2000);
        return;
      }

      if (!code || !stateRaw) {
        setStatus("Missing authorization data.");
        setTimeout(() => (window.location.href = "/settings"), 2000);
        return;
      }

      try {
        var stateData = JSON.parse(atob(stateRaw));
        var businessId = stateData.business_id;
        var returnTo = stateData.return_to || "/settings";
        var redirectUri = "https://caepweb-admin.vercel.app/google-callback";

        var { data, error: fnErr } = await supabase.functions.invoke("google-drive", {
          body: { action: "exchange", business_id: businessId, code, redirect_uri: redirectUri },
        });

        if (fnErr || data?.error) {
          setStatus("Connection failed: " + (data?.error || fnErr?.message));
          setTimeout(() => (window.location.href = returnTo), 3000);
          return;
        }

        setStatus("Google Drive connected as " + (data.email || "unknown") + "!");
        setTimeout(() => (window.location.href = returnTo), 1500);
      } catch (e: any) {
        setStatus("Connection failed: " + (e.message || "unknown error"));
        setTimeout(() => (window.location.href = "/photos"), 2500);
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
