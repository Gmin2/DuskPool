/**
 * CORS middleware configuration
 */

import cors from "cors";

// In development, allow all origins for easier testing
// In production, this should be restricted to known frontend origins
export const corsMiddleware = cors({
  origin: true, // Allow all origins in development
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
});
