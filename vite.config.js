export default {
  // host: listen on the LAN too, so other devices on the network can open it
  server: { port: 5199, strictPort: false, host: true },
  preview: { port: 5199, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
};
