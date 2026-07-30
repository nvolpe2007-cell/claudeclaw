/** @type {import('next').NextConfig} */
const nextConfig = {
  // Feed posts store their photo as a base64 data URL in the prototype's
  // JSON file, so allow larger request/response bodies for Server Actions
  // and route handlers.
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
