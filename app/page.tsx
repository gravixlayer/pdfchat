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
} from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { ThemeToggle } from "@/components/theme-toggle"

interface Message {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp?: string
}

interface UploadedFile {
  fileId: string
  filename: string
  size: number
  type: string
  chunks: number
  uploadedAt: string
  hasWarning?: boolean
  warningMessage?: string
}

export default function PlaygroundChatbot() {
  // Chat state
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

  // File upload state
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleClearChat = () => {
    setMessages([
      {
        id: "system",
        role: "system",
        content: systemPrompt,
      },
    ])
    toast({
      title: "Chat cleared",
      description: "All messages have been removed.",
    })
  }

  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content)
    toast({
      title: "Copied!",
      description: "Message copied to clipboard.",
    })
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please select a file smaller than 10MB.",
        variant: "destructive",
      })
      return
    }

    // Validate file type
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please select a PDF or DOC file.",
        variant: "destructive",
      })
      return
    }

    setIsUploading(true)
    setUploadProgress(0)

    try {
      const formData = new FormData()
      formData.append("file", file)

      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90))
      }, 200)

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      clearInterval(progressInterval)
      setUploadProgress(100)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Upload failed")
      }

      const result = await response.json()

      const newFile: UploadedFile = {
        fileId: result.fileId,
        filename: result.filename,
        size: result.size,
        type: result.type,
        chunks: result.chunks || 0,
        uploadedAt: new Date().toISOString(),
        hasWarning: !!result.warning,
        warningMessage: result.warning,
      }

      setUploadedFiles((prev) => [...prev, newFile])

      if (result.warning) {
        toast({
          title: "File uploaded with warning",
          description: result.warning,
          variant: "destructive",
        })
      } else {
        toast({
          title: "Success!",
          description: `${result.filename} processed successfully.`,
        })
      }

      // Enable RAG automatically when files are uploaded
      if (result.chunks > 0) {
        setUseRAG(true)
      }
    } catch (error) {
      console.error("Upload error:", error)
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload file.",
        variant: "destructive",
      })
    } finally {
      setIsUploading(false)
      setUploadProgress(0)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  const handleRemoveFile = (fileId: string) => {
    setUploadedFiles((prev) => prev.filter((file) => file.fileId !== fileId))
    if (uploadedFiles.length === 1) {
      setUseRAG(false)
    }
    toast({
      title: "File removed",
      description: "File has been removed from context.",
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date().toISOString(),
    }

    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput("")
    setIsLoading(true)

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: newMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          model,
          temperature: temperature[0],
          maxTokens: maxTokens[0],
          useRAG: useRAG && uploadedFiles.some((f) => f.chunks > 0),
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
    <div className="h-screen bg-gradient-to-br from-background via-background to-muted/20 flex">
      {/* Sidebar */}
      <div
        className={`${sidebarOpen ? "w-80" : "w-0"} transition-all duration-300 border-r border-border/50 bg-card/50 backdrop-blur-sm flex flex-col overflow-hidden`}
      >
        {sidebarOpen && (
          <>
            {/* Header */}
            <div className="p-6 border-b border-border/50">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                  <Sparkles className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                    Gravix Layer
                  </h1>
                  <p className="text-xs text-muted-foreground">AI Playground</p>
                </div>
                <div className="ml-auto">
                  <ThemeToggle />
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="rounded-full text-xs">
                  <Cpu className="h-3 w-3 mr-1" />
                  {model}
                </Badge>
                {useRAG && hasProcessedFiles && (
                  <Badge variant="success" className="rounded-full text-xs">
                    <Database className="h-3 w-3 mr-1" />
                    RAG
                  </Badge>
                )}
                <Badge variant="outline" className="rounded-full text-xs">
                  <MessageSquare className="h-3 w-3 mr-1" />
                  {visibleMessages.length}
                </Badge>
              </div>
            </div>

            {/* Sidebar Content: Model, Files, System, Actions (no tabs) */}
            <div className="flex-1 overflow-y-auto p-4 space-y-8">
              {/* Model Section */}
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Cpu className="h-4 w-4" />
                    Model Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Model</Label>
                    <Select value={model} onValueChange={setModel}>
                      <SelectTrigger className="h-9 rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="llama3.1:8b">
                          <div className="flex items-center gap-2">
                            <Zap className="h-3 w-3" />
                            Llama 3.1 8B
                          </div>
                        </SelectItem>
                        <SelectItem value="llama3.1:70b">
                          <div className="flex items-center gap-2">
                            <Gauge className="h-3 w-3" />
                            Llama 3.1 70B
                          </div>
                        </SelectItem>
                        <SelectItem value="llama3.1:405b">
                          <div className="flex items-center gap-2">
                            <Brain className="h-3 w-3" />
                            Llama 3.1 405B
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">Temperature</Label>
                      <Badge variant="outline" className="text-xs px-2 py-0">
                        {temperature[0]}
                      </Badge>
                    </div>
                    <Slider
                      value={temperature}
                      onValueChange={setTemperature}
                      max={2}
                      min={0}
                      step={0.1}
                      className="w-full"
                    />
                    <p className="text-xs text-muted-foreground">Controls creativity and randomness</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">Max Tokens</Label>
                      <Badge variant="outline" className="text-xs px-2 py-0">
                        {maxTokens[0]}
                      </Badge>
                    </div>
                    <Slider
                      value={maxTokens}
                      onValueChange={setMaxTokens}
                      max={4000}
                      min={100}
                      step={100}
                      className="w-full"
                    />
                    <p className="text-xs text-muted-foreground">Maximum response length</p>
                  </div>
                </CardContent>
              </Card>

              <div className="my-2">
                <hr className="border-t border-border/30" />
              </div>

              {/* Files Section */}
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileUp className="h-4 w-4" />
                    Document Upload
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <label htmlFor="sidebar-file-upload" className="w-full">
                    <input
                      id="sidebar-file-upload"
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.doc,.docx"
                      onChange={handleFileUpload}
                      className="sr-only"
                      tabIndex={-1}
                    />
                    <Button
                      asChild
                      disabled={isUploading}
                      variant="outline"
                      className="w-full h-20 border-dashed border-2 hover:border-primary/50 transition-colors cursor-pointer"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Upload className="h-5 w-5" />
                        <span className="text-sm font-medium">
                          {isUploading ? "Uploading..." : "Upload Document"}
                        </span>
                        <span className="text-xs text-muted-foreground">PDF, DOC up to 10MB</span>
                      </div>
                    </Button>
                  </label>
                  {isUploading && (
                    <div className="space-y-2">
                      <Progress value={uploadProgress} className="w-full h-2" />
                      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3 animate-spin" />
                        Processing... {uploadProgress}%
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
              {uploadedFiles.length > 0 && (
                <Card className="border-border/50 bg-card/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Uploaded Files ({uploadedFiles.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {uploadedFiles.map((file) => (
                      <div key={file.fileId} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <FileText className="h-4 w-4 text-blue-500" />
                            {file.hasWarning ? (
                              <AlertTriangle className="h-3 w-3 text-yellow-500" aria-label={file.warningMessage || "Warning"} />
                            ) : (
                              <CheckCircle className="h-3 w-3 text-green-500" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{file.filename}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{Math.round(file.size / 1024)} KB</span>
                              <span>•</span>
                              <span>{file.chunks} chunks</span>
                              {file.hasWarning && (
                                <>
                                  <span>•</span>
                                  <span className="text-yellow-600">Warning</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveFile(file.fileId)}
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              <Card className="border-border/50 bg-card/50">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4" />
                        <Label className="text-sm font-medium">RAG Mode</Label>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Use uploaded documents for context-aware responses
                      </p>
                    </div>
                    <Switch checked={useRAG} onCheckedChange={setUseRAG} disabled={!hasProcessedFiles} />
                  </div>
                </CardContent>
              </Card>

              <div className="my-2">
                <hr className="border-t border-border/30" />
              </div>

              {/* System Section */}
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Brain className="h-4 w-4" />
                    System Instructions
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="Define the AI's behavior and personality..."
                    className="min-h-[120px] resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    These instructions guide how the AI responds to your messages.
                  </p>
                </CardContent>
              </Card>
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Actions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearChat}
                    disabled={visibleMessages.length === 0}
                    className="w-full justify-start bg-transparent"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Clear Chat History
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start bg-transparent"
                    onClick={() => {
                      const chatData = JSON.stringify(visibleMessages, null, 2)
                      const blob = new Blob([chatData], { type: "application/json" })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement("a")
                      a.href = url
                      a.download = "chat-export.json"
                      a.click()
                      URL.revokeObjectURL(url)
                    }}
                    disabled={visibleMessages.length === 0}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export Chat
                  </Button>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <div className="h-16 border-b border-border/50 bg-card/30 backdrop-blur-sm flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2">
              <Settings className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-3">
              <h2 className="font-semibold">AI Playground</h2>
              {isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  {useRAG && hasProcessedFiles ? "Searching documents..." : "Generating response..."}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {visibleMessages.length} messages
            </Badge>
          </div>
        </div>

        {/* Chat Messages */}
        <ScrollArea className="flex-1 p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {visibleMessages.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-20 h-20 bg-gradient-to-br from-blue-500/20 to-purple-600/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <MessageSquare className="h-10 w-10 text-blue-500" />
                </div>
                <h3 className="text-xl font-semibold mb-3">Welcome to AI Playground</h3>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  Start a conversation with our advanced AI assistant. Upload documents to enable RAG-powered responses.
                </p>
                <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    <span>AI-Powered</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    <span>RAG Support</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    <span>Real-time</span>
                  </div>
                </div>
              </div>
            ) : (
              visibleMessages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-4 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`flex gap-4 max-w-[85%] ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                  >
                    <div className="flex-shrink-0">
                      {message.role === "user" ? (
                        <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg">
                          <User className="h-5 w-5 text-white" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                          <Bot className="h-5 w-5 text-white" />
                        </div>
                      )}
                    </div>
                    <Card
                      className={`shadow-lg border-0 ${
                        message.role === "user"
                          ? "bg-gradient-to-br from-green-500 to-emerald-600 text-white"
                          : "bg-card/80 backdrop-blur-sm"
                      }`}
                    >
                      <CardContent className="p-4">
                        <div
                          className={`prose prose-sm max-w-none dark:prose-invert text-sm leading-relaxed ${
                            message.role === "user" ? "text-white" : "text-foreground"
                          }`}
                        >
                          <div className="prose dark:prose-invert max-w-none">
                            <ReactMarkdown
                              components={{
                                p: ({node, ...props}) => <p style={{marginBottom: '1em'}} {...props} />,
                                ul: ({node, ...props}) => <ul style={{marginBottom: '1em', paddingLeft: '1.5em'}} {...props} />,
                                ol: ({node, ...props}) => <ol style={{marginBottom: '1em', paddingLeft: '1.5em'}} {...props} />,
                                li: ({node, ...props}) => <li style={{marginBottom: '0.5em'}} {...props} />,
                                h1: ({node, ...props}) => <h1 style={{marginTop: '1.5em', marginBottom: '0.75em'}} {...props} />,
                                h2: ({node, ...props}) => <h2 style={{marginTop: '1.2em', marginBottom: '0.6em'}} {...props} />,
                                h3: ({node, ...props}) => <h3 style={{marginTop: '1em', marginBottom: '0.5em'}} {...props} />,
                                br: () => <br />,
                              }}
                              skipHtml={false}
                            >
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/10">
                          <span
                            className={`text-xs ${message.role === "user" ? "text-white/70" : "text-muted-foreground"}`}
                          >
                            {formatTime(message.timestamp)}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-6 w-6 p-0 opacity-60 hover:opacity-100 ${
                              message.role === "user"
                                ? "text-white hover:bg-white/10"
                                : "text-muted-foreground hover:bg-accent"
                            }`}
                            onClick={() => handleCopyMessage(message.content)}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              ))
            )}
            {isLoading && (
              <div className="flex gap-4 justify-start">
                <div className="flex gap-4 max-w-[85%]">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                      <Bot className="h-5 w-5 text-white" />
                    </div>
                  </div>
                  <Card className="bg-card/80 backdrop-blur-sm shadow-lg border-0">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex space-x-1">
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                        </div>
                        <span className="text-sm text-muted-foreground">
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
        <div className="border-t border-border/50 bg-card/30 backdrop-blur-sm p-6">
          <div className="max-w-4xl mx-auto">
            <form onSubmit={handleSubmit} className="flex gap-3">
              <div className="flex-1 relative">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    useRAG && hasProcessedFiles ? "Ask questions about your documents..." : "Type your message..."
                  }
                  disabled={isLoading}
                  className="pr-12 h-12 rounded-xl border-border/50 bg-background/50 backdrop-blur-sm focus:bg-background transition-colors"
                />
                {input.trim() && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Badge variant="outline" className="text-xs px-2 py-0">
                      {input.length}
                    </Badge>
                  </div>
                )}
              </div>
              <Button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="h-12 px-6 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 shadow-lg"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
            <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-4">
                <span>Press Enter to send</span>
                {useRAG && hasProcessedFiles && (
                  <div className="flex items-center gap-1">
                    <Database className="h-3 w-3" />
                    <span>RAG enabled</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span>{input.length}/2000</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
