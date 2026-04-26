import { Router, type IRouter, type Request, type Response } from "express";
import { SITE_TEMPLATES } from "../../data/site-templates";

const router: IRouter = Router();

router.get("/", (_req: Request, res: Response) => {
  res.json(SITE_TEMPLATES);
});

export default router;
