"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import ReactMarkdown from "react-markdown"


import {
  Send,
  Bot,
  User,
  Trash2,
  Copy,
  Upload,
  FileText,
  X,
  AlertTriangle,
  Settings,
  Sparkles,
  Zap,
  Brain,
  MessageSquare,
  FileUp,
  Cpu,
  Gauge,
  Database,
  CheckCircle,
  Clock,
  Download,
  LogOut,
} from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { ThemeToggle } from "@/components/theme-toggle"



interface Message {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp?: string
}

export default function PlaygroundChatbot() {
  // ...existing state and hooks...
  const [model, setModel] = useState("llama3.1:8b")
  const [temperature, setTemperature] = useState([0.7])
  const [maxTokens, setMaxTokens] = useState([1000])
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful AI assistant.")
  const [useRAG, setUseRAG] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "system",
      role: "system",
      content: "You are a helpful AI assistant. Ensure to structure the answers with clear headings and bullet points.",
    },
  ])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change (especially during streaming)
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);



useEffect(() => {
  const handleCleanup = async () => {
    console.debug('[Cleanup] Starting cleanup on page refresh/unload');
    
    // Reset local state
    setMessages([
      {
        id: "system",
        role: "system",
        content: "You are a helpful AI assistant. Ensure to structure the answers with clear headings and bullet points.",
      },
    ]);
    setUploadedFiles([]);
    
    // Call cleanup APIs
    try {
      console.debug('[Cleanup] Calling cleanup API...');
      const response = await fetch("/api/cleanup", { 
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      });
      
      const result = await response.json();
      console.debug('[Cleanup] API Response:', result);
      
      if (!response.ok) {
        console.error('[Cleanup] Failed:', result.error);
      } else {
        console.debug('[Cleanup] Successfully cleared:', {
          uploads: result.uploads,
          documentStore: result.documentStore,
          idleCleaned: result.idleCleaned
        });
      }
    } catch (error) {
      console.error('[Cleanup] Error during cleanup:', error);
    }
  };

  // Call cleanup on component mount
  handleCleanup();

  // Add event listener for page refresh/unload
  window.addEventListener("beforeunload", handleCleanup);
  
  // Cleanup event listener on component unmount
  return () => window.removeEventListener("beforeunload", handleCleanup);
}, []); // Empty dependency array means this runs once on mount




  // Handler for copying message content
  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content)
    toast({
      title: "Copied!",
      description: "Message copied to clipboard.",
    })
  }

  // Handler for submitting chat input
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date().toISOString(),
    }
    const trimmedMessages = [...messages, userMessage]
    setMessages(trimmedMessages)
    setInput("")
    setIsLoading(true)

    try {
      // Always use RAG if any processed document exists
      const hasProcessedDocs = uploadedFiles.some((f) => f.chunks > 0);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: trimmedMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          model,
          temperature: temperature[0],
          maxTokens: maxTokens[0],
          useRAG: hasProcessedDocs,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error("No response body")
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
      }

      setMessages((prev) => [...prev, assistantMessage])

      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6)
            if (data === "[DONE]") continue

            try {
              const parsed = JSON.parse(data)
              const content = parsed.choices?.[0]?.delta?.content
              if (content) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessage.id ? { ...msg, content: msg.content + content } : msg,
                  ),
                )
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send message.",
        variant: "destructive",
      })
      setMessages((prev) => prev.filter((msg) => msg.id !== userMessage.id))
    } finally {
      setIsLoading(false)
    }
  }

  const visibleMessages = messages.filter((m) => m.role !== "system")
  const hasProcessedFiles = uploadedFiles.some((f) => f.chunks > 0)

  const formatTime = (timestamp?: string) => {
    if (!timestamp) return ""
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  return (
    <div className="h-screen bg-white flex font-sans">
      {/* Sidebar */}
      <div
        className={`${sidebarOpen ? "w-80" : "w-0"} fixed left-0 top-0 h-full transition-all duration-300 border-r border-neutral-200 bg-neutral-50 flex flex-col overflow-hidden shadow-lg z-30`} 
        style={{ minWidth: sidebarOpen ? '20rem' : 0 }}
        aria-label="Sidebar navigation"
      >
        {sidebarOpen && (
          <>
            {/* Logo & App Name */}
            <div className="p-8 flex items-center justify-start mb-4" style={{ paddingLeft: "3rem" }}>
              <img
                src="/gravixlayer.png"
                alt="Gravix Layer Logo"
                className="h-20 w-auto object-contain drop-shadow-md"
                style={{ maxWidth: '220px' }}
              />
            {/* End Logo & App Name */}
            </div>


            {/* Navigation Section */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Model Settings Section */}
              <div>
                <h2 className="text-xs font-semibold text-neutral-500 mb-2 tracking-widest uppercase">Model Settings</h2>
                <Card className="bg-neutral-50 border border-neutral-200 rounded-2xl shadow-md transition-shadow hover:shadow-lg">
                  <CardContent className="flex flex-col gap-6 px-6 py-6">
                    {/* Model Row */}
                    <div className="flex flex-col gap-1">
                      <Label className="text-sm font-bold text-neutral-800 mb-1 tracking-wide">Model</Label>
                      <Select value={model} onValueChange={setModel}>
                        <SelectTrigger className="h-11 rounded-xl bg-neutral-100 border-neutral-200 text-neutral-800 w-full shadow-sm focus:ring-2 focus:ring-neutral-200 transition-all">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-neutral-50 border-neutral-200 text-neutral-800">
                          <SelectItem value="llama3.1:8b">Llama 3.1 8B</SelectItem>
                          <SelectItem value="gemma3:12b">Gemma 3 12B</SelectItem>
                          <SelectItem value="qwen2.5vl:7b">Qwen2.5VL 7B</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Temperature Row */}
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between mb-1">
                        <Label className="text-sm font-bold text-neutral-800">Temperature</Label>
                        <Badge variant="outline" className="text-xs px-2 py-0 bg-neutral-100 border-neutral-200 text-neutral-700">
                          {temperature[0]}
                        </Badge>
                      </div>
                      <Slider
                        value={temperature}
                        onValueChange={setTemperature}
                        max={2}
                        min={0}
                        step={0.1}
                        className="w-full text-neutral-700"
                      />
                      <span className="text-xs text-neutral-500 mt-1">Controls creativity and randomness</span>
                    </div>
                    {/* Max Tokens Row */}
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between mb-1">
                        <Label className="text-sm font-bold text-neutral-800">Max Tokens</Label>
                        <Badge variant="outline" className="text-xs px-2 py-0 bg-neutral-100 border-neutral-200 text-neutral-700">
                          {maxTokens[0]}
                        </Badge>
                      </div>
                      <Slider
                        value={maxTokens}
                        onValueChange={setMaxTokens}
                        max={4000}
                        min={100}
                        step={100}
                        className="w-full text-neutral-700"
                      />
                      <span className="text-xs text-neutral-500 mt-1">Maximum response length</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Uploaded Documents Section (now below Model Settings) */}
              <div>
                <h2 className="text-xs font-semibold text-neutral-500 mb-2 tracking-widest uppercase">Uploaded Documents</h2>
                <Card className="bg-neutral-50 border border-neutral-200 rounded-2xl shadow-md">
                  <CardContent className="py-4 px-6">
                    {uploadedFiles.length === 0 ? (
                      <div className="flex flex-col items-center space-y-3">
                        <div className="text-xs text-neutral-400 mb-1">No documents uploaded.</div>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 px-4 rounded-xl border-neutral-200 text-neutral-700 bg-white hover:bg-neutral-50 shadow-md transition-all w-full"
                          onClick={() => fileInputRef.current?.click()}
                          aria-label="Upload documents"
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          <span className="text-sm font-medium">Upload Document</span>
                        </Button>
                      </div>
                    ) : (
                      <ul className="space-y-3">
                        {uploadedFiles.map((file, idx) => {
                          const isProcessing = isUploading && idx === uploadedFiles.length - 1;
                          return (
                            <li key={file.name || idx} className="flex items-center gap-2">
                            <FileText className="h-5 w-5 text-neutral-500" />
                            <span className="truncate text-sm font-semibold text-neutral-800" title={file.name}>{file.name || `Document ${idx + 1}`}</span>
                              {isProcessing && (
                                <span className="flex items-center gap-1 text-xs text-neutral-400 ml-auto">
                                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
                                  Processing
                                </span>
                              )}
                              {!isProcessing && file.chunks > 0 && (
                                <Badge variant="outline" className="text-[11px] px-2 py-0 ml-auto bg-neutral-100 border-neutral-200 text-neutral-700">Processed</Badge>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Add more navigation or settings sections here as needed */}

            </div>

            {/* Sidebar Footer: Disclaimer */}
            <div className="px-8 pb-8 pt-4 mt-auto">
              <div className="bg-neutral-100 border border-neutral-200 rounded-xl p-4 text-xs text-neutral-500 leading-relaxed shadow-sm">
                <span className="font-semibold text-neutral-700">Disclaimer:</span> We do not store or save your files or data. All uploaded documents and chat history are <span className="font-semibold text-neutral-700">cleared as soon as you leave or refresh this site</span>. Your privacy and security are our priority.
              </div>
            </div>
          </>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col bg-white ml-0 md:ml-80 transition-all duration-300">
        {/* Top Bar */}

        <div className="bg-white pt-8 pb-4 border-b border-neutral-200/80 shadow-sm">
          <div className="flex items-center justify-between px-8">
            <div className="flex flex-col gap-1">
              {/* Removed 'Playground' heading as requested */}
              <span className="text-xs text-neutral-500 font-semibold tracking-widest uppercase"><span className="font-extrabold text-neutral-900">PDFCHAT</span>: Chat with your documents</span>
            </div>
            <div className="flex items-center gap-4">
              {isLoading && (
                <div className="flex items-center gap-2 text-base text-neutral-500 mr-2">
                  <div className="w-2 h-2 bg-neutral-400 rounded-full animate-pulse"></div>
                  {useRAG && hasProcessedFiles ? "Searching documents..." : "Generating response..."}
          </div>
        )}
      </div>
          </div>
        </div>

        {/* Chat Messages */}
        <ScrollArea className="flex-1 p-6 bg-white">
          <div className="max-w-6xl mx-auto space-y-6">
            {visibleMessages.length === 0 ? (
              <div className="text-center py-8">
              <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center mx-auto mb-6 border border-neutral-200 shadow-sm">
                <MessageSquare className="h-8 w-8 text-neutral-700" />
              </div>
              {/* Removed 'Welcome to AI Playground' heading as requested */}
              <p className="text-sm text-neutral-500 mb-6 max-w-md mx-auto">
                Start a conversation with our advanced AI assistant. Upload documents to enable RAG-powered responses.
              </p>
              <div className="flex items-center justify-center gap-6 text-base text-neutral-400">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-neutral-500" />
                  <span>AI-Powered</span>
                </div>
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-neutral-500" />
                  <span>RAG Support</span>
                </div>
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-neutral-500" />
                  <span>Real-time</span>
                </div>
              </div>
              </div>
            ) : (
              visibleMessages.map((message) => (
                <div
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "flex gap-3 justify-end pr-2 sm:pr-6 md:pr-16 lg:pr-32"
                      : "flex gap-3 justify-start pl-2 sm:pl-6 md:pl-16 lg:pl-32"
                  }
                >
                  <div
                    className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : "flex-row"} w-full`}
                    style={{ minWidth: 0 }}
                  >
                    <div className="flex-shrink-0">
                      <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center border border-neutral-200 shadow-sm">
                        {message.role === "user" ? <User className="h-6 w-6 text-neutral-700" /> : <Bot className="h-6 w-6 text-neutral-700" />}
                      </div>
                    </div>
                    <Card
                      className="border border-neutral-100 bg-white rounded-3xl shadow-lg transition-shadow hover:shadow-xl w-auto max-w-3xl"
                    >
                      <CardContent className="p-5">
                        <div
                          className="prose prose-sm max-w-none text-sm leading-relaxed text-neutral-900"
                        >
                          <div className="prose max-w-none">
                            <ReactMarkdown
                              components={{
                                p: ({node, ...props}) => <p style={{marginBottom: '0.8em'}} {...props} />,
                                ul: ({node, ...props}) => <ul style={{marginBottom: '0.8em', paddingLeft: '1.2em'}} {...props} />,
                                ol: ({node, ...props}) => <ol style={{marginBottom: '0.8em', paddingLeft: '1.2em'}} {...props} />,
                                li: ({node, ...props}) => <li style={{marginBottom: '0.5em'}} {...props} />,
                                h1: ({node, ...props}) => <h1 style={{marginTop: '1.2em', marginBottom: '0.6em', fontSize: '1.4em'}} {...props} />,
                                h2: ({node, ...props}) => <h2 style={{marginTop: '1em', marginBottom: '0.5em', fontSize: '1.2em'}} {...props} />,
                                h3: ({node, ...props}) => <h3 style={{marginTop: '0.8em', marginBottom: '0.4em', fontSize: '1.1em'}} {...props} />,
                                br: () => <br />,
                              }}
                              skipHtml={false}
                            >
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-4 pt-3 border-t border-neutral-100">
                          <span className="text-xs text-neutral-400">
                            {formatTime(message.timestamp)}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 w-9 p-0 opacity-60 hover:opacity-100 text-neutral-400 hover:bg-neutral-100 rounded-full transition-all"
                            onClick={() => handleCopyMessage(message.content)}
                          >
                            <Copy className="h-5 w-5" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              ))
            )}
            {isLoading && !visibleMessages.some(m => m.role === "assistant" && m.content) && (
              <div className="flex gap-3 justify-start pl-[10vw]">
                <div className="flex gap-3 max-w-[98%]">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-neutral-200 shadow-sm">
                      <Bot className="h-5 w-5 text-neutral-700" />
                    </div>
                  </div>
                  <Card className="bg-white border border-neutral-100 rounded-3xl shadow-lg">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-5">
                        <div className="flex space-x-1">
                          <div className="w-2 h-2 bg-neutral-700 rounded-full animate-bounce [animation-delay:-0.3s]" />
                          <div className="w-2 h-2 bg-neutral-700 rounded-full animate-bounce [animation-delay:-0.15s]" />
                          <div className="w-2 h-2 bg-neutral-700 rounded-full animate-bounce" />
                        </div>
                        <span className="text-lg text-neutral-400">
                          {useRAG && hasProcessedFiles ? "Analyzing documents..." : "Thinking..."}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="bg-white py-2 px-0 border-t border-neutral-200">
          <div className="max-w-6xl mx-auto">
            <form onSubmit={handleSubmit} className="flex gap-2 items-center">
              <div className="flex-1 relative">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              useRAG && hasProcessedFiles ? "Ask questions about your documents..." : "Type your message..."
            }
            disabled={isLoading}
            className="pr-12 h-9 rounded-xl border border-neutral-200 bg-white focus:bg-neutral-50 transition-colors text-neutral-900 placeholder:text-neutral-500 text-sm shadow-md w-full"
          />
          {input.trim() && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <Badge variant="outline" className="text-xs px-2 py-0 bg-white border-neutral-200 text-neutral-700">
                {input.length}
              </Badge>
            </div>
          )}
              </div>
              <input
          type="file"
          accept=".pdf,.txt,.doc,.docx"
          ref={fileInputRef}
          style={{ display: 'none' }}
          multiple
          onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length === 0) return;
            setIsUploading(true);
            for (const file of files) {
              setUploadedFiles((prev) => [...prev, { name: file.name, chunks: 0 }]);
              const formData = new FormData();
              formData.append('file', file);
              try {
                const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
                });
                if (!res.ok) throw new Error('Upload failed');
                setUploadedFiles((prev) => prev.map((f, i) =>
            i === prev.length - 1 ? { ...f, chunks: 1 } : f
                ));
                setUseRAG(true);
              } catch (err) {
                setUploadedFiles((prev) => prev.slice(0, -1));
                toast({ title: 'Upload failed', description: file.name, variant: 'destructive' });
              }
            }
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
              />
                <Button
                type="button"
                variant="outline"
                className="h-9 px-2 rounded-xl border-neutral-200 text-neutral-700 bg-white hover:bg-neutral-50 shadow-md transition-all"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Upload documents"
                >
                <Upload className="h-4 w-4" />
                </Button>
                <Button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="h-9 px-5 rounded-xl bg-neutral-900 border border-neutral-900 text-neutral-50 hover:bg-neutral-800 hover:border-neutral-800 shadow-lg transition-all text-sm font-bold"
                >
                <Send className="h-4 w-4" />
                </Button>
                </form>
                {/* Removed character count display */}
                </div>
              </div>
              </div>
              </div>
              )
            }
