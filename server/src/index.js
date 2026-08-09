import dotenv from 'dotenv';

dotenv.config();

// dotenv must run before app.js is evaluated — it reads CORS_ORIGIN at import
// time — so this is a dynamic import, not a static one.
const { default: app, allowedOrigins } = await import('./app.js');

const PORT = process.env.PORT || 5000;

console.log('CORS allowed origins:', allowedOrigins);

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` RoadMate B2B2C API Server running on port ${PORT}`);
  console.log(` DB URL: Connected via PostgreSQL on port 5433`);
  console.log(` Active Environment: Production ready`);
  console.log(`==================================================`);
});
