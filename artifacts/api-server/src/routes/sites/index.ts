import { Router, type IRouter } from "express";
import sitesRouter from "./sites";
import aiRouter from "./ai";
import templatesRouter from "./templates";
import leadsRouter from "./leads";
import paymentsRouter from "./payments";
import analyticsRouter from "./analytics";
import publicRouter from "./public";

const router: IRouter = Router();

// Order matters: dashboard summary is at /sites/dashboard/summary so it must
// be mounted via its own sub-path inside sites.
router.use("/sites/templates", templatesRouter);
router.use("/sites/ai", aiRouter);
router.use("/sites/dashboard", analyticsRouter); // exposes /sites/dashboard/summary
router.use("/sites/public", publicRouter);
router.use("/sites/sites", sitesRouter);
router.use("/sites/sites", leadsRouter);
router.use("/sites/sites", paymentsRouter);
router.use("/sites/sites", analyticsRouter); // also exposes /sites/sites/{id}/analytics

export default router;
