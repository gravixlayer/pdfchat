import { type NextRequest, NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { v4 as uuidv4 } from "uuid"

// Ensure this runs in Node.js runtime, not Edge
export const runtime = "nodejs"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 })
    }

    console.log("Processing upload:", {
      name: file.name,
      size: file.size,
      type: file.type,
    })

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File size exceeds 10MB limit" }, { status: 400 })
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          error: "Only PDF and DOC files are allowed",
          receivedType: file.type,
        },
        { status: 400 },
      )
    }

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(process.cwd(), "uploads")
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true })
      console.log("Created uploads directory:", uploadsDir)
    }

    // Generate unique filename
    const fileId = uuidv4()
    const extension = path.extname(file.name)
    const filename = `${fileId}${extension}`
    const filepath = path.join(uploadsDir, filename)

    console.log("Saving file to:", filepath)

    // Save file
    try {
      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)
      await writeFile(filepath, buffer)
      console.log("File saved successfully")
    } catch (saveError) {
      console.error("File save error:", saveError)
      return NextResponse.json(
        {
          error: "Failed to save file",
          details: saveError instanceof Error ? saveError.message : "Unknown save error",
        },
        { status: 500 },
      )
    }

    // Process the document
    console.log("Starting document processing...")
    let processResult
    try {
      const processResponse = await fetch(`${request.nextUrl.origin}/api/process-document`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileId,
          filename: file.name,
          filepath,
          fileType: file.type,
        }),
      })

      console.log("Process response status:", processResponse.status)

      // Check if response is JSON
      const contentType = processResponse.headers.get("content-type")
      console.log("Process response content-type:", contentType)

      if (!contentType || !contentType.includes("application/json")) {
        // Response is not JSON, likely an error page
        const errorText = await processResponse.text()
        console.error("Non-JSON response from process-document:", errorText.substring(0, 500))
        throw new Error("Document processing service returned an invalid response")
      }

      if (!processResponse.ok) {
        const errorData = await processResponse.json()
        console.error("Document processing failed:", errorData)
        throw new Error(errorData.error || `Processing failed with status ${processResponse.status}`)
      }

      processResult = await processResponse.json()
      console.log("Document processing completed:", processResult)
    } catch (processError) {
      console.error("Document processing error:", processError)

      // Return success with a warning instead of failing completely
      return NextResponse.json({
        success: true,
        fileId,
        filename: file.name,
        size: file.size,
        type: file.type,
        chunks: 0,
        warning: "File uploaded but processing failed. RAG functionality may not work for this file.",
        processingError: processError instanceof Error ? processError.message : "Unknown processing error",
      })
    }

    return NextResponse.json({
      success: true,
      fileId,
      filename: file.name,
      size: file.size,
      type: file.type,
      chunks: processResult.chunks || 0,
    })
  } catch (error) {
    console.error("Upload error:", error)
    return NextResponse.json(
      {
        error: "Failed to upload file",
        details: error instanceof Error ? error.message : "Unknown upload error",
      },
      { status: 500 },
    )
  }
}
