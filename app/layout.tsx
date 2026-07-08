import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Game Hub — Ігрова платформа',
  description: 'Ігрова платформа для компанії друзів. Мафія, Покер, Шпигун та інші ігри онлайн.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  )
}
