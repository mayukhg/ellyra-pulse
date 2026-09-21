#!/usr/bin/env node
/**
 * Mints a workforce session JWT for local development and testing — NOT an HTTP endpoint,
 * deliberately, since an unauthenticated token-minting endpoint would defeat the point of
 * requiring auth at all. Requires AUTH_JWT_SECRET.
 *
 * Usage: node scripts/mint-dev-token.mjs [role] [userId] [tenantId]
 *   role defaults to "administrator"
 */
import jwt from "jsonwebtoken";

const [, , role = "administrator", userId = "dev-user", tenantId = "dev-tenant"] = process.argv;

const secret = process.env.AUTH_JWT_SECRET;
if (!secret) {
  console.error("AUTH_JWT_SECRET is not set.");
  process.exit(1);
}

const validRoles = ["dashboard_viewer", "customer_success", "clinical_safety", "administrator"];
if (!validRoles.includes(role)) {
  console.error(`Unknown role "${role}". Valid roles: ${validRoles.join(", ")}`);
  process.exit(1);
}

const token = jwt.sign({ sub: userId, tenantId, role }, secret, { expiresIn: "12h", algorithm: "HS256" });
console.log(token);
