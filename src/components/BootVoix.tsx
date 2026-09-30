"use client";

import { useEffect } from "react";
import { arreterLive } from "@/services/alexa-live";

/** The microphone starts only on the doctor's click and closes with the app. */
export function BootVoix(): null {
  useEffect(() => {
    const hidden = () => { if (document.hidden) arreterLive(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", arreterLive);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", arreterLive);
      arreterLive();
    };
  }, []);
  return null;
}
