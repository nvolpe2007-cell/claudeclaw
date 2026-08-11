/** @type {import('next').NextConfig} */
const nextConfig = {
  // Reel posts store their video as a base64 data URL in the prototype's
  // JSON file, so allow larger request bodies.
  experimental: {
    serverActions: {
      bodySizeLimit: "40mb",
    },
  },
};

export default nextConfig;
