/** @type {import('next').NextConfig} */
const nextConfig = {
  // App Router тепер за замовчуванням в Next.js 13+
  typescript: {
    // Дозволяємо успішну збірку навіть з помилками типізації
    ignoreBuildErrors: true,
  },
  eslint: {
    // Дозволяємо успішну збірку навіть з помилками лінтера
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig
