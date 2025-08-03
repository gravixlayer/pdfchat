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
  var documentStore: Map<string, Map<string, DocumentData>> | undefined
}

// Initialize document storage
function getDocumentStore(): Map<string, Map<string, DocumentData>> {
  if (!globalThis.documentStore) {
    globalThis.documentStore = new Map<string, Map<string, DocumentData>>()
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

// Retrieve relevant chunks with context (previous and next chunks)
function retrieveRelevantChunks(queryEmbedding: number[], sessionDocuments: Map<string, DocumentData>, topK = 3): string[] {
  try {
    if (!sessionDocuments || sessionDocuments.size === 0) {
      console.log("No documents available for retrieval")
      return []
    }

    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      console.warn("Invalid query embedding for retrieval")
      return []
    }

    const allChunks: { chunk: string; similarity: number; chunkIndex: number; docChunks: string[] }[] = []

    for (const doc of sessionDocuments.values()) {
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
            allChunks.push({ 
              chunk: chunk.trim(), 
              similarity, 
              chunkIndex: i,
              docChunks: doc.chunks
            })
          }
        }
      }
    }

    console.log(`Found ${allChunks.length} chunks for similarity search`)

    if (allChunks.length === 0) {
      return []
    }

    // Sort by similarity and get top matches
    const topMatches = allChunks
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, Math.max(1, Math.min(topK, 5))) // Limit to prevent too much context

    // Build chunks with context (previous and next chunks)
    const contextualChunks: string[] = []
    
    for (const match of topMatches) {
      const { chunkIndex, docChunks } = match
      const contextChunks: string[] = []

      // Add previous chunk if available
      if (chunkIndex > 0 && docChunks[chunkIndex - 1]) {
        contextChunks.push(`[Previous Context]: ${docChunks[chunkIndex - 1].trim()}`)
      }

      // Add the main matching chunk
      contextChunks.push(`[Main Content]: ${match.chunk}`)

      // Add next chunk if available
      if (chunkIndex < docChunks.length - 1 && docChunks[chunkIndex + 1]) {
        contextChunks.push(`[Following Context]: ${docChunks[chunkIndex + 1].trim()}`)
      }

      contextualChunks.push(contextChunks.join('\n\n'))
    }

    console.log(`Returning ${contextualChunks.length} contextual chunks with surrounding context`)
    return contextualChunks
  } catch (error) {
    console.error("Error retrieving relevant chunks:", error)
    return []
  }
}

export async function POST(req: NextRequest) {
  try {
    const { messages, model = "llama3.1:8b", temperature = 0.7, maxTokens = 1000, useRAG = false, sessionId: bodySessionId } = await req.json()

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

    // Get sessionId from cookie or request body
    const allCookies = cookies().getAll()
    console.log("[DEBUG] All cookies:", allCookies.map(c => `${c.name}=${c.value}`))
    const cookieSessionId = cookies().get("sessionId")?.value
    const sessionId = cookieSessionId || bodySessionId
    console.log("[DEBUG] Chat API sessionId from cookie:", cookieSessionId)
    console.log("[DEBUG] Chat API sessionId from body:", bodySessionId)
    console.log("[DEBUG] Final sessionId:", sessionId)

    let processedMessages = messages

    // If RAG is enabled and we have documents, retrieve relevant context
    if (useRAG) {
      console.log("RAG enabled, checking for documents...")
      
      try {
        const documentStore = getDocumentStore()
        console.log("[DEBUG] Document store size:", documentStore.size)
        console.log("[DEBUG] Session documents for", sessionId, ":", sessionId && documentStore.has(sessionId) ? documentStore.get(sessionId)?.size || 0 : 0)
        console.log("[DEBUG] All session keys:", Array.from(documentStore.keys()))
        
        let sessionDocs: Map<string, DocumentData> | undefined = undefined
        
        // Try to get documents for the current session first
        if (sessionId && documentStore.has(sessionId)) {
          sessionDocs = documentStore.get(sessionId)
          console.log(`Found ${sessionDocs?.size || 0} documents in current session ${sessionId}`)
        }
        
        // If no documents found for current session OR no sessionId, consolidate from all sessions
        if ((!sessionDocs || sessionDocs.size === 0) && documentStore.size > 0) {
          console.log("No documents found for current session, consolidating from all sessions...")
          sessionDocs = new Map<string, DocumentData>()
          
          // Combine all documents from all sessions
          for (const [storedSessionId, storedDocs] of documentStore.entries()) {
            if (storedDocs && storedDocs.size > 0) {
              console.log(`Consolidating ${storedDocs.size} documents from session ${storedSessionId}`)
              // Copy all documents to our working session
              for (const [docId, docData] of storedDocs.entries()) {
                sessionDocs.set(docId, docData)
              }
            }
          }
          
          // Store consolidated documents in current session (if we have a sessionId)
          if (sessionId && sessionDocs.size > 0) {
            documentStore.set(sessionId, sessionDocs)
            console.log(`Consolidated ${sessionDocs.size} documents into session ${sessionId}`)
          }
        }
        
        console.log("[DEBUG] Document store size:", documentStore.size)
        console.log("[DEBUG] Session documents for", sessionId, ":", sessionDocs ? sessionDocs.size : 0)
        console.log("[DEBUG] All session keys:", Array.from(documentStore.keys()).slice(0, 5))

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

    console.log("Response ok, setting up stream...")
    console.log("Response headers:", Object.fromEntries(response.headers.entries()))

    // Create a streaming response with proper flushing
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader()
        if (!reader) {
          controller.close()
          return
        }

        try {
          let buffer = ""
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value, { stream: true })
            buffer += chunk

            // Process complete lines
            const lines = buffer.split('\n')
            buffer = lines.pop() || ""

            for (const line of lines) {
              if (line.trim()) {
                // Forward each line immediately
                console.log("Streaming chunk:", line.substring(0, 50) + "...")
                controller.enqueue(encoder.encode(line + '\n'))
              }
            }
          }

          // Send remaining buffer
          if (buffer.trim()) {
            console.log("Final chunk:", buffer.substring(0, 50) + "...")
            controller.enqueue(encoder.encode(buffer + '\n'))
          }
        } catch (error) {
          console.error("Stream error:", error)
          controller.error(error)
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no", // Disable nginx buffering
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS", 
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
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
