# 🐳 CodeAnywhere — Local Development Guide

This guide contains complete setup instructions for running the **CodeAnywhere** editor locally. 

---

## ⚡ Option 1: Hybrid Development (Recommended for Fast Frontend HMR)
Run the isolated execution backend in a Docker container (to bind host permissions easily), and run the React/Vite frontend on your host machine.

### 1. Build and Start the Docker Backend
Make sure **Docker Desktop** is open, then start the backend service:
```bash
# From the project root, start the backend container
docker compose up backend -d

# Watch logs to confirm it starts and pulls required images
docker compose logs backend -f
```
The backend binds to `http://localhost:3001` and is ready to process executions.

### 2. Run the Frontend Locally on your Host
In another terminal, install dependencies and start the Vite dev server:
```bash
# Install frontend dependencies
npm install

# Start Vite dev server on port 5173
npm run dev
```
Open **[http://localhost:5173](http://localhost:5173)** in your browser. All code run requests are automatically proxied to the containerized backend.

---

## 📦 Option 2: Full Docker Compose Stack
Launch the entire application (frontend + backend) in isolated Docker containers:
```bash
# Build and launch both services
docker compose up -d

# Check live logs for compile/run outputs
docker compose logs -f
```
Once initialized, visit **[http://localhost:5173](http://localhost:5173)**.

---

## 🔧 Option 3: Non-Docker Development (Local Host Run)
To run the server without Docker, the execution engine automatically falls back to Piston Cloud compiler APIs.

### 1. Setup Environment
```bash
cd server
cp .env.example .env
```

### 2. Launch Local Servers
```bash
# Terminal 1 — Start Express backend on host
cd server
npm install
npm start

# Terminal 2 — Start Frontend on host
cd ..
npm install
npm run dev
```

---

## 🧪 Testing Code Execution

Once running, verify isolated execution for any language:

### Test Python
```python
import os, sys
print("Hello from containerized Python!")
print(f"User ID: {os.getuid()} (65534 = nobody)")
print(f"Network interfaces: {os.listdir('/sys/class/net')}")
```
*Expected Output:* `User ID: 65534`, `Network interfaces: ['lo']` (no network access).

### Test C++ (Compiled)
```cpp
#include <iostream>
int main() {
    std::cout << "C++ binary compiled and run successfully in container!" << std::endl;
    return 0;
}
```

### Test Stdin Input
If testing via API client directly:
```bash
curl -X POST http://localhost:3001/api/execute \
  -H "Content-Type: application/json" \
  -d '{"language":"python","code":"import sys; print(f\"Input: {sys.stdin.read().strip()}\")","input":"Docker Stdin Test"}'
```
*Expected Response:*
```json
{
  "success": true,
  "output": "Input: Docker Stdin Test\n",
  "error": null,
  "errorType": null,
  "executionTime": 250,
  "language": "python",
  "engine": "docker"
}
```
