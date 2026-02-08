/**
 * RWA Dark Pool - Matching Engine API Server
 *
 * Express server that wraps the matching engine and prover library
 * to provide REST API endpoints for the frontend.
 */

import express from "express";
import { corsMiddleware } from "./middleware/cors";
import { requestLogger } from "./middleware/requestLogger";
import { logger } from "./lib/logger";
import commitmentRoutes from "./routes/commitment";
import ordersRoutes, { setMatchingEngine as setOrdersEngine, setSettlementService as setOrdersSettlementService } from "./routes/orders";
import matchesRoutes, { setMatchingEngine as setMatchesEngine, setSettlementServiceRef } from "./routes/matches";
import settlementRoutes, { setSettlementService } from "./routes/settlement";
import whitelistRoutes, { setMatchingEngine as setWhitelistEngine } from "./routes/whitelist";
import { DarkPoolMatchingEngine } from "./index";
import { SettlementService } from "./services/settlement";
import { MatchingEngineWebSocket } from "./websocket";

const log = logger.server;

// Environment configuration
const PORT = process.env.PORT || 3001;
const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";

// Initialize Express app
const app = express();

// Middleware
app.use(corsMiddleware);
app.use(express.json());
app.use(requestLogger);

// Handle preflight requests explicitly
app.options("*", corsMiddleware);

// Initialize matching engine and settlement service
const matchingEngine = new DarkPoolMatchingEngine(RPC_URL);
const settlementService = new SettlementService(RPC_URL);

// WebSocket server instance (initialized after HTTP server starts)
let wsServer: MatchingEngineWebSocket | null = null;

// Set engine/service references in route modules
setOrdersEngine(matchingEngine);
setOrdersSettlementService(settlementService);
setMatchesEngine(matchingEngine);
setSettlementService(settlementService);
setSettlementServiceRef(settlementService);
setWhitelistEngine(matchingEngine);

// Export for use in matches route (auto-queue settlements)
export { settlementService };

// API Routes
app.use("/api/commitment", commitmentRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/matches", matchesRoutes);
app.use("/api/settlement", settlementRoutes);
app.use("/api/whitelist", whitelistRoutes);

// Health check endpoint
app.get("/health", (_req, res) => {
  const wsStats = wsServer?.getStats() ?? { connections: 0, channels: 0, totalSubscriptions: 0 };
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    pendingMatches: matchingEngine.getPendingMatchesCount(),
    websocket: wsStats,
  });
});

// API info endpoint
app.get("/api", (_req, res) => {
  res.json({
    name: "RWA Dark Pool Matching Engine API",
    version: "1.0.0",
    endpoints: {
      commitment: {
        "POST /api/commitment/generate": "Generate Poseidon commitment for order",
        "POST /api/commitment/hash-asset": "Hash asset address using Poseidon",
      },
      orders: {
        "POST /api/orders/submit": "Submit private order to matching engine",
        "GET /api/orders/:assetAddress": "Get order book state for asset",
      },
      matches: {
        "GET /api/matches": "Get all completed matches",
        "GET /api/matches/pending": "Get pending matches count",
        "GET /api/matches/settlements": "Get settlement results",
        "POST /api/matches/process": "Process pending matches (generate proofs)",
      },
      settlement: {
        "GET /api/settlement/pending": "Get all pending settlements",
        "GET /api/settlement/stats/summary": "Get settlement statistics",
        "GET /api/settlement/for-trader/:address": "Get settlements for a specific trader",
        "GET /api/settlement/:matchId": "Get settlement details",
        "GET /api/settlement/:matchId/signing-status": "Get signing status for settlement",
        "POST /api/settlement/:matchId/prepare": "Prepare settlement data",
        "POST /api/settlement/:matchId/build-tx": "Build unsigned settlement transaction",
        "POST /api/settlement/:matchId/sign": "Add signature from buyer or seller",
        "POST /api/settlement/:matchId/submit": "Submit signed settlement transaction",
        "POST /api/settlement/:matchId/confirm": "Mark settlement as confirmed",
      },
      whitelist: {
        "POST /api/whitelist/sync": "Sync whitelist from registry contract",
        "GET /api/whitelist/status": "Get current whitelist status",
      },
      health: {
        "GET /health": "Health check",
      },
    },
  });
});

// Error handling middleware
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    log.error({ err }, "Unhandled error");
    res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
);

// Start server
async function start() {
  // Initialize whitelist with some test participants
  // In production, this would be loaded from the registry contract
  const testParticipants = [
    "1234567890123456789012345678901234567890",
    "2345678901234567890123456789012345678901",
    "3456789012345678901234567890123456789012",
    "4567890123456789012345678901234567890123",
  ];

  try {
    await matchingEngine.initializeWhitelist(testParticipants);
  } catch (error: any) {
    log.warn({ err: error }, "Whitelist initialization skipped");
  }

  // Start HTTP server and attach WebSocket
  const server = app.listen(PORT, () => {
    log.info({ port: PORT }, "Server started");
  });

  // Initialize WebSocket server
  wsServer = new MatchingEngineWebSocket(server);
}

start().catch((error) => {
  log.fatal({ err: error }, "Failed to start server");
  process.exit(1);
});
