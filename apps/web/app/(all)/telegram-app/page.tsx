/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useState } from "react";
import { LoaderCircle, LockKeyhole, RotateCw } from "lucide-react";
import { API_BASE_URL } from "@plane/constants";
import gtsSphereLogo from "@/app/assets/logos/gts-sphere.svg?url";
// oxlint-disable-next-line import/no-unassigned-import -- route-scoped Mini App theme
import "./telegram-mini-app.css";

type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  disableVerticalSwipes?: () => void;
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const copy = {
  ru: {
    title: "GTS Tasks",
    loading: "Проверяем безопасный вход через Telegram…",
    errorTitle: "Не удалось открыть задачи",
    outsideTelegram: "Откройте бота GTS Tasks в Telegram и нажмите кнопку «Задачи».",
    retry: "Повторить",
  },
  en: {
    title: "GTS Tasks",
    loading: "Verifying secure Telegram sign-in…",
    errorTitle: "Tasks could not be opened",
    outsideTelegram: "Open the GTS Tasks bot in Telegram and tap the Tasks button.",
    retry: "Try again",
  },
  uz: {
    title: "GTS Tasks",
    loading: "Telegram orqali xavfsiz kirish tekshirilmoqda…",
    errorTitle: "Vazifalarni ochib bo‘lmadi",
    outsideTelegram: "Telegram ichida GTS Tasks botini oching va «Vazifalar» tugmasini bosing.",
    retry: "Qayta urinish",
  },
};

function currentCopy() {
  const language = (typeof navigator === "undefined" ? "en" : navigator.language)
    .toLowerCase()
    .split("-", 1)[0] as keyof typeof copy;
  return copy[language] ?? copy.en;
}

function loadTelegramBridge(): Promise<TelegramWebApp | undefined> {
  if (window.Telegram?.WebApp) return Promise.resolve(window.Telegram.WebApp);
  return new Promise((resolve) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-gts-telegram-web-app="true"]');
    const script = existingScript ?? document.createElement("script");
    const finish = () => resolve(window.Telegram?.WebApp);
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => resolve(undefined), { once: true });
    if (!existingScript) {
      script.src = "https://telegram.org/js/telegram-web-app.js?59";
      script.async = true;
      script.dataset.gtsTelegramWebApp = "true";
      document.head.appendChild(script);
    }
    window.setTimeout(finish, 4000);
  });
}

export default function TelegramMiniAppBootstrapPage() {
  const labels = currentCopy();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const authenticate = async () => {
      setError(null);
      const webApp = await loadTelegramBridge();
      if (!active) return;
      if (!webApp?.initData) {
        setError(labels.outsideTelegram);
        return;
      }
      webApp.ready();
      webApp.expand();
      webApp.disableVerticalSwipes?.();
      try {
        const response = await fetch(`${API_BASE_URL}/api/telegram/mini-app/session/`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ init_data: webApp.initData }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.workspace_slug) throw new Error(payload.error || labels.errorTitle);
        window.location.replace(`/telegram-app/${encodeURIComponent(payload.workspace_slug)}`);
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : labels.errorTitle);
      }
    };
    authenticate();
    return () => {
      active = false;
    };
  }, [attempt, labels.errorTitle, labels.outsideTelegram]);

  return (
    <main className="tg-mini-app tg-mini-app--centered">
      <section className="tg-bootstrap-card" aria-live="polite">
        <div className="tg-brand-mark">
          <img src={gtsSphereLogo} alt="" />
        </div>
        <div>
          <p className="tg-eyebrow">GTS Tasks System</p>
          <h1>{error ? labels.errorTitle : labels.title}</h1>
        </div>
        {error ? (
          <>
            <div className="tg-bootstrap-error">
              <LockKeyhole aria-hidden="true" size={18} />
              <p>{error}</p>
            </div>
            <button className="tg-primary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>
              <RotateCw aria-hidden="true" size={17} />
              {labels.retry}
            </button>
          </>
        ) : (
          <div className="tg-bootstrap-loading">
            <LoaderCircle className="tg-spin" aria-hidden="true" size={22} />
            <p>{labels.loading}</p>
          </div>
        )}
      </section>
    </main>
  );
}
