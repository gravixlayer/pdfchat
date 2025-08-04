
"use client";

import React, { useState, useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import { toast } from "@/hooks/use-toast";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

export default function Page() {
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState("llama3.1:8b");
  const [capsuleWidth, setCapsuleWidth] = useState(80);
  const [messages, setMessages] = useState<Message[]>([]);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [processedDocs, setProcessedDocs] = useState<{[fileId: string]: {name: string, size: string, status: 'processing' | 'ready'}} | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);
  // Streaming state
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState<{[key: string]: string}>({});
  
  // Initialize sessionId from cookie on page load
  useEffect(() => {
    const getSessionIdFromCookie = () => {
      if (typeof document !== 'undefined') {
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
          const [name, value] = cookie.trim().split('=');
          if (name === 'sessionId') {
            return decodeURIComponent(value);
          }
        }
      }
      return null;
    };
    
    const cookieSessionId = getSessionIdFromCookie();
    if (cookieSessionId && !sessionId) {
      console.log("Initializing sessionId from cookie:", cookieSessionId);
      setSessionId(cookieSessionId);
    }
  }, []);

  // Cleanup function
  const performCleanup = async () => {
    try {
      console.log("Performing cleanup...");
      await fetch('/api/cleanup', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch (error) {
      console.warn("Cleanup failed:", error);
    }
  };

  // Add cleanup on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable cleanup on page unload
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/cleanup', new FormData());
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Page is being hidden/closed, trigger cleanup
        performCleanup();
      }
    };

    // Add event listeners
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup on component unmount
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
  
  // Set cookie when sessionId changes
  useEffect(() => {
    if (sessionId && typeof document !== 'undefined') {
      document.cookie = `sessionId=${encodeURIComponent(sessionId)}; path=/; max-age=86400; samesite=strict`;
      console.log("Setting sessionId cookie:", sessionId);
    }
  }, [sessionId]);
  // File upload handler
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    
    setUploading(true);
    setFile(f);
    
    // Create new AbortController for this upload
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    
    // Generate unique file ID for this upload (temporary client-side ID)
    const tempFileId = Date.now().toString() + "-temp-" + Math.random().toString(36).substr(2, 9);
    
    // Set initial processing state for this document
    const fileSize = (f.size / 1024 / 1024).toFixed(1) + ' MB';
    setProcessedDocs(prev => ({
      ...prev,
      [tempFileId]: {
        name: f.name,
        size: fileSize,
        status: 'processing'
      }
    }));
    
    try {
      // Process the document
      const formData = new FormData();
      formData.append('file', f);
      
      console.log("Frontend: Uploading with sessionId:", sessionId);
      
      const response = await fetch('/api/upload', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData,
        signal: controller.signal, // Add abort signal
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log("Frontend: Upload response:", result);
        
        // Store sessionId for future requests - ALWAYS update sessionId from server response
        if (result.sessionId) {
          console.log("Frontend: Updating sessionId from", sessionId, "to", result.sessionId);
          setSessionId(result.sessionId);
        }
        // Document processed successfully - replace temp ID with server ID
        setProcessedDocs(prev => {
          if (!prev) return null;
          const newDocs = { ...prev };
          // Remove the temporary entry
          delete newDocs[tempFileId];
          // Add the final entry with server fileId
          newDocs[result.fileId] = {
            name: f.name,
            size: fileSize,
            status: 'ready'
          };
          return newDocs;
        });
        toast({
          title: "Document Processed",
          description: `${f.name} is ready for questions.`,
        });
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to process document');
      }
    } catch (error) {
      // Check if the error is due to abort
      if (error instanceof Error && error.name === 'AbortError') {
        toast({
          title: "Upload Cancelled",
          description: "Document processing was cancelled.",
        });
      } else {
        toast({
          title: "Upload Error",
          description: error instanceof Error ? error.message : "Failed to process the document. Please try again.",
          variant: "destructive",
        });
      }
      // Remove failed document from state (use temp ID)
      setProcessedDocs(prev => {
        if (!prev) return null;
        const newDocs = { ...prev };
        delete newDocs[tempFileId];
        return Object.keys(newDocs).length > 0 ? newDocs : null;
      });
    } finally {
      setUploading(false);
      uploadControllerRef.current = null;
    }
  }

  // Handle document removal/cancellation
  function handleRemoveDocument(fileId: string) {
    const docToRemove = processedDocs?.[fileId];
    if (!docToRemove) return;
    
    const isProcessing = docToRemove.status === 'processing';
    
    if (isProcessing) {
      // Cancel the ongoing upload/processing
      if (uploadControllerRef.current) {
        uploadControllerRef.current.abort();
        uploadControllerRef.current = null;
      }
      
      // Reset upload state
      setUploading(false);
      setFile(null);
      
      toast({
        title: "Processing Cancelled",
        description: "Document processing has been cancelled.",
      });
    } else {
      // Document is already processed, do cleanup
      toast({
        title: "Document Removed",
        description: "Document has been removed.",
      });
    }
    
    // Remove document from state
    setProcessedDocs(prev => {
      if (!prev) return null;
      const newDocs = { ...prev };
      delete newDocs[fileId];
      return Object.keys(newDocs).length > 0 ? newDocs : null;
    });
    
    // If no documents left, clear session
    const remainingDocs = processedDocs ? Object.keys(processedDocs).filter(id => id !== fileId) : [];
    if (remainingDocs.length === 0) {
      setSessionId(null);
    }
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  // Simple streaming - just update content directly
  function updateStreamingContent(id: string, content: string) {
    setStreamingContent(prev => ({
      ...prev,
      [id]: content
    }));
  }

  // Auto-scroll to bottom as streaming response updates
  useEffect(() => {
    if (streamingId && chatEndRef.current) {
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 0);
    }
  }, [streamingContent, streamingId]);

  // Also scroll on messages update (handles edge cases)
  useEffect(() => {
    if (chatEndRef.current) {
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 0);
    }
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  // Handle key press for input field
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  }

  // Chat submit handler
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    const allowedModels = [
      "llama3.1:8b",
      "qwen3:4b",
      "gemma3:12b",
      "qwen2.5vl:7b",
    ];
    if (!allowedModels.includes(selectedModel)) {
      toast({
        title: "Invalid Model",
        description: "Please select a valid model.",
        variant: "destructive",
      });
      return;
    }
    const userMsg: Message = { id: Date.now().toString(), role: "user", content: input };
    setMessages((msgs) => [...msgs, userMsg]);
    setInput("");
    setTimeout(() => {
      if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }, 50);

    try {
      // Always check if we have processed documents AND a valid sessionId
      const hasProcessedDocs = processedDocs && Object.values(processedDocs).some(doc => doc.status === 'ready');
      const shouldUseRAG = hasProcessedDocs && sessionId; // Only use RAG if we have both docs and sessionId
      
      console.log("Frontend: Chat request details:", {
        sessionId,
        hasProcessedDocs,
        shouldUseRAG,
        processedDocsCount: processedDocs ? Object.keys(processedDocs).length : 0
      });
      
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin", // Use same-origin for same-domain requests
        body: JSON.stringify({
          messages: [...messages, userMsg],
          model: selectedModel,
          useRAG: shouldUseRAG,
          sessionId: sessionId, // Include sessionId explicitly
        }),
      });
      if (!res.ok || !res.body) throw new Error("API error");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      
      // Create assistant message with a fixed ID that won't change
      const assistantMsgId = Date.now().toString() + "-assistant";
      let assistantMsg: Message = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
      };
      setMessages((msgs) => [...msgs, assistantMsg]);
      
      // Initialize streaming for this specific message ID
      setStreamingId(assistantMsgId);
      setStreamingContent(prev => ({
        ...prev,
        [assistantMsgId]: ""
      }));
      
      let fullReply = "";
      let buffer = "";
      
      // Process streaming response with immediate chunk handling
      while (!done) {
        const { value, done: doneReading } = await reader.read();
        if (value) {
          const chunk = decoder.decode(value, { stream: !doneReading });
          buffer += chunk;
          
          // Split by newlines to get complete lines
          const lines = buffer.split('\n');
          buffer = lines.pop() || ""; // Keep the last incomplete line in buffer
          
          for (const line of lines) {
            const trimmed = line.trim();
            
            if (!trimmed) continue;
            
            console.log("Frontend received line:", trimmed.substring(0, 100) + "...");
            
            // Process SSE format: data: {...}
            if (trimmed.startsWith("data:")) {
              const jsonStr = trimmed.replace(/^data:\s*/, "").trim();
              
              if (!jsonStr || jsonStr === "[DONE]") {
                console.log("Stream completed from backend");
                done = true;
                break;
              }
              
              try {
                const parsed = JSON.parse(jsonStr);
                const delta = parsed.choices?.[0]?.delta;
                
                if (delta && typeof delta.content === "string") {
                  console.log("Streaming content:", JSON.stringify(delta.content));
                  fullReply += delta.content;
                  
                  // Update streaming content directly
                  updateStreamingContent(assistantMsgId, fullReply);
                  
                  // Remove the old comment about streamBuffer
                  console.log("Current fullReply length:", fullReply.length, "Streaming content updated");
                }
              } catch (parseError) {
                console.log("JSON parse error for line:", trimmed.substring(0, 100));
                console.error("Parse error:", parseError);
              }
            }
          }
        }
        done = doneReading;
      }
      
      // Update final message content after streaming is complete
      setMessages((msgs) =>
        msgs.map((msg) =>
          msg.id === assistantMsgId ? { ...msg, content: fullReply } : msg
        )
      );
      
      // Clear streaming state
      setStreamingId(null);
      setStreamingContent(prev => {
        const newContent = { ...prev };
        delete newContent[assistantMsgId];
        return newContent;
      });
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to get response from the model.",
        variant: "destructive",
      });
    }
  }

  // Copy message to clipboard
  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied",
        description: "Message copied to clipboard.",
      });
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy message to clipboard.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="h-screen bg-black font-sans flex flex-col overflow-hidden">
      {/* Navigation Bar */}
      <nav className="w-full bg-black border-b border-[#2a2a2a] px-6 py-3 flex-shrink-0">
        <div className="flex items-center justify-between w-full">
          {/* Left: Gravix Layer */}
          <div className="text-white text-base font-medium tracking-wide flex-1">
            Gravix Layer
          </div>
          
          {/* Center: PDFCHAT */}
          <div className="text-white text-base font-bold tracking-tight bg-gradient-to-r from-white to-[#ccc] bg-clip-text">
            PDFCHAT
          </div>
          
          {/* Right: Social Media Links */}
          <div className="flex items-center gap-4 flex-1 justify-end">
            <a
              href="https://github.com/gravixlayer"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#888] hover:text-white transition-colors p-1"
              aria-label="GitHub"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </a>
            <a
              href="https://x.com/GravixLayer"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#888] hover:text-white transition-colors p-1"
              aria-label="X (Twitter)"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            </a>
            <a
              href="https://www.linkedin.com/company/gravixlayer/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#888] hover:text-white transition-colors p-1"
              aria-label="LinkedIn"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
            </a>
          </div>
        </div>
      </nav>
      
      {/* Main Content Area - Only this scrolls */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 overflow-hidden">
        {/* Chat Container */}
        <div className="w-full max-w-3xl flex flex-col h-full overflow-hidden">
          <ScrollArea className="flex-1 w-full px-2">
            <div className="flex flex-col gap-6 py-4">
              {messages.length === 0 ? (
                /* Welcome Message */
                <div className="flex flex-col items-center justify-center h-full text-center pt-64">
                  <div className="space-y-12 max-w-2xl mx-auto">
                    {/* Main Content */}
                    <div className="space-y-6">
                      <div className="space-y-4">
                        <h1 className="text-4xl font-extralight text-white tracking-wide leading-tight">
                          Hello there!
                        </h1>
                        <div className="w-16 h-px bg-gradient-to-r from-transparent via-[#666] to-transparent mx-auto"></div>
                      </div>
                      
                      <div className="space-y-3">
                        <p className="text-[#aaa] text-lg font-light leading-relaxed">
                          Upload a document and start asking questions
                        </p>
                        <p className="text-[#777] text-sm font-light tracking-wide">
                          Built using Gravix Layer API
                        </p>
                      </div>
                    </div>
                    
                    {/* Action Buttons */}
                    <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                      <a
                        href="https://github.com/gravixlayer/pdfchat"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-center justify-center gap-3 px-8 py-3 bg-[#1a1a1a]/80 hover:bg-[#2a2a2a]/90 border border-[#333]/60 hover:border-[#444]/80 rounded-2xl text-white text-sm font-medium transition-all duration-300 w-[200px] backdrop-blur-sm hover:shadow-lg hover:shadow-[#000]/20"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          className="transition-transform duration-300 group-hover:scale-110"
                        >
                          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                        </svg>
                        <span className="tracking-wide">View Source</span>
                      </a>
                      <a
                        href="https://platform.gravixlayer.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-center justify-center gap-3 px-8 py-3 bg-[#1a1a1a]/80 hover:bg-[#2a2a2a]/90 border border-[#333]/60 hover:border-[#444]/80 rounded-2xl text-white text-sm font-medium transition-all duration-300 w-[200px] backdrop-blur-sm hover:shadow-lg hover:shadow-[#000]/20"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="transition-transform duration-300 group-hover:scale-110"
                        >
                          <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 919-9"/>
                        </svg>
                        <span className="tracking-wide">Platform</span>
                      </a>
                    </div>
                  </div>
                </div>
              ) : (
                /* Chat Messages */
                messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`rounded-2xl px-5 py-3 max-w-[75%] text-sm leading-relaxed whitespace-pre-line ${msg.role === 'user' ? 'bg-[#2a2a2a] text-white shadow-sm' : 'bg-[#1a1a1a] text-[#e0e0e0] border border-[#333]'}`}>
                      {msg.role === 'assistant' ? (
                        <div>
                          <div className="prose prose-invert prose-sm max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0">
                            <ReactMarkdown>
                              {streamingId === msg.id ? (streamingContent[msg.id] || "") : msg.content}
                            </ReactMarkdown>
                            {streamingId === msg.id && streamingContent[msg.id] && (
                              <span className="inline-block w-2 h-4 bg-green-500 ml-1 animate-pulse"></span>
                            )}
                          </div>
                          {/* Copy button at bottom */}
                          {streamingId !== msg.id && msg.content && (
                            <div className="flex justify-end mt-3 pt-3 border-t border-[#333]">
                              <button
                                onClick={() => copyToClipboard(msg.content)}
                                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-[#aaa] hover:text-white hover:bg-[#2a2a2a] transition-colors"
                                title="Copy message"
                              >
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                                </svg>
                                Copy
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        streamingId === msg.id ? (streamingContent[msg.id] || "") : msg.content
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
          </ScrollArea>
        </div>
      </div>
      {/* Fixed Input Bar */}
      <div className="w-full bg-black px-4 py-4 flex-shrink-0">
        <form
          className="w-full max-w-3xl mx-auto"
          autoComplete="off"
          onSubmit={handleSubmit}
        >
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl px-4 py-3 shadow-lg">
            {/* Document Preview Box */}
            {processedDocs && Object.entries(processedDocs).map(([fileId, doc]) => (
              <div key={fileId} className="mb-3 bg-[#0f0f0f] border border-[#333] rounded-lg px-3 py-2.5 max-w-[240px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex items-center justify-center w-7 h-7 bg-[#1a1a1a] rounded-md flex-shrink-0">
                      {doc.status === 'processing' ? (
                        <div className="w-2.5 h-2.5 border border-[#666] border-t-white rounded-full animate-spin"></div>
                      ) : (
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#4ade80"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M9 12l2 2 4-4" />
                          <path d="M21 12c-1 0-3-1-3-3s2-3 3-3 3 1 3 3-2 3-3 3" />
                          <path d="M3 12c1 0 3-1 3-3s-2-3-3-3-3 1-3 3 2 3 3 3" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-white text-xs font-medium truncate leading-tight">
                        {doc.name}
                      </p>
                      <p className="text-[#888] text-[10px] mt-0.5">
                        {doc.size} • {doc.status === 'processing' ? 'Processing...' : 'Ready'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveDocument(fileId)}
                    className="flex items-center justify-center w-4 h-4 rounded-full hover:bg-[#333] transition-colors flex-shrink-0 ml-2"
                    aria-label="Remove document"
                  >
                    <svg
                      width="8"
                      height="8"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#888"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
            
            {/* Input Field */}
            <textarea
              ref={inputRef}
              className="w-full bg-transparent border-none outline-none text-white placeholder-[#888] text-base font-normal resize-none mb-3 min-h-[24px] max-h-[120px] overflow-y-auto"
              placeholder="Ask me anything..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{ caretColor: '#fff' }}
              autoFocus
              rows={1}
            />
            
            {/* Controls Row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Model Selector */}
                <div
                  className="rounded-full bg-[#0f0f0f] border border-[#333] py-1.5 px-3 flex items-center text-[#aaa] text-xs font-normal transition-all duration-200 hover:bg-[#1a1a1a] hover:text-[#ccc] cursor-pointer relative"
                  style={{ minWidth: 0, width: 'auto', maxWidth: 200 }}
                  onClick={() => {
                    const select = document.querySelector('select');
                    if (select) {
                      select.focus();
                      select.click();
                    }
                  }}
                >
                  <select
                    className="bg-transparent text-white font-normal outline-none border-none appearance-none cursor-pointer absolute inset-0 w-full h-full opacity-0"
                    value={selectedModel}
                    onChange={e => setSelectedModel(e.target.value)}
                  >
                    <option value="llama3.1:8b">llama3.1:8b</option>
                    <option value="qwen3:4b">qwen3:4b</option>
                    <option value="gemma3:12b">gemma3:12b</option>
                    <option value="qwen2.5vl:7b">qwen2.5vl:7b</option>
                  </select>
                  <span className="text-[#aaa] text-xs font-normal pr-2">{selectedModel}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#666"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ pointerEvents: 'none' }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {/* File Upload */}
                <button
                  type="button"
                  className="flex items-center justify-center w-9 h-9 rounded-lg bg-transparent hover:bg-[#2a2a2a] transition-colors cursor-pointer"
                  aria-label="Attach file"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#888"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ opacity: uploading ? 0.5 : 1 }}
                  >
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.9-9.9a4 4 0 015.66 5.66l-9.9 9.9a2 2 0 01-2.83-2.83l8.49-8.49" />
                  </svg>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt,.doc,.docx"
                    className="hidden"
                    onChange={handleFileChange}
                    tabIndex={-1}
                  />
                </button>
                
                {/* Send Button */}
                <button
                  type="submit"
                  className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#2a2a2a] hover:bg-[#333] transition-colors cursor-pointer disabled:opacity-50"
                  aria-label="Send message"
                  disabled={input.trim().length === 0 || uploading}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          
          {/* Disclaimer */}
          <div className="text-center mt-3">
            <p className="text-[#666] text-[10px]">
              <span className="font-medium">Disclaimer:</span> All conversations are processed securely and not stored or retained.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
