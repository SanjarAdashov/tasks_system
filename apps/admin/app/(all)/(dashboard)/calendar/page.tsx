/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import {
  CalendarSync,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CloudCog,
  Copy,
  ExternalLink,
  KeyRound,
  ShieldCheck,
  Video,
} from "lucide-react";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Input, Loader } from "@plane/ui";
import { InstanceService } from "@plane/services";
import { PageWrapper } from "@/components/common/page-wrapper";
import { useInstance } from "@/hooks/store";
import type { Route } from "./+types/page";

const keys = [
  "CALENDAR_GOOGLE_CLIENT_ID",
  "CALENDAR_GOOGLE_CLIENT_SECRET",
  "CALENDAR_MICROSOFT_CLIENT_ID",
  "CALENDAR_MICROSOFT_CLIENT_SECRET",
  "CALENDAR_MICROSOFT_TENANT",
  "CALENDAR_GOOGLE_MEET_REFRESH_TOKEN",
  "CALENDAR_GOOGLE_MEET_ACCOUNT",
] as const;

type Values = Record<(typeof keys)[number], string>;

const emptyValues: Values = {
  CALENDAR_GOOGLE_CLIENT_ID: "",
  CALENDAR_GOOGLE_CLIENT_SECRET: "",
  CALENDAR_MICROSOFT_CLIENT_ID: "",
  CALENDAR_MICROSOFT_CLIENT_SECRET: "",
  CALENDAR_MICROSOFT_TENANT: "common",
  CALENDAR_GOOGLE_MEET_REFRESH_TOKEN: "",
  CALENDAR_GOOGLE_MEET_ACCOUNT: "",
};

type SetupStepProps = {
  number: number;
  icon: ReactNode;
  title: string;
  children: ReactNode;
};

function SetupStep({ number, icon, title, children }: SetupStepProps) {
  return (
    <div className="relative grid grid-cols-[36px_1fr] gap-3 pb-5 last:pb-0">
      {number < 4 && <div className="bg-subtle absolute top-9 bottom-0 left-[17px] w-px" />}
      <div className="border-accent-primary/30 relative z-[1] grid size-9 place-items-center rounded-full border bg-accent-subtle text-accent-primary">
        {icon}
      </div>
      <div className="pt-1">
        <div className="flex items-baseline gap-2">
          <span className="text-9 font-semibold tracking-[0.12em] text-accent-primary uppercase">Шаг {number}</span>
          <h3 className="text-12 font-semibold text-primary">{title}</h3>
        </div>
        <div className="mt-1.5 space-y-2 text-11 leading-5 text-secondary">{children}</div>
      </div>
    </div>
  );
}

const InstanceCalendarPage = observer(function InstanceCalendarPage(_props: Route.ComponentProps) {
  const { fetchInstanceConfigurations, formattedConfig, updateInstanceConfigurations } = useInstance();
  const service = useMemo(() => new InstanceService(), []);
  const [values, setValues] = useState<Values>(emptyValues);
  const [isSaving, setIsSaving] = useState(false);
  const [isConnectingMeet, setIsConnectingMeet] = useState(false);
  const [isCallbackCopied, setIsCallbackCopied] = useState(false);
  const hasHydratedValues = useRef(false);
  useSWR("INSTANCE_CONFIGURATIONS", () => fetchInstanceConfigurations());

  useEffect(() => {
    if (!formattedConfig || hasHydratedValues.current) return;
    setValues(Object.fromEntries(keys.map((key) => [key, formattedConfig[key] || emptyValues[key]])) as Values);
    hasHydratedValues.current = true;
  }, [formattedConfig]);

  const update = (key: keyof Values, value: string) => setValues((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setIsSaving(true);
    try {
      await updateInstanceConfigurations(values);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Calendar integrations saved",
        message: "New OAuth connections and Google Meet creation will use these credentials.",
      });
    } catch (error: any) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Could not save calendar integrations",
        message: error?.error || "Check the credentials and try again.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const connectMeet = async () => {
    setIsConnectingMeet(true);
    try {
      const response = await service.calendarOAuthAuthorizationUrl(window.location.href, "system_meet");
      window.location.assign(response.authorization_url);
    } catch (error: any) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Could not connect Google Meet",
        message: error?.error || "Save the Google OAuth client first.",
      });
      setIsConnectingMeet(false);
    }
  };

  const origin = typeof window === "undefined" ? "" : window.location.origin.replace(/\/god-mode\/?$/, "");
  const callbackUrl = `${origin}/api/users/me/calendar/connections/oauth/callback/`;
  const isGoogleOAuthConfigured = Boolean(
    formattedConfig?.CALENDAR_GOOGLE_CLIENT_ID?.trim() && formattedConfig?.CALENDAR_GOOGLE_CLIENT_SECRET?.trim()
  );
  const isSystemMeetConnected = Boolean(
    formattedConfig?.CALENDAR_GOOGLE_MEET_ACCOUNT?.trim() && formattedConfig?.CALENDAR_GOOGLE_MEET_REFRESH_TOKEN?.trim()
  );

  const copyCallbackUrl = async () => {
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setIsCallbackCopied(true);
      window.setTimeout(() => setIsCallbackCopied(false), 1800);
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось скопировать адрес",
        message: "Выделите адрес перенаправления и скопируйте его вручную.",
      });
    }
  };

  return (
    <PageWrapper
      size="lg"
      header={{
        title: "Calendar and meetings",
        description: "Configure OAuth for personal calendar connections and the system Google Meet account.",
      }}
    >
      {!formattedConfig ? (
        <Loader className="space-y-4">
          <Loader.Item height="220px" width="100%" />
          <Loader.Item height="220px" width="100%" />
        </Loader>
      ) : (
        <div className="space-y-6">
          <details open className="group border-accent-primary/25 overflow-hidden rounded-xl border bg-layer-1">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 marker:content-none">
              <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-subtle text-accent-primary">
                <CloudCog className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-14 font-semibold text-primary">Как настроить Google Calendar и Google Meet</h2>
                <p className="mt-0.5 text-11 text-secondary">
                  Выполните эти действия один раз. После этого пользователи смогут подключать личные календари, а GTS —
                  автоматически создавать ссылки Meet.
                </p>
              </div>
              <div className="hidden items-center gap-2 sm:flex">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-subtle bg-layer-2 px-2.5 py-1 text-10 text-secondary">
                  {isGoogleOAuthConfigured ? (
                    <CheckCircle2 className="size-3.5 text-success-primary" />
                  ) : (
                    <Circle className="size-3.5 text-tertiary" />
                  )}
                  OAuth
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-subtle bg-layer-2 px-2.5 py-1 text-10 text-secondary">
                  {isSystemMeetConnected ? (
                    <CheckCircle2 className="size-3.5 text-success-primary" />
                  ) : (
                    <Circle className="size-3.5 text-tertiary" />
                  )}
                  Meet
                </span>
              </div>
              <ChevronDown className="size-4 shrink-0 text-tertiary transition-transform group-open:rotate-180" />
            </summary>

            <div className="grid border-t border-subtle lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="p-5 lg:border-r lg:border-subtle">
                <SetupStep number={1} icon={<CloudCog className="size-4" />} title="Создайте проект Google Cloud">
                  <p>
                    Откройте Google Cloud Console и включите в проекте <strong>Google Calendar API</strong> и
                    <strong> Google Meet REST API</strong>.
                  </p>
                  <a
                    href="https://console.cloud.google.com/apis/library"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-accent-primary hover:underline"
                  >
                    Открыть библиотеку API <ExternalLink className="size-3" />
                  </a>
                </SetupStep>

                <SetupStep number={2} icon={<ShieldCheck className="size-4" />} title="Настройте экран согласия OAuth">
                  <p>
                    В Google Auth Platform заполните Branding и Audience. Выберите <strong>Internal</strong> только для
                    одной Google Workspace-организации; для разных Google-аккаунтов используйте
                    <strong> External</strong> и режим Production.
                  </p>
                  <div className="rounded-lg border border-subtle bg-layer-2 p-3">
                    <div className="mb-1.5 text-10 font-semibold text-primary">Разрешения приложения</div>
                    <code className="block text-10 leading-5 break-all text-secondary">
                      openid · email · profile
                      <br />
                      https://www.googleapis.com/auth/calendar
                      <br />
                      https://www.googleapis.com/auth/meetings.space.created
                    </code>
                  </div>
                </SetupStep>

                <SetupStep number={3} icon={<KeyRound className="size-4" />} title="Создайте OAuth Client">
                  <p>
                    Создайте клиент типа <strong>Web application</strong>. Добавьте указанный ниже адрес в Authorized
                    redirect URIs, затем перенесите Client ID и Client secret в блок Google Calendar OAuth.
                  </p>
                  <div className="flex flex-col gap-2 rounded-lg border border-subtle bg-layer-2 p-2 pl-3 sm:flex-row sm:items-center">
                    <code className="min-w-0 flex-1 text-10 break-all text-primary">{callbackUrl}</code>
                    <Button
                      variant="secondary"
                      size="sm"
                      prependIcon={isCallbackCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      onClick={copyCallbackUrl}
                    >
                      {isCallbackCopied ? "Скопировано" : "Копировать"}
                    </Button>
                  </div>
                </SetupStep>

                <SetupStep number={4} icon={<Video className="size-4" />} title="Сохраните и подключите Meet">
                  <p>
                    Сначала нажмите <strong>Save calendar settings</strong>. Затем в блоке System Google Meet account
                    нажмите <strong>Connect Google account</strong> и войдите под служебным Google Workspace-аккаунтом с
                    включённым Meet.
                  </p>
                  <p className="rounded-lg border border-warning-subtle bg-warning-subtle/40 px-3 py-2 text-warning-primary">
                    Google account и OAuth refresh token заполнятся автоматически. Не получайте и не вставляйте токен
                    вручную.
                  </p>
                </SetupStep>
              </div>

              <aside className="space-y-4 bg-layer-2/50 p-5">
                <div>
                  <div className="text-10 font-semibold tracking-[0.12em] text-tertiary uppercase">Что получится</div>
                  <div className="mt-3 space-y-3">
                    <div className="rounded-lg border border-subtle bg-layer-1 p-3">
                      <div className="flex items-center gap-2 text-11 font-semibold text-primary">
                        <CalendarSync className="size-4 text-accent-primary" /> Личные календари
                      </div>
                      <p className="mt-1 text-10 leading-4 text-secondary">
                        Пользователь подключает свой Google Calendar в настройках профиля и выбирает направление
                        синхронизации.
                      </p>
                    </div>
                    <div className="rounded-lg border border-subtle bg-layer-1 p-3">
                      <div className="flex items-center gap-2 text-11 font-semibold text-primary">
                        <Video className="size-4 text-success-primary" /> Автоматический Meet
                      </div>
                      <p className="mt-1 text-10 leading-4 text-secondary">
                        Служебный аккаунт создаёт открытую ссылку Meet, когда в онлайн-встрече не указана своя ссылка.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-danger-subtle bg-danger-subtle/30 p-3 text-10 leading-4 text-danger-primary">
                  Никому не передавайте Client secret и refresh token. Эти значения вводятся только на этой странице.
                </div>
              </aside>
            </div>
          </details>

          <section className="rounded-xl border border-subtle bg-layer-1 p-5">
            <div className="flex gap-3">
              <div className="grid size-10 place-items-center rounded-lg bg-accent-subtle text-accent-primary">
                <CalendarSync className="size-5" />
              </div>
              <div>
                <h2 className="text-16 font-semibold text-primary">Google Calendar OAuth</h2>
                <p className="mt-1 text-11 text-tertiary">
                  Users connect their own Google accounts from Profile settings → Calendars.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label htmlFor="calendar-google-client-id" className="space-y-1.5 text-11 text-secondary">
                <span>Client ID</span>
                <Input
                  id="calendar-google-client-id"
                  value={values.CALENDAR_GOOGLE_CLIENT_ID}
                  onChange={(event) => update("CALENDAR_GOOGLE_CLIENT_ID", event.target.value)}
                />
              </label>
              <label htmlFor="calendar-google-client-secret" className="space-y-1.5 text-11 text-secondary">
                <span>Client secret</span>
                <Input
                  id="calendar-google-client-secret"
                  type="password"
                  value={values.CALENDAR_GOOGLE_CLIENT_SECRET}
                  onChange={(event) => update("CALENDAR_GOOGLE_CLIENT_SECRET", event.target.value)}
                />
              </label>
            </div>
            <div className="mt-4 rounded-lg border border-subtle bg-layer-2 p-3 text-11 text-secondary">
              <div className="font-medium text-primary">Authorized redirect URI</div>
              <code className="mt-1 block break-all">{callbackUrl}</code>
            </div>
          </section>

          <section className="rounded-xl border border-subtle bg-layer-1 p-5">
            <h2 className="text-16 font-semibold text-primary">Microsoft Outlook OAuth</h2>
            <p className="mt-1 text-11 text-tertiary">
              Use an Entra ID web application with Calendars.ReadWrite permission.
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label htmlFor="calendar-microsoft-client-id" className="space-y-1.5 text-11 text-secondary">
                <span>Client ID</span>
                <Input
                  id="calendar-microsoft-client-id"
                  value={values.CALENDAR_MICROSOFT_CLIENT_ID}
                  onChange={(event) => update("CALENDAR_MICROSOFT_CLIENT_ID", event.target.value)}
                />
              </label>
              <label htmlFor="calendar-microsoft-client-secret" className="space-y-1.5 text-11 text-secondary">
                <span>Client secret</span>
                <Input
                  id="calendar-microsoft-client-secret"
                  type="password"
                  value={values.CALENDAR_MICROSOFT_CLIENT_SECRET}
                  onChange={(event) => update("CALENDAR_MICROSOFT_CLIENT_SECRET", event.target.value)}
                />
              </label>
              <label htmlFor="calendar-microsoft-tenant" className="space-y-1.5 text-11 text-secondary">
                <span>Tenant</span>
                <Input
                  id="calendar-microsoft-tenant"
                  value={values.CALENDAR_MICROSOFT_TENANT}
                  onChange={(event) => update("CALENDAR_MICROSOFT_TENANT", event.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-subtle bg-layer-1 p-5">
            <div className="flex gap-3">
              <div className="grid size-10 place-items-center rounded-lg bg-success-subtle text-success-primary">
                <Video className="size-5" />
              </div>
              <div>
                <h2 className="text-16 font-semibold text-primary">System Google Meet account</h2>
                <p className="mt-1 text-11 text-tertiary">
                  This Workspace account only creates OPEN Meet spaces. The GTS user remains the meeting organizer.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label htmlFor="calendar-google-meet-account" className="space-y-1.5 text-11 text-secondary">
                <span>Google account</span>
                <Input
                  id="calendar-google-meet-account"
                  type="email"
                  value={values.CALENDAR_GOOGLE_MEET_ACCOUNT}
                  onChange={(event) => update("CALENDAR_GOOGLE_MEET_ACCOUNT", event.target.value)}
                />
              </label>
              <label htmlFor="calendar-google-meet-refresh-token" className="space-y-1.5 text-11 text-secondary">
                <span>OAuth refresh token</span>
                <Input
                  id="calendar-google-meet-refresh-token"
                  type="password"
                  value={values.CALENDAR_GOOGLE_MEET_REFRESH_TOKEN}
                  onChange={(event) => update("CALENDAR_GOOGLE_MEET_REFRESH_TOKEN", event.target.value)}
                />
              </label>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-subtle bg-layer-2 p-3">
              <div className="text-11 text-secondary">
                {values.CALENDAR_GOOGLE_MEET_ACCOUNT
                  ? `Connected as ${values.CALENDAR_GOOGLE_MEET_ACCOUNT}`
                  : "No system Meet account connected"}
              </div>
              <Button
                variant="secondary"
                loading={isConnectingMeet}
                disabled={!isGoogleOAuthConfigured}
                onClick={connectMeet}
              >
                {values.CALENDAR_GOOGLE_MEET_ACCOUNT ? "Reconnect Google account" : "Connect Google account"}
              </Button>
            </div>
            <a
              href="https://developers.google.com/meet/api/guides/overview"
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1 text-11 text-accent-primary hover:underline"
            >
              Google Meet API setup <ExternalLink className="size-3" />
            </a>
          </section>

          <div className="flex justify-end">
            <Button variant="primary" loading={isSaving} onClick={save}>
              Save calendar settings
            </Button>
          </div>
        </div>
      )}
    </PageWrapper>
  );
});

export default InstanceCalendarPage;

export const meta: Route.MetaFunction = () => [{ title: "Calendar and meetings - God Mode" }];
