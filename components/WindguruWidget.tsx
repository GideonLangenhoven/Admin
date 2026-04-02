"use client";
import { useEffect, useRef } from "react";

export default function WindguruWidget({ spotId, refreshKey }: { spotId: number; refreshKey: number }) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";

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
        container.appendChild(script);

        return () => {
            if (container) container.innerHTML = "";
        };
    }, [spotId, refreshKey]);

    return <div ref={containerRef} className="w-full min-h-[350px] overflow-x-auto" style={{ background: "var(--ck-surface-elevated)", color: "var(--ck-text-muted)" }}>Loading Windguru...</div>;
}
