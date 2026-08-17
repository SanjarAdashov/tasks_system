/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
import { Bot, CircleCheck, Eye, EyeOff, Globe2, Network, RotateCcw, Search, Send, Unplug, Webhook } from "lucide-react";
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
  const [proxyUrl, setProxyUrl] = useState("");
  const [showProxyUrl, setShowProxyUrl] = useState(false);
  const [removeProxy, setRemoveProxy] = useState(false);
  const [apiEndpointMode, setApiEndpointMode] = useState<"standard" | "custom">("standard");
  const [apiEndpoint, setApiEndpoint] = useState("");
  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const { data: telegram, isLoading, mutate } = useSWR("INSTANCE_TELEGRAM_STATUS", () => service.telegramStatus());
  const { data: connections, mutate: mutateConnections } = useSWR(["INSTANCE_TELEGRAM_CONNECTIONS", search], () =>
    service.telegramConnections(search)
  );

  useEffect(() => {
    if (telegram?.api_endpoint_mode) setApiEndpointMode(telegram.api_endpoint_mode);
  }, [telegram?.api_endpoint_mode]);

  const save = async () => {
    if (!token.trim() && !telegram?.configured) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Bot token is required", message: "Paste a token from BotFather." });
      return;
    }
    if (apiEndpointMode === "custom" && !apiEndpoint.trim() && !telegram?.custom_api_endpoint_configured) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Custom endpoint is required",
        message: "Enter the HTTPS base URL of your Telegram Bot API proxy.",
      });
      return;
    }
    setIsSaving(true);
    try {
      const response = await service.configureTelegram({
        token: token.trim() || undefined,
        enabled: true,
        proxy_url: removeProxy ? "" : proxyUrl.trim() || undefined,
        api_endpoint_mode: apiEndpointMode,
        api_endpoint: apiEndpointMode === "custom" ? apiEndpoint.trim() || undefined : "",
      });
      setToken("");
      setProxyUrl("");
      setApiEndpoint("");
      setRemoveProxy(false);
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
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
              <Globe2 className="size-5 text-accent-primary" />
              <div className="mt-3 text-11 text-tertiary">Telegram Bot API</div>
              <div className="mt-1 text-14 font-medium text-primary">
                {telegram?.api_endpoint_mode === "custom" ? telegram.api_endpoint_host : "api.telegram.org"}
              </div>
              <div className="mt-1 text-11 text-tertiary">
                {telegram?.api_endpoint_mode === "custom" ? "Custom endpoint" : "Standard Telegram endpoint"}
                {telegram?.proxy_configured ? ` · ${telegram.proxy_scheme?.toUpperCase()} transport proxy` : ""}
              </div>
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
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                id="telegram-bot-token"
                name="telegram-bot-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={
                  telegram?.configured ? "Leave empty to re-register the current bot" : "Paste BotFather token"
                }
                className="w-full"
              />
              <div className="flex flex-wrap gap-2">
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
            </div>

            <div className="mt-5 border-t border-subtle pt-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-md bg-layer-2 p-2 text-accent-primary">
                  <Globe2 className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-13 font-medium text-primary">Telegram Bot API endpoint</h3>
                  <p className="mt-1 text-11 text-tertiary">
                    Choose the standard Telegram API or route every Bot API request through your own HTTPS reverse
                    proxy.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      aria-pressed={apiEndpointMode === "standard"}
                      onClick={() => setApiEndpointMode("standard")}
                      className={`rounded-md border p-3 text-left transition-colors ${
                        apiEndpointMode === "standard"
                          ? "border-accent-primary bg-accent-subtle"
                          : "border-subtle bg-layer-2 hover:border-strong"
                      }`}
                    >
                      <div className="text-13 font-medium text-primary">Standard Telegram endpoint</div>
                      <div className="mt-1 text-11 text-tertiary">https://api.telegram.org</div>
                    </button>
                    <button
                      type="button"
                      aria-pressed={apiEndpointMode === "custom"}
                      onClick={() => setApiEndpointMode("custom")}
                      className={`rounded-md border p-3 text-left transition-colors ${
                        apiEndpointMode === "custom"
                          ? "border-accent-primary bg-accent-subtle"
                          : "border-subtle bg-layer-2 hover:border-strong"
                      }`}
                    >
                      <div className="text-13 font-medium text-primary">Custom endpoint</div>
                      <div className="mt-1 text-11 text-tertiary">
                        {telegram?.custom_api_endpoint_configured
                          ? telegram.api_endpoint_host
                          : "Your Telegram Bot API reverse proxy"}
                      </div>
                    </button>
                  </div>
                  {apiEndpointMode === "custom" && (
                    <div className="mt-3">
                      <Input
                        id="telegram-api-endpoint"
                        name="telegram-api-endpoint"
                        type="url"
                        value={apiEndpoint}
                        onChange={(event) => setApiEndpoint(event.target.value)}
                        placeholder={
                          telegram?.custom_api_endpoint_configured
                            ? "Custom endpoint configured — leave empty to keep it"
                            : "https://telegram-proxy.example.com"
                        }
                        className="w-full"
                      />
                      <p className="mt-2 text-11 text-tertiary">
                        Enter the base URL before <code>/bot&lt;TOKEN&gt;/&lt;method&gt;</code>. HTTPS is required. The
                        endpoint is encrypted and never returned to the browser.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 border-t border-subtle pt-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-md bg-layer-2 p-2 text-accent-primary">
                  <Network className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-13 font-medium text-primary">Telegram network route</h3>
                  <p className="mt-1 text-11 text-tertiary">
                    Optional HTTP, HTTPS, SOCKS5, or SOCKS5H proxy. Credentials are encrypted and this address is never
                    returned to the browser.
                  </p>
                  <div className="mt-3 flex flex-col gap-2 lg:flex-row">
                    <Input
                      id="telegram-proxy-url"
                      name="telegram-proxy-url"
                      type={showProxyUrl ? "text" : "password"}
                      value={proxyUrl}
                      onChange={(event) => {
                        setProxyUrl(event.target.value);
                        setRemoveProxy(false);
                      }}
                      disabled={removeProxy}
                      placeholder={
                        telegram?.proxy_configured
                          ? "Proxy configured — leave empty to keep it"
                          : "socks5h://user:password@proxy.example.com:1080"
                      }
                      className="min-w-0 flex-1"
                    />
                    <Button
                      variant="secondary"
                      prependIcon={showProxyUrl ? <EyeOff /> : <Eye />}
                      onClick={() => setShowProxyUrl((value) => !value)}
                    >
                      {showProxyUrl ? "Hide" : "Show"}
                    </Button>
                    {telegram?.proxy_configured && (
                      <Button variant="secondary" prependIcon={<RotateCcw />} onClick={() => setRemoveProxy(true)}>
                        Use direct connection
                      </Button>
                    )}
                  </div>
                  {removeProxy && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-11 text-warning-primary">
                      The proxy will be removed only after Telegram accepts the direct connection.
                      <button type="button" className="font-medium underline" onClick={() => setRemoveProxy(false)}>
                        Keep proxy
                      </button>
                    </div>
                  )}
                  <p className="mt-2 text-11 text-tertiary">
                    Include the port. Encode special characters in the username or password as URL characters.
                  </p>
                </div>
              </div>
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
