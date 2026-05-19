import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST() {
  try {
    // Delete rooms that have been empty for more than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

    // First, get rooms that might need cleanup
    const { data: roomsToCheck, error: fetchError } = await supabase
      .from('rooms')
      .select('id, updated_at, players!inner(id)')
      .eq('status', 'waiting')
      .lt('updated_at', fiveMinutesAgo)

    if (fetchError) {
      console.error('Error fetching rooms for cleanup:', fetchError)
      return Response.json({ error: 'Failed to fetch rooms' }, { status: 500 })
    }

    // Filter rooms that have no players
    const emptyRooms = roomsToCheck?.filter(room => room.players.length === 0) || []

    if (emptyRooms.length > 0) {
      const roomIds = emptyRooms.map(room => room.id)
      
      const { error: deleteError } = await supabase
        .from('rooms')
        .delete()
        .in('id', roomIds)

      if (deleteError) {
        console.error('Error deleting empty rooms:', deleteError)
        return Response.json({ error: 'Failed to delete rooms' }, { status: 500 })
      }

      console.log(`Deleted ${emptyRooms.length} empty rooms:`, roomIds)
    }

    return Response.json({ 
      message: 'Cleanup completed',
      deletedRooms: emptyRooms.length 
    })

  } catch (error) {
    console.error('Cleanup error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
