import { NextResponse } from "next/server"

// Simple in-memory cleanup scheduler
let cleanupInterval: NodeJS.Timeout | null = null

// Helper to run cleanup periodically
function startPeriodicCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
  }
  
  // Run cleanup every 30 minutes
  cleanupInterval = setInterval(async () => {
    try {
      console.log('[Scheduler] Running periodic cleanup...')
      const response = await fetch('http://localhost:3000/api/cleanup', {
        method: 'POST',
      })
      const result = await response.json()
      console.log('[Scheduler] Periodic cleanup completed:', result)
    } catch (error) {
      console.error('[Scheduler] Error during periodic cleanup:', error)
    }
  }, 30 * 60 * 1000) // 30 minutes
  
  console.log('[Scheduler] Periodic cleanup started (every 30 minutes)')
}

export async function POST() {
  startPeriodicCleanup()
  return NextResponse.json({ 
    success: true, 
    message: "Periodic cleanup scheduler started (every 30 minutes)" 
  })
}

export async function GET() {
  return NextResponse.json({ 
    active: cleanupInterval !== null,
    message: "Cleanup scheduler status" 
  })
}
