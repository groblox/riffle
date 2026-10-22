// Extra hostnames to answer to (e.g. a Tailscale name); Vite only allows localhost and raw IPs by default.
// Launchpad sets RIFFLE_ALLOWED_HOSTS to this PC's Tailscale names.
const allowedHosts = (process.env.RIFFLE_ALLOWED_HOSTS ?? '').split(',').map(h => h.trim()).filter(Boolean);

export default {
  // host: listen on the LAN too, so other devices on the network can open it
  server: { port: 5199, strictPort: false, host: true, allowedHosts },
  preview: { port: 5199, host: true, allowedHosts },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
};
