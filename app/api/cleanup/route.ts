import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs/promises"
import path from "path"

// Helper to clear uploads directory for a session
async function clearUploadsDirForSession(sessionId: string) {
  // Use environment variable for uploads directory on Render
  const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads")
  let deleted = 0
  try {
    // Ensure directory exists
    await fs.mkdir(uploadsDir, { recursive: true })
    console.debug(`[Cleanup] Checking directory: ${uploadsDir}`)

    const files = await fs.readdir(uploadsDir)
    for (const file of files) {
      if (file.startsWith(sessionId + "__")) {
        const filePath = path.join(uploadsDir, file)
        await fs.unlink(filePath)
        deleted++
        console.debug(`[Cleanup] Deleted file: ${file}`)
      }
    }
    return { deleted }
  } catch (err) {
    console.error("[Cleanup] Error clearing uploads:", err)
    return { deleted, error: err instanceof Error ? err.message : String(err) }
  }
}

// Helper to clear documentStore and sessionMeta for a session
function clearDocumentStoreForSession(sessionId: string) {
  let clearedCount = 0
  console.debug(`[Cleanup] Clearing document store for session: ${sessionId}`)
  
  const ds = (globalThis as any).documentStore
  if (ds && typeof ds.delete === "function" && typeof ds["has"] === "function") {
    if (ds["has"](sessionId)) {
      clearedCount = 1
      console.debug(`[Cleanup] Found and clearing session data`)
    }
    ds.delete(sessionId)
  }
  
  const sm = (globalThis as any).sessionMetaStore
  if (sm && typeof sm.delete === "function") {
    sm.delete(sessionId)
    console.debug(`[Cleanup] Cleared session metadata`)
  }
  
  return { cleared: clearedCount }
}

// Helper to clean up idle sessions (default: 1 hour)
async function cleanupIdleSessions(idleMs = 60 * 60 * 1000) {
  console.debug(`[Cleanup] Starting idle session cleanup, timeout: ${idleMs}ms`)
  
  const now = Date.now()
  const sessionMetaStore = ((globalThis as any).sessionMetaStore as Map<string, { lastActivity: number }>) || new Map()
  const documentStore = ((globalThis as any).documentStore as Map<string, Map<string, any>>) || new Map()
  const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads")
  
  let cleaned = 0
  for (const [sessionId, meta] of sessionMetaStore.entries()) {
    if (now - meta.lastActivity > idleMs) {
      console.debug(`[Cleanup] Found idle session: ${sessionId}, last activity: ${new Date(meta.lastActivity).toISOString()}`)
      
      // Delete uploaded files for this session
      try {
        const files = await fs.readdir(uploadsDir)
        for (const file of files) {
          if (file.startsWith(sessionId + "__")) {
            const filePath = path.join(uploadsDir, file)
            await fs.unlink(filePath)
            console.debug(`[Cleanup] Deleted idle session file: ${file}`)
          }
        }
      } catch (error) {
        console.error(`[Cleanup] Error cleaning files for idle session ${sessionId}:`, error)
      }
      
      // Delete vectors/session data
      documentStore.delete(sessionId)
      sessionMetaStore.delete(sessionId)
      cleaned++
      console.debug(`[Cleanup] Cleaned up idle session: ${sessionId}`)
    }
  }
  
  console.debug(`[Cleanup] Completed idle cleanup, sessions cleaned: ${cleaned}`)
  return cleaned
}

export async function POST() {
  console.debug('[Cleanup] Starting cleanup request')
  
  // Clean up idle sessions (default: 1 hour)
  const idleCleaned = await cleanupIdleSessions()
  
  // Get sessionId from cookie
  const sessionId = cookies().get("sessionId")?.value
  if (!sessionId) {
    console.debug('[Cleanup] No sessionId found in cookies')
    return NextResponse.json(
      { success: false, error: "No sessionId found in cookies.", idleCleaned }, 
      { status: 400 }
    )
  }
  
  console.debug(`[Cleanup] Processing cleanup for session: ${sessionId}`)
  
  // Delete uploaded files for this session
  const uploadsResult = await clearUploadsDirForSession(sessionId)
  
  // Clear in-memory vectors/session data for this session
  const docStoreResult = clearDocumentStoreForSession(sessionId)

  console.debug('[Cleanup] Cleanup completed', { uploadsResult, docStoreResult, idleCleaned })

  return NextResponse.json({
    success: true,
    uploads: uploadsResult,
    documentStore: docStoreResult,
    idleCleaned,
    message: `Uploads and document store cleared for session ${sessionId}. Idle sessions cleaned: ${idleCleaned}`
  })
}
