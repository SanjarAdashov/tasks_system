/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { CalendarSync, ExternalLink, Video } from "lucide-react";
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

export default function InstanceCalendarPage(_props: Route.ComponentProps) {
  const { fetchInstanceConfigurations, formattedConfig, updateInstanceConfigurations } = useInstance();
  const service = useMemo(() => new InstanceService(), []);
  const [values, setValues] = useState<Values>(emptyValues);
  const [isSaving, setIsSaving] = useState(false);
  const [isConnectingMeet, setIsConnectingMeet] = useState(false);
  useSWR("INSTANCE_CONFIGURATIONS", () => fetchInstanceConfigurations());

  useEffect(() => {
    if (!formattedConfig) return;
    setValues(Object.fromEntries(keys.map((key) => [key, formattedConfig[key] || emptyValues[key]])) as Values);
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
              <Button variant="secondary" loading={isConnectingMeet} onClick={connectMeet}>
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
}

export const meta: Route.MetaFunction = () => [{ title: "Calendar and meetings - God Mode" }];
