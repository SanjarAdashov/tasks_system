/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useMemo, useState } from "react";
import { Bot, CircleCheck, Search, Send, Unplug, Webhook } from "lucide-react";
import useSWR from "swr";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { InstanceService } from "@plane/services";
import { Input, Loader } from "@plane/ui";
import { PageWrapper } from "@/components/common/page-wrapper";
import type { Route } from "./+types/page";

const InstanceTelegramPage = function InstanceTelegramPage(_props: Route.ComponentProps) {
  const service = useMemo(() => new InstanceService(), []);
  const [token, setToken] = useState("");
  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const { data: telegram, isLoading, mutate } = useSWR("INSTANCE_TELEGRAM_STATUS", () => service.telegramStatus());
  const { data: connections, mutate: mutateConnections } = useSWR(["INSTANCE_TELEGRAM_CONNECTIONS", search], () =>
    service.telegramConnections(search)
  );

  const save = async () => {
    if (!token.trim() && !telegram?.configured) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Bot token is required", message: "Paste a token from BotFather." });
      return;
    }
    setIsSaving(true);
    try {
      const response = await service.configureTelegram({ token: token.trim() || undefined, enabled: true });
      setToken("");
      await Promise.all([mutate(response), mutateConnections()]);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Telegram bot configured",
        message: response.connections_invalidated
          ? "A different bot was connected. Existing user connections were removed."
          : "Webhook registration completed successfully.",
      });
    } catch (error: any) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Could not configure Telegram",
        message: error?.error || "Check the bot token and public URL.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const test = async () => {
    setIsTesting(true);
    try {
      await service.testTelegram();
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Test message sent", message: "Check your Telegram chat." });
    } catch (error: any) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Test failed",
        message: error?.error || "Connect your own Telegram account first.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const disable = async () => {
    if (!window.confirm("Disable Telegram and disconnect all users?")) return;
    await service.disableTelegram();
    await Promise.all([mutate(), mutateConnections()]);
  };

  const disconnect = async (connectionId: string, name: string) => {
    if (!window.confirm(`Disconnect Telegram for ${name}?`)) return;
    await service.disconnectTelegramConnection(connectionId);
    await Promise.all([mutate(), mutateConnections()]);
  };

  return (
    <PageWrapper
      size="lg"
      header={{
        title: "Telegram notifications",
        description: "Connect one system bot and deliver personal notifications to each user's private Telegram chat.",
      }}
    >
      {isLoading ? (
        <Loader className="space-y-4">
          <Loader.Item height="180px" width="100%" />
        </Loader>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-subtle bg-layer-1 p-4">
              <Bot className="size-5 text-accent-primary" />
              <div className="mt-3 text-11 text-tertiary">Bot</div>
              <div className="mt-1 text-14 font-medium text-primary">
                {telegram?.bot_username ? `@${telegram.bot_username}` : "Not configured"}
              </div>
            </div>
            <div className="rounded-md border border-subtle bg-layer-1 p-4">
              <Webhook className="size-5 text-accent-primary" />
              <div className="mt-3 text-11 text-tertiary">Webhook</div>
              <div className="mt-1 flex items-center gap-1 text-14 font-medium text-primary">
                {telegram?.webhook?.url && !telegram.webhook.error ? (
                  <>
                    <CircleCheck className="size-4 text-success-primary" /> Active
                  </>
                ) : (
                  "Not registered"
                )}
              </div>
              {telegram?.webhook?.last_error_message && (
                <div className="mt-1 text-11 text-danger-primary">{telegram.webhook.last_error_message}</div>
              )}
            </div>
            <div className="rounded-md border border-subtle bg-layer-1 p-4">
              <Send className="size-5 text-accent-primary" />
              <div className="mt-3 text-11 text-tertiary">Connected users</div>
              <div className="mt-1 text-20 font-semibold text-primary">{telegram?.connection_count ?? 0}</div>
            </div>
          </div>

          <div className="rounded-md border border-subtle bg-layer-1 p-5">
            <h2 className="text-16 font-medium text-primary">Bot connection</h2>
            <p className="mt-1 text-11 text-tertiary">
              The token is encrypted and is never returned to the browser. Saving registers the public webhook
              automatically.
            </p>
            <div className="mt-4 flex flex-col gap-3 md:flex-row">
              <Input
                id="telegram-bot-token"
                name="telegram-bot-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={
                  telegram?.configured ? "Leave empty to re-register the current bot" : "Paste BotFather token"
                }
                className="flex-1"
              />
              <Button variant="primary" loading={isSaving} onClick={save}>
                {telegram?.configured ? "Save / register webhook" : "Connect bot"}
              </Button>
              {telegram?.configured && (
                <Button variant="secondary" loading={isTesting} prependIcon={<Send />} onClick={test}>
                  Send test
                </Button>
              )}
              {telegram?.configured && (
                <Button variant="error-outline" prependIcon={<Unplug />} onClick={disable}>
                  Disable
                </Button>
              )}
            </div>
            {telegram?.webhook_url && (
              <div className="mt-3 text-11 break-all text-tertiary">Webhook URL: {telegram.webhook_url}</div>
            )}
          </div>

          <div className="rounded-md border border-subtle bg-layer-1">
            <div className="flex flex-col gap-3 border-b border-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-16 font-medium text-primary">Connected users</h2>
                <p className="text-11 text-tertiary">No message content is stored or shown here.</p>
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-tertiary" />
                <Input
                  id="telegram-user-search"
                  name="telegram-user-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search users"
                  className="w-full pl-8"
                />
              </div>
            </div>
            {!connections ? (
              <Loader className="space-y-2 p-4">
                <Loader.Item height="48px" width="100%" />
              </Loader>
            ) : connections.results.length === 0 ? (
              <div className="p-8 text-center text-13 text-tertiary">No Telegram accounts connected.</div>
            ) : (
              <div className="divide-y divide-subtle">
                {connections.results.map((connection) => (
                  <div
                    key={connection.id}
                    className="grid gap-3 p-4 md:grid-cols-[minmax(220px,1.5fr)_minmax(160px,1fr)_120px_180px_auto] md:items-center"
                  >
                    <div>
                      <div className="text-13 font-medium text-primary">{connection.name}</div>
                      <div className="text-11 text-tertiary">{connection.email}</div>
                    </div>
                    <div className="text-12 text-secondary">
                      {connection.telegram_username
                        ? `@${connection.telegram_username}`
                        : connection.telegram_first_name}
                    </div>
                    <span
                      className={`w-fit rounded px-2 py-1 text-11 ${connection.status === "connected" ? "bg-success-subtle text-success-primary" : connection.status === "paused" ? "bg-warning-subtle text-warning-primary" : "bg-danger-subtle text-danger-primary"}`}
                    >
                      {connection.status}
                    </span>
                    <div className="text-11 text-tertiary">
                      Last delivery:{" "}
                      {connection.last_delivery_at ? new Date(connection.last_delivery_at).toLocaleString() : "Never"}
                    </div>
                    <Button
                      variant="error-outline"
                      size="sm"
                      onClick={() => disconnect(connection.id, connection.name)}
                    >
                      Disconnect
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </PageWrapper>
  );
};

export const meta: Route.MetaFunction = () => [{ title: "Telegram - God Mode" }];
export default InstanceTelegramPage;
