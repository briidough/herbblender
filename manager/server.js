const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// Proxy /api/* to the main backend — must be before static file serving.
// Mount at root with pathFilter so Express doesn't strip the /api prefix.
app.use(createProxyMiddleware({
  target: 'http://localhost:3000',
  changeOrigin: true,
  pathFilter: '/api/**',
}));

app.use(express.static(path.join(__dirname)));

const PORT = 42728;
app.listen(PORT, () => console.log(`HerbBlender Manager running on port ${PORT}`));
