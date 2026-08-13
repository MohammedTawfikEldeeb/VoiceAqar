# VoiceAqar — Architecture

Two independent execution paths share the same tools, memory, and infrastructure:

1. **Voice (Gemini Live)** — a single live session handles STT + LLM + TTS natively.
2. **Text Chat (LangGraph)** — classic pipeline: user text → agent (LLM + tools) → reply.

---

## 1. Overall Flow Diagram

```mermaid
flowchart TD
    subgraph Clients["Clients"]
        BrowserVoice["Browser Voice Client<br/>(/voice)"]
        Phone["Twilio Phone Call<br/>(PSTN)"]
        BrowserChat["Browser Text Chat<br/>(/chat)"]
    end

    subgraph Server["Node.js / Express Server (server.ts)"]
        HTTP["HTTP Routes"]
        WSS["WebSocket Server (ws)"]
        RateLimit["IP Rate Limiter<br/>(15 conns/IP)"]
        Auth["WSS Access Token<br/>+ Twilio Signature"]
    end

    subgraph VoicePath["VOICE PATH — Gemini Live"]
        GG["GeminiLiveGateway<br/>(/ws/voice-live)"]
        TG["TwilioGateway<br/>(/ws/twilio)"]
        VS["VoiceSession<br/>(shared core)"]
    end

    subgraph ChatPath["CHAT PATH — LangGraph"]
        CC["ChatController<br/>(/api/chat)"]
        Agent["LangGraph React Agent<br/>(voiceaqar_agent.ts)"]
    end

    subgraph Tools["Tool Layer (single registry)"]
        Registry["Tools Registry<br/>(tools/registry.ts)"]
        PR["property_retrieval"]
        SUP["save_user_profile"]
        SP["save_user_preferences"]
        CS["check_calendar_slots"]
        BA["book_appointment"]
    end

    subgraph Memory["Memory Manager (memory_manager.ts)"]
        WM["Working Memory<br/>(Redis sliding window)"]
        GM["Graph Memory<br/>(Neo4j: user/prefs/history)"]
        RM["Relational Memory<br/>(PostgreSQL: properties/users)"]
        SEM["Semantic Memory<br/>(Qdrant + embeddings)"]
        CW["Context Window<br/>(session-scoped)"]
    end

    subgraph Metrics["Observability"]
        MS["Metrics Module<br/>(metrics.ts)"]
    end

    subgraph External["External Services"]
        Gemini["Google Gemini Live API"]
        GCal["Google Calendar API"]
        Opik["Opik (LLMOps / tracing)"]
        Neo4j[("Neo4j")]
        Postgres[("PostgreSQL")]
        Redis2[("Redis")]
        Qdrant[("Qdrant")]
    end

    BrowserVoice -->|"wss + access_token"| WSS
    Phone -->|"TwiML webhook"| HTTP
    HTTP -->|"/ws/twilio"| WSS
    WSS --> RateLimit
    RateLimit --> Auth
    Auth --> GG
    Auth --> TG
    BrowserChat -->|"POST /api/chat"| CC

    GG --> VS
    TG --> VS
    VS -->|"connect + audio + tools"| Gemini

    CC --> Agent
    Agent -->|"messageModifier: getSystemPrompt()"| Registry

    VS -->|"executeToolCall(name, args, ctx)"| Registry
    Registry --> PR
    Registry --> SUP
    Registry --> SP
    Registry --> CS
    Registry --> BA

    VS -->|"getAgentContext()"| Memory
    CC -->|"getOrCreateUser + memory"| Memory
    Memory --> WM
    Memory --> GM
    Memory --> RM
    Memory --> SEM
    Memory --> CW

    VS -->|"telemetry → objective + judged scores"| MS
    MS -->|"trace.score(...)"| Opik

    CS --> GCal
    BA --> GCal
    RM --> Postgres
    GM --> Neo4j
    WM --> Redis2
    SEM --> Qdrant
    VS -->|"Opik traces/spans"| Opik
    Agent -->|"Opik callbacks"| Opik
```

---

## 2. Voice Path Detail (Gemini Live)

```mermaid
sequenceDiagram
    participant C as Client (Browser / Twilio)
    participant GW as Gateway (thin transport)
    participant VS as VoiceSession
    participant G as Gemini Live API
    participant R as Tools Registry
    participant M as MemoryManager

    C->>GW: WebSocket open (+ phone)
    GW->>GW: getOrCreateUser(phone) → userId, userName
    GW->>GW: pickRandomPersonality() → voice + persona
    GW->>M: onCallStart(sessionId, userId)
    M-->>GW: systemPrompt (getSystemPrompt + graph context + current date + persona)
    GW->>VS: new VoiceSession({..., voiceName, systemPrompt})
    VS->>G: connect(model, AUDIO only, voice, tools)
    G-->>VS: ready
    VS-->>GW: onOpen → status:ready
    C-->>GW: raw audio (16 kHz PCM base64)
    GW-->>VS: sendAudioInput(base64) [records firstClientAudioAtMs]
    VS-->>G: sendRealtimeInput(audio)
    G-->>VS: serverContent modelTurn (audio + text chunks) [firstAgentAudioAtMs] + usageMetadata
    VS-->>GW: onAudio(buffer 24 kHz PCM)
    GW-->>C: audio bytes (raw) or mulaw 8 kHz (Twilio)
    G-->>VS: toolCall functionCalls
    VS->>R: executeToolCall(name, args, ctx) [records tool outcome]
    R-->>VS: result string
    VS-->>G: sendToolResponse(functionResponses)
    G-->>VS: turnComplete
    VS-->>M: onAgentResponse(text) [records agent transcript]
    C->>GW: disconnect
    GW->>VS: close() — push objective scores, run LLM judge, push judged scores, end/flush Opik
    GW->>M: onCallEnd(sessionId, userId)
```

---

## 3. Text Chat Path Detail (LangGraph)

```mermaid
sequenceDiagram
    participant C as HTTP Client
    participant CC as ChatController
    participant MM as MemoryManager
    participant A as LangGraph React Agent
    participant LM as CustomChatModel (OpenRouter/Groq/Gemini)
    participant T as Tools (registry)

    C->>CC: POST /api/chat {message, phoneNumber, sessionId}
    CC->>CC: getOrCreateUser(phone) → userId
    CC->>MM: onCallStart / onUserMessage
    CC->>A: agent.invoke(messages, {thread_id})
    A->>LM: chat.completions (OpenAI-compatible)
    LM-->>A: model reply (or tool call)
    A->>T: tool.invoke()
    T-->>A: result
    A-->>CC: final AIMessage
    CC->>MM: onAgentResponse
    CC-->>C: {reply, sessionId, userId, name}
```

---

## 4. Tool Registry (single source of truth)

```mermaid
flowchart LR
    subgraph Schemas["zod schemas"]
        Z1["property_retrieval"]
        Z2["save_user_profile"]
        Z3["save_user_preferences"]
        Z4["check_calendar_slots"]
        Z5["book_appointment"]
    end

    subgraph Registry["tools/registry.ts"]
        AT["agentTools[]"]
        FD["functionDeclarations (auto-generated)"]
        EX["executeToolCall (dispatcher + buildArgs)"]
    end

    subgraph Consumers["Consumers"]
        LA["LangGraph agent (agentTools)"]
        VS["VoiceSession (functionDeclarations)"]
    end

    Z1 --> AT
    Z2 --> AT
    Z3 --> AT
    Z4 --> AT
    Z5 --> AT
    AT --> LA
    AT --> FD
    FD --> VS
    AT --> EX
    EX --> VS
```

---

## 5. Memory Layers

| Layer | Store | Purpose |
|-------|-------|---------|
| Working Memory | Redis | Transient per-session sliding window of turns |
| Graph Memory | Neo4j | Persistent user profile, preferences, budget, search history, property interactions |
| Relational Memory | PostgreSQL | Properties catalog, users; LangGraph checkpointer (PostgresSaver) |
| Semantic Memory | Qdrant | Vector search over properties (embedding-based) |
| Context Window | In-memory | Session-scoped tool results + memory summary injected into prompt |

---

## 6. Metrics & Observability

Every voice call is scored on the **Opik dashboard** via feedback scores pushed at session close (`VoiceSession.close()`).

**Objective metrics** — computed locally, no extra cost:

| Metric (Opik score) | What it measures |
|---------------------|------------------|
| `ttfa_ms` | User's first audio chunk → first agent audio chunk |
| `e2e_latency_ms` | Last user audio before a response → first agent audio |
| `error_rate` | 1.0 if any session/connection error occurred, else 0 |
| `tool_success_rate` | Successful tool calls / total tool calls |
| `tokens_input` / `tokens_output` | Cumulated usage from Gemini Live `usageMetadata` |
| `cost_usd` | Only when `GEMINI_LIVE_INPUT/OUTPUT_PRICE_PER_MILLION` are set |

**Qualitative metrics** — judged by `GEMINI_EVAL_MODEL` on the call transcript + tool outcomes:

| Metric (Opik score) | What it measures |
|---------------------|------------------|
| `task_success` | Did the agent complete the user's goal |
| `intent_accuracy` | Did the agent understand what the user wanted |
| `response_relevance` | Was each response appropriate to the request |
| `tool_call_accuracy` | Right tools called with correct arguments |

Source: `src/infrastructure/observability/metrics.ts`. The judge is best-effort and never blocks or breaks call teardown.

---

## 7. Personalities

`src/config/personalities.ts` defines a dictionary of personas, each with its own Gemini Live voice (`Puck`, `Charon`, `Kore`, `Fenrir`, ...) and an Egyptian Arabic personality section. Each incoming call picks one **randomly**:

| id | name | voice | personality |
|----|------|-------|-------------|
| `trusted-advisor` | المستشار العقاري | Puck | Calm senior advisor |
| `friendly-broker` | سمسار صديق | Charon | Casual neighborhood broker |
| `elegant-consultant` | مستشارة راقية | Kore | Polished luxury consultant |
| `energetic-seller` | مبيعات نشيط | Fenrir | Energetic sales closer |

---

## 8. Key Files

| File | Responsibility |
|------|----------------|
| `src/server.ts` | HTTP + WS server, route mounting, gateways, rate limiting |
| `src/gateway/gemini_live_gateway.ts` | Web transport for `/ws/voice-live` (raw PCM) |
| `src/gateway/twilio_gateway.ts` | Twilio Media Streams transport (mulaw ↔ PCM) |
| `src/gateway/voice_session.ts` | Shared live-session core: connect, messages, tools, memory, Opik, metrics |
| `src/tools/registry.ts` | Single tool source of truth, zod→Gemini converter, dispatcher |
| `src/tools/*.ts` | Individual tools (property, profile, preferences, booking) |
| `src/agent/voiceaqar_agent.ts` | LangGraph React agent + PostgresSaver + initialization |
| `src/agent/prompt.ts` | System prompt, current-date context, budget confirmation, Opik sync |
| `src/config/personalities.ts` | Random voice + persona dictionary |
| `src/infrastructure/observability/metrics.ts` | Objective + LLM-judged metric computation, Opik score push |
| `src/infrastructure/memory/memory_manager.ts` | Orchestrates all memory layers, builds agent context |
| `src/infrastructure/calendar/google_calendar.ts` | Service-account auth, freebusy, available slots, booking |
| `src/config/env.ts` | Zod-validated environment config |
| `src/utils/audio_helper.ts` | mulaw encode/decode, resampling (Twilio) |