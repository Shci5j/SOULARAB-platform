export function securityHeaders(res) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("content-security-policy", "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
}
