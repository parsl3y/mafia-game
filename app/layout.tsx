import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Мафія — Онлайн гра',
  description: 'Грайте в Мафію онлайн в реальному часі. Ролі: Мафія, Шериф, Лікар, Повія, Громадянин.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  )
}
