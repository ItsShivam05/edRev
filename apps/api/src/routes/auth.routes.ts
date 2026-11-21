import { Router } from "express";
import {
  changePasswordHandler,
  forgotPasswordHandler,
  getMeHandler,
  loginHandler,
  resendSignupCodeHandler,
  resetPasswordHandler,
  signupConfigHandler,
  signupHandler,
  updatePreferencesHandler,
  verifySignupHandler,
} from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";

const router = Router();

router.post("/login", loginHandler);
// Public student self sign-up (accounts start PENDING_APPROVAL)
router.get("/signup-config", signupConfigHandler);
router.post("/signup", signupHandler);
// Email codes (docs/modules/email-codes.md): public, rate-limited per device in the handlers
router.post("/signup/verify", verifySignupHandler);
router.post("/signup/resend", resendSignupCodeHandler);
router.post("/password/forgot", forgotPasswordHandler);
router.post("/password/reset", resetPasswordHandler);
router.get("/me", authenticate, getMeHandler);
// Account settings: always act on the signed-in user, never on an id from the request
router.post("/password", authenticate, changePasswordHandler);
router.patch("/me/preferences", authenticate, updatePreferencesHandler);

export default router;
