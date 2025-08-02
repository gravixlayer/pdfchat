import type { NextRequest } from "next/server"
import { cookies } from "next/headers"

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

// Simple cosine similarity function with validation
function cosineSimilarity(a: number[], b: number[]): number {
  try {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
      return 0
    }

    const dotProduct = a.reduce((sum, val, i) => sum + (val * b[i] || 0), 0)
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + (val * val || 0), 0))
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + (val * val || 0), 0))

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0
    }

    return dotProduct / (magnitudeA * magnitudeB)
  } catch (error) {
    console.warn("Error calculating cosine similarity:", error)
    return 0
  }
}

// Generate embedding for query using raw fetch
async function generateQueryEmbedding(query: string): Promise<number[]> {
  try {
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      throw new Error("Invalid query for embedding generation")
    }

    if (!process.env.GRAVIXLAYER_API_KEY) {
      console.warn("GRAVIXLAYER_API_KEY not found, using dummy embedding")
      return generateSingleDummyEmbedding()
    }

    try {
      console.log("Generating query embedding with model: llama3.1:8b using raw fetch")

      console.log("[DEBUG] Fetching Gravixlayer embeddings API", {
        url: "https://api.gravixlayer.com/v1/inference/embeddings",
        apiKeyPresent: !!process.env.GRAVIXLAYER_API_KEY,
        input: query,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GRAVIXLAYER_API_KEY}`,
        },
      });
      const response = await fetch("https://api.gravixlayer.com/v1/inference/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GRAVIXLAYER_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama3.1:8b",
          input: query.trim(), // Single string, not array
          encoding_format: "float",
        }),
      })

      console.log("Query embedding response status:", response.status)

      if (!response.ok) {
        const errorText = await response.text()
        console.error("Query embedding API error:", response.status, errorText)
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()

      if (data.data && Array.isArray(data.data) && data.data.length > 0 && data.data[0].embedding) {
        console.log("Successfully generated query embedding")
        return data.data[0].embedding
      } else {
        console.warn("Invalid query embedding response, using dummy embedding")
        return generateSingleDummyEmbedding()
      }
    } catch (apiError) {
      console.error("Query embedding error:", apiError)
      console.warn("Falling back to dummy embedding")
      return generateSingleDummyEmbedding()
    }
  } catch (error) {
    console.warn("Query embedding error, using dummy embedding:", error)
    return generateSingleDummyEmbedding()
  }
}

// Generate a single dummy embedding safely
function generateSingleDummyEmbedding(): number[] {
  try {
    const embedding: number[] = []
    const dimension = 1536

    for (let i = 0; i < dimension; i++) {
      embedding.push(Math.random())
    }

    return embedding
  } catch (error) {
    console.error("Error generating single dummy embedding:", error)
    // Return minimal fallback
    const fallback: number[] = []
    for (let i = 0; i < 384; i++) {
      // Smaller dimension as fallback
      fallback.push(0.1)
    }
    return fallback
  }
}

// Retrieve relevant chunks with better validation
function retrieveRelevantChunks(queryEmbedding: number[], documents: Map<string, DocumentData>, topK = 3): string[] {
  try {
    if (!documents || documents.size === 0) {
      console.log("No documents available for retrieval")
      return []
    }

    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      console.warn("Invalid query embedding for retrieval")
      return []
    }

    const allChunks: { chunk: string; similarity: number }[] = []

    for (const doc of documents.values()) {
      if (!doc || !doc.chunks || !doc.embeddings) {
        console.warn("Document missing chunks or embeddings")
        continue
      }

      if (!Array.isArray(doc.chunks) || !Array.isArray(doc.embeddings)) {
        console.warn("Document chunks or embeddings are not arrays")
        continue
      }

      const minLength = Math.min(doc.chunks.length, doc.embeddings.length)

      for (let i = 0; i < minLength; i++) {
        const chunk = doc.chunks[i]
        const chunkEmbedding = doc.embeddings[i]

        if (typeof chunk === "string" && chunk.trim().length > 0 && Array.isArray(chunkEmbedding)) {
          const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding)
          if (similarity > 0) {
            allChunks.push({ chunk: chunk.trim(), similarity })
          }
        }
      }
    }

    console.log(`Found ${allChunks.length} chunks for similarity search`)

    if (allChunks.length === 0) {
      return []
    }

    // Sort by similarity and return top K
    return allChunks
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, Math.max(1, Math.min(topK, 10))) // Ensure reasonable bounds
      .map((item) => item.chunk)
  } catch (error) {
    console.error("Error retrieving relevant chunks:", error)
    return []
  }
}

export async function POST(req: NextRequest) {
  try {
    const { messages, model = "llama3.1:8b", temperature = 0.7, maxTokens = 1000, useRAG = false } = await req.json()

    // Validate API key
    if (!process.env.GRAVIXLAYER_API_KEY) {
      console.error("GRAVIXLAYER_API_KEY is not set")
      return new Response(JSON.stringify({ error: "API key not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Validate messages
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Messages array is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Get sessionId from cookie
    const sessionId = cookies().get("sessionId")?.value
    console.log("[DEBUG] Chat API sessionId:", sessionId)

    let processedMessages = messages

    // If RAG is enabled and we have documents, retrieve relevant context
    if (useRAG) {
      console.log("RAG enabled, checking for documents...")

      try {
        const documentStore = getDocumentStore()
        let sessionDocs: Map<string, any> | undefined = undefined
        if (sessionId && documentStore.has(sessionId)) {
          const possibleMap = documentStore.get(sessionId)
          if (possibleMap && typeof possibleMap === "object" && typeof (possibleMap as unknown as Map<string, any>).keys === "function") {
            sessionDocs = possibleMap as unknown as Map<string, any>
          } else {
            console.warn("[DEBUG] sessionDocs is not a Map, skipping RAG for this session.")
          }
        }
        console.log("[DEBUG] Document store for session:", sessionDocs ? Array.from(sessionDocs.keys()) : null)

        if (sessionDocs && sessionDocs.size > 0) {
          const lastUserMessage = messages.filter((m) => m.role === "user").pop()
          if (lastUserMessage && lastUserMessage.content) {
            console.log("Performing RAG retrieval for:", lastUserMessage.content.substring(0, 100) + "...")

            try {
              // Generate embedding for the query
              const queryEmbedding = await generateQueryEmbedding(lastUserMessage.content)

              // Retrieve relevant chunks
              const relevantChunks = retrieveRelevantChunks(queryEmbedding, sessionDocs)

              if (relevantChunks.length > 0) {
                console.log(`Found ${relevantChunks.length} relevant chunks`)
                // Add context to the system message
                const contextMessage = {
                  role: "system",
                  content: `Use the following context from uploaded documents to answer questions. If the answer is not in the context, say so clearly.

Context:
${relevantChunks.join("\n\n---\n\n")}`,
                }

                // Insert context message before the last user message
                processedMessages = [...messages.slice(0, -1), contextMessage, lastUserMessage]
              } else {
                console.log("No relevant chunks found")
              }
            } catch (ragError) {
              console.error("RAG processing error:", ragError)
              // Continue without RAG if there's an error
            }
          }
        } else {
          console.log("No documents available for RAG for session:", sessionId)
        }
      } catch (storeError) {
        console.error("Error accessing document store:", storeError)
        // Continue without RAG if there's an error
      }
    }

    console.log("Making request to Gravixlayer API:", {
      model,
      temperature,
      maxTokens,
      messageCount: processedMessages.length,
      useRAG,
    })

    // Make request to Gravixlayer API
    console.log("[DEBUG] Fetching Gravixlayer chat completions API", {
      url: "https://api.gravixlayer.com/v1/inference/chat/completions",
      apiKeyPresent: !!process.env.GRAVIXLAYER_API_KEY,
      model,
      temperature,
      maxTokens,
      messageCount: processedMessages.length,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GRAVIXLAYER_API_KEY}`,
      },
    });
    const response = await fetch("https://api.gravixlayer.com/v1/inference/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GRAVIXLAYER_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: processedMessages.map((msg: any) => ({
          role: msg.role,
          content: msg.content,
        })),
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("API Error:", response.status, errorText)
      return new Response(
        JSON.stringify({
          error: `API request failed: ${response.status}`,
          details: errorText,
        }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        },
      )
    }

    // Return the streaming response
    return new Response(response.body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    console.error("Chat API Error:", error)
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"

    return new Response(
      JSON.stringify({
        error: "Failed to process chat request",
        details: errorMessage,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    )
  }
}
