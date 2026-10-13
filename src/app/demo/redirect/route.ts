// Demo-only open redirect to a loopback address outside the allowlist, used to prove redirects are contained.
export function GET(req: Request) {
  const target = new URL(req.url);
  target.hostname = "127.0.0.1";
  target.pathname = "/api/config";
  target.search = "";
  return Response.redirect(target, 302);
}
