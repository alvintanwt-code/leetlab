import NextAuth from "next-auth";
import authConfig from "./auth.config";

const { auth } = NextAuth(authConfig);
export default auth;

export const config = {
  // Skip the auth check for Next.js build artefacts, the NextAuth handler
  // routes, and any static file in /public/ (anything ending in a common
  // asset extension). Without this last group, requests for /leet-logo.png
  // get caught by the auth proxy and 307'd to /login.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|html|pdf)).*)",
  ],
};
