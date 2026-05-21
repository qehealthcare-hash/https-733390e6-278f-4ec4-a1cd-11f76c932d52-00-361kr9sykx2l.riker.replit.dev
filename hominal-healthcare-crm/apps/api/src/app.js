import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { authRouter } from "./routes/auth.routes.js";
import { dashboardRouter } from "./routes/dashboard.routes.js";
import { patientRouter } from "./routes/patients.routes.js";
import { employeeRouter } from "./routes/employees.routes.js";
import { inquiryRouter } from "./routes/inquiries.routes.js";
import { billingRouter } from "./routes/billings.routes.js";
import { payoutRouter } from "./routes/payouts.routes.js";
import { reportRouter } from "./routes/reports.routes.js";
import { uploadRouter } from "./routes/uploads.routes.js";
import { lookupsRouter } from "./routes/lookups.routes.js";
import { referenceRouter } from "./routes/reference.routes.js";

export function createApp() {
  var app = express();

  app.use(
    cors({
      origin: env.appOrigin,
      credentials: true
    })
  );
  app.use(helmet());
  app.use(express.json({ limit: "10mb" }));
  app.use(morgan("dev"));

  app.get("/health", function healthHandler(req, res) {
    res.json({
      success: true,
      service: "hominal-healthcare-crm-api"
    });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/patients", patientRouter);
  app.use("/api/employees", employeeRouter);
  app.use("/api/inquiries", inquiryRouter);
  app.use("/api/billings", billingRouter);
  app.use("/api/payouts", payoutRouter);
  app.use("/api/reports", reportRouter);
  app.use("/api/uploads", uploadRouter);
  app.use("/api/lookups", lookupsRouter);
  app.use("/api/reference", referenceRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export var app = createApp();
export default app;
