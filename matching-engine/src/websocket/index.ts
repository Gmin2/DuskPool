import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { eventBus, EventName, EventMap } from "../events/EventBus";
import { logger } from "../lib/logger";
import {
  SubscriptionManager,
  handleMessage,
  broadcastToChannel,
  sendMessage,
} from "./handlers";

const log = logger.websocket;

export class MatchingEngineWebSocket {
  private wss: WebSocketServer;
  private subscriptionManager: SubscriptionManager;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server });
    this.subscriptionManager = new SubscriptionManager();

    this.setupConnectionHandler();
    this.setupEventBusListeners();
    this.startHeartbeat();

    log.info("WebSocket server initialized");
  }

  private setupConnectionHandler(): void {
    this.wss.on("connection", (ws: WebSocket, req) => {
      const clientIp = req.socket.remoteAddress;
      log.info({ clientIp }, "New connection");

      // Mark as alive for heartbeat
      (ws as WebSocket & { isAlive: boolean }).isAlive = true;

      ws.on("pong", () => {
        (ws as WebSocket & { isAlive: boolean }).isAlive = true;
      });

      ws.on("message", (data) => {
        const message = data.toString();
        handleMessage(ws, message, this.subscriptionManager);
      });

      ws.on("close", () => {
        log.info({ clientIp }, "Connection closed");
        this.subscriptionManager.removeClient(ws);
      });

      ws.on("error", (error) => {
        log.error({ err: error, clientIp }, "WebSocket error");
        this.subscriptionManager.removeClient(ws);
      });

      // Send welcome message
      sendMessage(ws, {
        type: "event",
        event: "order:submitted" as EventName,
        channel: "system",
        data: {
          orderId: "welcome",
          trader: "",
          asset: "",
          side: "buy",
          timestamp: Date.now(),
        },
      });
    });
  }

  private setupEventBusListeners(): void {
    // Order events
    eventBus.on("order:submitted", (data) => {
      // Broadcast to orderbook channel for the asset
      broadcastToChannel(
        this.subscriptionManager,
        `orderbook:${data.asset}`,
        "order:submitted",
        data
      );
      // Also broadcast to trader's personal channel
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.trader}`,
        "order:submitted",
        data
      );
    });

    eventBus.on("order:matched", (data) => {
      // Broadcast to orderbook channel
      broadcastToChannel(
        this.subscriptionManager,
        `orderbook:${data.asset}`,
        "order:matched",
        data
      );
      // Broadcast to both traders
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.buyerAddress}`,
        "order:matched",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.sellerAddress}`,
        "order:matched",
        data
      );
      // Broadcast to settlement channel
      broadcastToChannel(
        this.subscriptionManager,
        `settlement:${data.matchId}`,
        "order:matched",
        data
      );
    });

    // Proof events
    eventBus.on("proof:generating", (data) => {
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.buyerAddress}`,
        "proof:generating",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.sellerAddress}`,
        "proof:generating",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `settlement:${data.matchId}`,
        "proof:generating",
        data
      );
    });

    eventBus.on("proof:generated", (data) => {
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.buyerAddress}`,
        "proof:generated",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.sellerAddress}`,
        "proof:generated",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `settlement:${data.matchId}`,
        "proof:generated",
        data
      );
    });

    eventBus.on("proof:failed", (data) => {
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.buyerAddress}`,
        "proof:failed",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.sellerAddress}`,
        "proof:failed",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `settlement:${data.matchId}`,
        "proof:failed",
        data
      );
    });

    // Settlement events
    eventBus.on("settlement:queued", (data) => {
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.buyerAddress}`,
        "settlement:queued",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.sellerAddress}`,
        "settlement:queued",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `settlement:${data.matchId}`,
        "settlement:queued",
        data
      );
    });

    eventBus.on("settlement:txBuilt", (data) => {
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.buyerAddress}`,
        "settlement:txBuilt",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.sellerAddress}`,
        "settlement:txBuilt",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `settlement:${data.matchId}`,
        "settlement:txBuilt",
        data
      );
    });

    eventBus.on("settlement:confirmed", (data) => {
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.buyerAddress}`,
        "settlement:confirmed",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.sellerAddress}`,
        "settlement:confirmed",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `settlement:${data.matchId}`,
        "settlement:confirmed",
        data
      );
    });

    eventBus.on("settlement:failed", (data) => {
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.buyerAddress}`,
        "settlement:failed",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.sellerAddress}`,
        "settlement:failed",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `settlement:${data.matchId}`,
        "settlement:failed",
        data
      );
    });

    // Signature events
    eventBus.on("signature:added", (data) => {
      broadcastToChannel(
        this.subscriptionManager,
        `settlement:${data.matchId}`,
        "signature:added",
        data
      );
    });

    eventBus.on("signature:complete", (data) => {
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.buyerAddress}`,
        "signature:complete",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `trader:${data.sellerAddress}`,
        "signature:complete",
        data
      );
      broadcastToChannel(
        this.subscriptionManager,
        `settlement:${data.matchId}`,
        "signature:complete",
        data
      );
    });
  }

  private startHeartbeat(): void {
    // Ping all clients every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        const client = ws as WebSocket & { isAlive: boolean };
        if (client.isAlive === false) {
          log.debug("Terminating inactive client");
          this.subscriptionManager.removeClient(ws);
          return client.terminate();
        }

        client.isAlive = false;
        client.ping();
      });
    }, 30000);
  }

  getStats(): {
    connections: number;
    channels: number;
    totalSubscriptions: number;
  } {
    const subStats = this.subscriptionManager.getStats();
    return {
      connections: this.wss.clients.size,
      ...subStats,
    };
  }

  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.wss.close();
    log.info("WebSocket server closed");
  }
}

// Export for use in server.ts
export { eventBus } from "../events/EventBus";
export type { EventName, EventMap } from "../events/EventBus";
