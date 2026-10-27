"use client";
import { useEffect, useRef, useState } from "react";

export default function WindguruWidget({ spotId, refreshKey }: { spotId: number; refreshKey: number }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [failureKey, setFailureKey] = useState<string | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";
        let active = true;
        const fail = () => { if (active) setFailureKey(`${spotId}:${refreshKey}`); };

        const uid = `wg_fwdg_${spotId}_100`;
        const args = [
            `s=${spotId}`, `uid=${uid}`, `wj=knots`, `tj=c`,
            `p=WINDSPD,GUST,SMER,WAVES,WVPER,WVDIR,TMPE,CDC,APCP1s,RATING`, `b=1`, `hc=#333`,
            `dc=gray`, `tc=#333`, `stl=`, `lng=en`, `wl=3`,
        ];

        const target = document.createElement("div");
        target.id = uid;
        container.appendChild(target);

        const script = document.createElement("script");
        script.src = `https://www.windguru.cz/js/widget.php?${args.join("&")}`;
        script.async = true;
        script.onerror = fail;
        const timeout = setTimeout(fail, 20_000);
        script.onload = () => { clearTimeout(timeout); };
        container.appendChild(script);

        return () => {
            active = false;
            clearTimeout(timeout);
            if (container) container.innerHTML = "";
        };
    }, [spotId, refreshKey]);

    return <>
        {failureKey === `${spotId}:${refreshKey}` && <p role="alert" className="p-4 text-sm">Windguru did not load. Refresh or open the configured Windguru spot to check its forecast.</p>}
        <div ref={containerRef} className="w-full min-h-[350px] overflow-x-auto" style={{ background: "var(--ck-surface-elevated)", color: "var(--ck-text-muted)" }}>Loading Windguru...</div>
    </>;
}
