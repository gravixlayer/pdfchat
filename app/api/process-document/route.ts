import { type NextRequest, NextResponse } from "next/server"
import { readFile } from "fs/promises"
import { pdfToText } from "pdf-ts"

// Ensure this runs in Node.js runtime, not Edge
export const runtime = "nodejs"

// Document storage interface
interface DocumentData {
  fileId: string
  filename: string
  chunks: string[]
  embeddings: number[][]
  createdAt: string
}

// Global document storage using globalThis
declare global {
  var documentStore: Map<string, DocumentData> | undefined
}

// Initialize document storage
function getDocumentStore(): Map<string, DocumentData> {
  if (!globalThis.documentStore) {
    globalThis.documentStore = new Map<string, DocumentData>()
  }
  return globalThis.documentStore
}

// Simple text chunking function with limits and validation
function chunkText(text: string, chunkSize = 1000, overlap = 200, maxChunks = 50): string[] {
  const chunks: string[] = []

  // Validate input text
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    console.warn("Invalid text provided to chunkText")
    return chunks
  }

  const cleanText = text.trim()
  let start = 0

  while (start < cleanText.length && chunks.length < maxChunks) {
    const end = Math.min(start + chunkSize, cleanText.length)
    const chunk = cleanText.slice(start, end)
    const trimmedChunk = chunk.trim()

    if (trimmedChunk.length > 0) {
      chunks.push(trimmedChunk)
    }

    start = end - overlap
  }

  return chunks
}

// Validate and clean text chunks for embedding
function validateAndCleanChunks(chunks: string[]): string[] {
  if (!Array.isArray(chunks)) {
    console.warn("Invalid chunks array provided")
    return []
  }

  const validChunks = chunks
    .filter((chunk) => typeof chunk === "string" && chunk.trim().length >= 3)
    .map((chunk) => chunk.trim())
    .filter((chunk, index, array) => array.indexOf(chunk) === index)

  console.log(`Validated ${validChunks.length} chunks from ${chunks.length} original chunks`)
  return validChunks
}

// Generate dummy embedding
function generateSingleDummyEmbedding(): number[] {
  const embedding: number[] = []
  for (let i = 0; i < 1536; i++) {
    embedding.push(Math.random())
  }
  return embedding
}

// Generate dummy embeddings
function generateDummyEmbeddings(count: number): number[][] {
  const embeddings: number[][] = []
  const validCount = Math.max(1, Math.min(count, 100))

  for (let i = 0; i < validCount; i++) {
    embeddings.push(generateSingleDummyEmbedding())
  }

  return embeddings
}

// Generate embeddings using external API or fallback to dummy
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  try {
    console.log("Generating embeddings for", texts.length, "chunks")

    const validTexts = validateAndCleanChunks(texts)
    if (validTexts.length === 0) {
      return generateDummyEmbeddings(1)
    }

    const limitedTexts = validTexts.slice(0, 50)

    if (!process.env.GRAVIXLAYER_API_KEY) {
      console.warn("GRAVIXLAYER_API_KEY not found, using dummy embeddings")
      return generateDummyEmbeddings(limitedTexts.length)
    }

    const batchSize = 3
    const allEmbeddings: number[][] = []

    for (let i = 0; i < limitedTexts.length; i += batchSize) {
      const batch = limitedTexts.slice(i, i + batchSize)
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(limitedTexts.length / batchSize)}`)

      for (const text of batch) {
        try {
          const response = await fetch("https://api.gravixlayer.com/v1/inference/embeddings", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.GRAVIXLAYER_API_KEY}`,
            },
            body: JSON.stringify({
              model: "llama3.1:8b",
              input: text,
              encoding_format: "float",
            }),
          })

          if (!response.ok) {
            console.warn(`Text embedding failed with status ${response.status}`)
            allEmbeddings.push(generateSingleDummyEmbedding())
            continue
          }

          const data = await response.json()
          if (data.data?.[0]?.embedding) {
            allEmbeddings.push(data.data[0].embedding)
          } else {
            console.warn("Text embedding returned invalid data")
            allEmbeddings.push(generateSingleDummyEmbedding())
          }

          await new Promise((resolve) => setTimeout(resolve, 100))
        } catch (itemError) {
          console.warn("Text embedding error:", itemError)
          allEmbeddings.push(generateSingleDummyEmbedding())
        }
      }

      if (i + batchSize < limitedTexts.length) {
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }

    console.log("Successfully processed", allEmbeddings.length, "embeddings")
    return allEmbeddings
  } catch (error) {
    console.warn("Embedding generation error, using dummy embeddings:", error)
    return generateDummyEmbeddings(texts.length || 1)
  }
}

// PDF text extraction using pdf-ts
async function extractTextFromPDF(filepath: string): Promise<string> {
  console.log("Starting PDF text extraction with pdf-ts...")
  const startTime = Date.now()
  try {
    const buffer = await readFile(filepath)
    const extractedText = await pdfToText(buffer)
    const extractionTime = Date.now() - startTime
    console.log(`PDF extraction completed in ${extractionTime}ms`)
    if (!extractedText || extractedText.trim().length < 10) {
      throw new Error("No text content found in PDF or extracted text is too short to be meaningful")
    }
    return extractedText.trim()
  } catch (error) {
    const extractionTime = Date.now() - startTime
    console.error(`pdf-ts extraction failed after ${extractionTime}ms:`, error)
    throw new Error("Failed to extract text from PDF using pdf-ts")
  }
}

// Main API handler for processing documents
export async function POST(request: NextRequest) {
  const processingStart = Date.now()
  try {
    const { fileId, filename, filepath, fileType } = await request.json()
    if (!fileId || !filename || !filepath || !fileType) {
      return NextResponse.json({ error: "Missing file metadata" }, { status: 400 })
    }

    let text = ""
    let warning: string | undefined = undefined

    if (fileType === "application/pdf") {
      try {
        text = await extractTextFromPDF(filepath)
      } catch (err: any) {
        warning = err?.message || "PDF extraction failed"
        text = ""
      }
    } else {
      return NextResponse.json({ error: "Only PDF files are supported for now." }, { status: 400 })
    }

    if (!text || text.trim().length < 10) {
      return NextResponse.json({ error: warning || "No text extracted from document." }, { status: 400 })
    }

    const chunks = chunkText(text)
    if (!chunks.length) {
      return NextResponse.json({ error: "No valid text chunks found in document." }, { status: 400 })
    }

    let embeddings: number[][] = []
    try {
      embeddings = await generateEmbeddings(chunks)
    } catch (embeddingError: any) {
      return NextResponse.json({ error: "Failed to generate embeddings", details: embeddingError?.message }, { status: 500 })
    }

    const documentData: DocumentData = {
      fileId,
      filename,
      chunks,
      embeddings,
      createdAt: new Date().toISOString(),
    }

    try {
      const documentStore = getDocumentStore()
      documentStore.set(fileId, documentData)
    } catch (storageError: any) {
      return NextResponse.json({ error: "Failed to store document", details: storageError?.message }, { status: 500 })
    }

    const totalProcessingTime = Date.now() - processingStart

    return NextResponse.json({
      fileId,
      filename,
      size: undefined,
      type: fileType,
      chunks: chunks.length,
      warning,
      processingTime: totalProcessingTime,
      message: "Document processed successfully", // Raw markdown returned as-is
    })
  } catch (error: any) {
    return NextResponse.json({
      error: "Failed to process document",
      details: error?.message,
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
}
