import { Router, type IRouter } from "express";
import healthRouter from "./health";
import downloadRouter from "./download";
import chainRouter from "./chain";
import chainBuilderRouter from "./chain-builder";
import productionDeployRouter from "./production-deploy";
import rpcRouter from "./rpc";
import pairRouter from "./pair";
import bridgeRouter from "./bridge";
import wcRouter from "./wc";
import tokensRouter from "./tokens";
import sitesRouter from "./sites";

const router: IRouter = Router();

router.use(healthRouter);
router.use(downloadRouter);
router.use(chainRouter);
router.use(chainBuilderRouter);
router.use(productionDeployRouter);
router.use(rpcRouter);
router.use(pairRouter);
router.use(bridgeRouter);
router.use(wcRouter);
router.use(tokensRouter);
router.use(sitesRouter);

export default router;
