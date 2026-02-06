import type WebSocket from "ws";
import type { EventName, EventMap } from "../events/EventBus";

// Message types from client
export interface SubscribeMessage {
  type: "subscribe";
  channel: string;
}

export interface UnsubscribeMessage {
  type: "unsubscribe";
  channel: string;
}

export interface PingMessage {
  type: "ping";
}

export type ClientMessage = SubscribeMessage | UnsubscribeMessage | PingMessage;

// Message types to client
export interface EventMessage<K extends EventName = EventName> {
  type: "event";
  event: K;
  channel: string;
  data: EventMap[K];
}

export interface SubscribedMessage {
  type: "subscribed";
  channel: string;
}

export interface UnsubscribedMessage {
  type: "unsubscribed";
  channel: string;
}

export interface PongMessage {
  type: "pong";
  timestamp: number;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type ServerMessage =
  | EventMessage
  | SubscribedMessage
  | UnsubscribedMessage
  | PongMessage
  | ErrorMessage;

// Channel subscription manager
export class SubscriptionManager {
  // Map of channel -> Set of WebSocket clients
  private channels: Map<string, Set<WebSocket>> = new Map();
  // Map of WebSocket client -> Set of subscribed channels
  private clientChannels: Map<WebSocket, Set<string>> = new Map();

  subscribe(ws: WebSocket, channel: string): boolean {
    // Add to channel's subscriber set
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel)!.add(ws);

    // Track client's subscriptions
    if (!this.clientChannels.has(ws)) {
      this.clientChannels.set(ws, new Set());
    }
    this.clientChannels.get(ws)!.add(channel);

    console.log(`[WS] Client subscribed to ${channel}. Total subscribers: ${this.channels.get(channel)!.size}`);
    return true;
  }

  unsubscribe(ws: WebSocket, channel: string): boolean {
    const channelSubs = this.channels.get(channel);
    if (channelSubs) {
      channelSubs.delete(ws);
      if (channelSubs.size === 0) {
        this.channels.delete(channel);
      }
    }

    const clientSubs = this.clientChannels.get(ws);
    if (clientSubs) {
      clientSubs.delete(channel);
    }

    console.log(`[WS] Client unsubscribed from ${channel}`);
    return true;
  }

  removeClient(ws: WebSocket): void {
    const clientSubs = this.clientChannels.get(ws);
    if (clientSubs) {
      for (const channel of clientSubs) {
        const channelSubs = this.channels.get(channel);
        if (channelSubs) {
          channelSubs.delete(ws);
          if (channelSubs.size === 0) {
            this.channels.delete(channel);
          }
        }
      }
      this.clientChannels.delete(ws);
    }
    console.log(`[WS] Client removed from all channels`);
  }

  getSubscribers(channel: string): Set<WebSocket> {
    return this.channels.get(channel) || new Set();
  }

  getChannelsByPattern(pattern: string): string[] {
    const regex = new RegExp(`^${pattern.replace("*", ".*")}$`);
    return Array.from(this.channels.keys()).filter((ch) => regex.test(ch));
  }

  getStats(): { channels: number; totalSubscriptions: number } {
    let totalSubscriptions = 0;
    for (const subs of this.channels.values()) {
      totalSubscriptions += subs.size;
    }
    return {
      channels: this.channels.size,
      totalSubscriptions,
    };
  }
}

// Message handler
export function handleMessage(
  ws: WebSocket,
  message: string,
  subscriptionManager: SubscriptionManager
): void {
  try {
    const parsed = JSON.parse(message) as ClientMessage;

    switch (parsed.type) {
      case "subscribe": {
        const { channel } = parsed as SubscribeMessage;
        if (!channel || typeof channel !== "string") {
          sendError(ws, "Invalid channel");
          return;
        }
        subscriptionManager.subscribe(ws, channel);
        sendMessage(ws, { type: "subscribed", channel });
        break;
      }

      case "unsubscribe": {
        const { channel } = parsed as UnsubscribeMessage;
        if (!channel || typeof channel !== "string") {
          sendError(ws, "Invalid channel");
          return;
        }
        subscriptionManager.unsubscribe(ws, channel);
        sendMessage(ws, { type: "unsubscribed", channel });
        break;
      }

      case "ping": {
        sendMessage(ws, { type: "pong", timestamp: Date.now() });
        break;
      }

      default:
        sendError(ws, `Unknown message type: ${(parsed as { type: string }).type}`);
    }
  } catch (error) {
    console.error("[WS] Error parsing message:", error);
    sendError(ws, "Invalid JSON message");
  }
}

// Helper to send messages
export function sendMessage(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

export function sendError(ws: WebSocket, message: string): void {
  sendMessage(ws, { type: "error", message });
}

// Broadcast to channel subscribers
export function broadcastToChannel<K extends EventName>(
  subscriptionManager: SubscriptionManager,
  channel: string,
  event: K,
  data: EventMap[K]
): number {
  const subscribers = subscriptionManager.getSubscribers(channel);
  let sent = 0;

  for (const ws of subscribers) {
    if (ws.readyState === ws.OPEN) {
      sendMessage(ws, {
        type: "event",
        event,
        channel,
        data,
      } as EventMessage<K>);
      sent++;
    }
  }

  console.log(`[WS] Broadcast ${event} to ${channel}: ${sent} clients`);
  return sent;
}

// Broadcast to multiple channels matching a pattern
export function broadcastToPattern<K extends EventName>(
  subscriptionManager: SubscriptionManager,
  pattern: string,
  event: K,
  data: EventMap[K]
): number {
  const channels = subscriptionManager.getChannelsByPattern(pattern);
  let totalSent = 0;

  for (const channel of channels) {
    totalSent += broadcastToChannel(subscriptionManager, channel, event, data);
  }

  return totalSent;
}
