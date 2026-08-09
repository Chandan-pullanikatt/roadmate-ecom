// `babel-preset-expo` covers expo-router, JSX and the new architecture. The
// shared workspace packages ship uncompiled source and are transpiled through
// this same config by Metro, which is why they need no build step of their own.
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
