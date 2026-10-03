"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { arreterVoixLocale } from "@/services/alexa-local";
import { subscribeAlexaNavigation } from "@/services/alexa-navigation";

/** The microphone starts only on the doctor's click and closes with the app. */
export function BootVoix(): null {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => subscribeAlexaNavigation(path => router.push(path)), [router]);
  useEffect(() => { arreterVoixLocale(); }, [pathname]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) arreterVoixLocale(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", arreterVoixLocale);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", arreterVoixLocale);
      arreterVoixLocale();
    };
  }, []);
  return null;
}
