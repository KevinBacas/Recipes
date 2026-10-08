import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startRealtimeRefresh } from "@/lib/realtime-controller";
import { deferred } from "./helpers/action-client";
function setup() {
  let subscription!: (state: string) => void;
  const changes: Array<() => void> = [];
  const channel = {
    on: vi.fn((_type, _filter, callback) => {
      changes.push(callback);
      return channel;
    }),
    subscribe: vi.fn((callback) => {
      subscription = callback;
      return channel;
    }),
  };
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => {}),
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: "test-jwt" } },
        error: null,
      })),
    },
    realtime: { setAuth: vi.fn(async () => {}) },
  };
  const refreshPage = vi.fn();
  const onStatus = vi.fn();
  const reconnect = vi.fn();
  const windowEvents = new EventTarget();
  const documentEvents = Object.assign(new EventTarget(), {
    visibilityState: "visible" as DocumentVisibilityState,
  });
  const start = () =>
    startRealtimeRefresh({
      client: client as unknown as Parameters<typeof startRealtimeRefresh>[0]["client"],
      ownerId: "owner",
      tables: ["workspaces"],
      refreshPage,
      onStatus,
      reconnect,
      windowEvents,
      documentEvents,
    });
  return {
    start,
    client,
    channel,
    changes,
    refreshPage,
    onStatus,
    reconnect,
    windowEvents,
    documentEvents,
    status: (state: string) => subscription(state),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});
describe("cycle de vie Realtime", () => {
  it("authentifie avant abonnement, regroupe les événements et nettoie le timer", async () => {
    const f = setup();
    const lifetime = f.start();
    await lifetime.ready;
    expect(f.client.realtime.setAuth).toHaveBeenCalledWith("test-jwt");
    expect(f.client.realtime.setAuth.mock.invocationCallOrder[0]).toBeLessThan(
      f.channel.subscribe.mock.invocationCallOrder[0],
    );
    f.status("SUBSCRIBED");
    f.changes[0]();
    f.changes[1]();
    await vi.advanceTimersByTimeAsync(120);
    expect(f.refreshPage).toHaveBeenCalledTimes(1);
    f.changes[0]();
    lifetime.dispose();
    lifetime.dispose();
    await vi.runAllTimersAsync();
    expect(f.client.removeChannel).toHaveBeenCalledTimes(1);
    f.status("CLOSED");
    f.changes[0]();
    f.windowEvents.dispatchEvent(new Event("online"));
    f.windowEvents.dispatchEvent(new Event("focus"));
    await vi.runAllTimersAsync();
    expect(f.refreshPage).toHaveBeenCalledTimes(1);
    expect(f.reconnect).not.toHaveBeenCalled();
    expect(f.onStatus).toHaveBeenCalledTimes(1);
  });
  it("ignore une session reçue après destruction", async () => {
    const f = setup();
    const session = deferred<Awaited<ReturnType<typeof f.client.auth.getSession>>>();
    f.client.auth.getSession.mockReturnValue(session.promise);
    const lifetime = f.start();
    lifetime.dispose();
    session.resolve({ data: { session: { access_token: "late" } }, error: null });
    await lifetime.ready;
    expect(f.client.realtime.setAuth).not.toHaveBeenCalled();
    expect(f.channel.subscribe).not.toHaveBeenCalled();
  });
  it("ignore une authentification terminée après destruction", async () => {
    const f = setup();
    const auth = deferred();
    f.client.realtime.setAuth.mockReturnValue(auth.promise);
    const lifetime = f.start();
    await Promise.resolve();
    lifetime.dispose();
    auth.resolve();
    await lifetime.ready;
    expect(f.channel.subscribe).not.toHaveBeenCalled();
  });
  it("recrée le canal en ligne et rafraîchit au focus ou retour visible", async () => {
    const f = setup();
    const first = f.start();
    await first.ready;
    f.windowEvents.dispatchEvent(new Event("offline"));
    expect(f.onStatus).toHaveBeenLastCalledWith("offline");
    f.windowEvents.dispatchEvent(new Event("online"));
    expect(f.reconnect).toHaveBeenCalledTimes(1);
    first.dispose();
    const second = f.start();
    await second.ready;
    expect(f.client.channel).toHaveBeenCalledTimes(2);
    f.windowEvents.dispatchEvent(new Event("focus"));
    f.documentEvents.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(120);
    expect(f.refreshPage).toHaveBeenCalledTimes(1);
    second.dispose();
  });
});
