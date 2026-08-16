# 🛠️ Complete Infrastructure & Environment Setup Guide

This guide provides step-by-step instructions to configure and spin up the complete VoiceAqar infrastructure, including Docker containers, relational and vector databases, graph databases, Google Calendar API integration, and telemetry.

---

## 🗃️ 1. Docker Infrastructure Setup

VoiceAqar relies on four core services managed via Docker. The configurations are specified in the [`docker-compose.yml`](file:///d:/Mohamed/Projects/nodejs%20projects/VoiceAqar/docker-compose.yml) file.

### Spin Up Services
Run the following command to start all databases in detached mode:
```bash
docker-compose up -d
```

### Port Mapping & Credentials Reference
| Service | Container Port | Host Port | Username / Password | Purpose |
| :--- | :---: | :---: | :--- | :--- |
| **PostgreSQL** | `5432` | `5433` | `postgres` / `secretpassword` | Relational storage for user profiles and calendar events. |
| **Redis** | `6379` | `6379` | *None* | Short-term session management and state caching. |
| **Qdrant** | `6333` | `6333` | *None* | Vector database storing property embeddings for semantic search. |
| **Neo4j** | `7687` (Bolt) | `7687` | `neo4j` / `secretpassword` | Graph database mapping relationships between users and property preferences. |

To stop the services, run:
```bash
docker-compose down
```

---

## ⚙️ 2. Environment Variables Reference (`.env`)

Create a `.env` file in the root directory (copied from `.env.example`). Below is the complete key reference:

### Core Configuration
*   `PORT`: The port on which the Express server and WebSocket gateway listen (default: `3000`).
*   `DATABASE_URL`: Connection string for PostgreSQL: `postgres://postgres:secretpassword@localhost:5433/maskan_db`.
*   `QDRANT_URL`: Endpoint for Qdrant (default: `http://localhost:6333`).
*   `REDIS_URL`: Endpoint for Redis (default: `redis://localhost:6379`).
*   `NEO4J_URI`: Endpoint for Neo4j Bolt connection (default: `bolt://localhost:7687`).
*   `NEO4J_USER`: Username for Neo4j (default: `neo4j`).
*   `NEO4J_PASSWORD`: Password for Neo4j (default: `secretpassword`).

### Gemini & LLM Provider Configuration
*   `GEMINI_API_KEY`: Your Gemini API key from Google AI Studio.
*   `GEMINI_LIVE_MODEL`: The model used for WebSocket real-time voice sessions (default: `gemini-3.1-flash-live-preview`).
*   `GEMINI_LIVE_VOICE`: Prebuilt voice profile to use (e.g. `Puck`, `Charon`, `Kore`, `Fenrir`, `Aoede`).
*   `LLM_PROVIDER`: The provider for text chat and qualitative evaluation. Choices: `gemini`, `openrouter`, `groq` (default: `gemini`).
*   `OPENROUTER_API_KEY`: API Key if using OpenRouter for chat or judging.
*   `GROQ_API_KEY`: API Key if using Groq for chat or judging.
*   `GEMINI_EVAL_MODEL`: Model ID used for the qualitative judge evaluations (e.g. `google/gemini-2.5-flash` or `gemini-3.1-flash-preview`).

### Active Providers
*   `EMBEDDING_PROVIDER`: Provider for vector embeddings. Set to `local` (uses local Xenova/ONNX transformers CPU-bound) or `gemini` (uses Gemini embeddings API). (default: `local`).
*   `VECTOR_DB_PROVIDER`: The active vector database. Set to `qdrant` (default: `qdrant`).

### Telemetry & Observability (Opik)
*   `OPIK_API_KEY`: Your Comet Opik API token for tracing prompts, tool calls, and latencies.
*   `OPIK_WORKSPACE`: Your Opik workspace name (typically your username or workspace namespace in Comet). **Required for cloud tracking.**
*   `OPIK_PROJECT_NAME`: The target project in Opik where traces are logged (default: `voiceaqar`).

### Twilio Integration (Optional)
*   `TWILIO_AUTH_TOKEN`: Twilio Auth Token used to validate incoming Twilio call webhook signatures.
*   `SESSION_TTL_HOURS`: Hours of inactivity before Redis automatically expires/purges chat sessions (default: `6`).

---

## 📅 3. Google Calendar API Integration

VoiceAqar supports real-time scheduling of viewing appointments on Google Calendar. Follow these detailed steps to set up the integration:

### Step 1: Create a Google Cloud Project & Enable API
1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Create a new project (e.g., `VoiceAqar-Calendar`).
3.  Search for **Google Calendar API** in the API Library and click **Enable**.

### Step 2: Create a Service Account
1.  Go to **IAM & Admin > Service Accounts**.
2.  Click **Create Service Account**. Give it a name (e.g., `calendar-manager`) and click **Create and Continue**.
3.  Skip role assignments (optional) and click **Done**.
4.  Copy the generated **Service Account Email** (e.g., `calendar-manager@project-id.iam.gserviceaccount.com`). You will need this for the `.env` file and calendar sharing.

### Step 3: Generate a Private Key
1.  In the Service Accounts list, click on your newly created Service Account.
2.  Navigate to the **Keys** tab.
3.  Click **Add Key > Create New Key**.
4.  Select **JSON** and click **Create**. This downloads a private key file (e.g., `project-id-xxxx.json`) to your computer.
5.  Open the JSON file and extract the following:
    *   The `client_email` value.
    *   The `private_key` value.

### Step 4: Share Your Target Google Calendar
1.  Open [Google Calendar](https://calendar.google.com/).
2.  Identify or create the calendar you want the agent to use (e.g., your primary calendar or a new calendar named `VoiceAqar Viewings`).
3.  Hover over the calendar in the sidebar, click the **three dots**, and select **Settings and sharing**.
4.  Scroll down to **Share with specific people or groups** and click **Add people**.
5.  Paste the **Service Account Email** you copied in Step 2.
6.  Set the Permissions to **Make changes to events** (CRITICAL: if you set it to read-only, the agent won't be able to book appointments!).
7.  Scroll down to the **Integrate calendar** section and copy the **Calendar ID** (e.g. `your-email@gmail.com` or `xxxx@group.calendar.google.com`).

### Step 5: Configure `.env`
Fill in the extracted values in your `.env` file:
*   `GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL`: The service account email.
*   `GOOGLE_CALENDAR_ID`: The shared Calendar ID.
*   `GOOGLE_CALENDAR_PRIVATE_KEY`: The service account private key. 
    > [!IMPORTANT]
    > Google Calendar private keys contain newline characters (`\n`). You MUST paste the private key wrapped in quotes (`"`) and keep the `\n` formatting inline on a single line in your `.env` file, like so:
    > `GOOGLE_CALENDAR_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC...\n-----END PRIVATE KEY-----\n"`

---

## 📈 4. Database Setup & Seeding

After configuration, initialize the relational and vector databases to seed mock properties and prepare them for semantic search.

### 1. PostgreSQL Schema Migration & Seeding
Apply database migrations using Drizzle ORM to build tables (`users`, `bookings`) and populate default data:
```bash
npm run db:setup
```

### 2. Generate Vector Embeddings & Seed Qdrant
This parses mock property text descriptions (location, compound, size, specifications), generates vector embeddings (using either a local model or the Gemini embeddings API depending on `EMBEDDING_PROVIDER`), and inserts them into the Qdrant `properties` collection:
```bash
npx tsx src/scripts/index_properties.ts
```

---

## 🧪 5. Testing & Validation

Once configuration and database seeding are complete, verify your connections using our built-in diagnostics:

### 1. Test Client Database & Container Connections
Validate that the PostgreSQL, Redis, Neo4j, and Qdrant database clients are connecting successfully:
```bash
npx tsx test/test_connections.ts
```

### 2. Test LLM & Gemini API Keys
Verify text generation and structured JSON output using your `GEMINI_API_KEY`:
```bash
npx tsx test/test_llm_service.ts
```

### 3. Start the Server
If all tests pass, launch the gateway:
```bash
npm run dev
```
Navigate to `http://localhost:3000/voice` to start a real-time Egyptian Arabic conversation with VoiceAqar!
