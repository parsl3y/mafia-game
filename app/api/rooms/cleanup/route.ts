import { NextResponse } from 'next/server'

// Цей ендпоінт більше не потрібен — логіка перенесена в Redis з TTL
export async function POST() {
  return NextResponse.json({ message: 'Not needed with Redis architecture' })
}
