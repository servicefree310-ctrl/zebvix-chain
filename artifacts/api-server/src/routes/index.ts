import { Router, type IRouter } from "express";
import healthRouter from "./health";
import downloadRouter from "./download";
import chainRouter from "./chain";
import chainBuilderRouter from "./chain-builder";
import rpcRouter from "./rpc";
import pairRouter from "./pair";
import bridgeRouter from "./bridge";
import wcRouter from "./wc";
import tokensRouter from "./tokens";

const router: IRouter = Router();

router.use(healthRouter);
router.use(downloadRouter);
router.use(chainRouter);
router.use(chainBuilderRouter);
router.use(rpcRouter);
router.use(pairRouter);
router.use(bridgeRouter);
router.use(wcRouter);
router.use(tokensRouter);

export default router;
